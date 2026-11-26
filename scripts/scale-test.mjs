// Ticket #118 scalability harness. Grows one throwaway board on an isolated
// copy of the live DB and times ticket create + open through the real UI.
// Plan + decisions: docs/prd/t118-scalability-testing.md
//
//   bun run scale-test [--keep] [--port 9333] [--tag t134]
//
// --tag names the output files (<tag>-scaling-raw.csv / -report.pdf / -stop.json,
// default t118). A tag other than t118 charts the t118 run beside it.
//
// Never writes the live DB: it is only read by `sqlite3 .backup`.

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const THRESHOLD_SECONDS = 5
export const TICKET_CAP = 20_000
export const WALL_CAP_MS = 60 * 60 * 1000
export const SAMPLES_PER_CHECKPOINT = 3
export const BASELINE_TAG = 't118'
export const reportFiles = (tag) => ({
  csv: `${tag}-scaling-raw.csv`,
  pdf: `${tag}-scaling-report.pdf`,
  stop: `${tag}-scaling-stop.json`
})
export const CSV_HEADER = 'checkpoint,ticket_count,sample,creation_s,access_s,fill_s,iso_time'

export function* checkpoints() {
  for (let count = 10; count <= 100; count += 10) yield count
  for (let count = 200; count <= TICKET_CAP; count += 100) yield count
}

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}

// A timed-out sample is stored as Infinity, so it always counts as over threshold.
export const stopReason = ({ medianCreationSeconds, ticketCount, elapsedMs }) => {
  if (medianCreationSeconds > THRESHOLD_SECONDS) return 'threshold'
  if (ticketCount >= TICKET_CAP) return 'ticket-cap'
  if (elapsedMs >= WALL_CAP_MS) return 'time-cap'
  return null
}

const LIVE_USER_DATA = path.join(os.homedir(), 'Library/Application Support/Project Tracker')
const LIVE_DB = path.join(LIVE_USER_DATA, 'project-tracker.sqlite')
const SQLITE = '/usr/bin/sqlite3'
const SAMPLE_TIMEOUT_MS = 30_000
const FILL_CHUNK = 250
const FILL_DESCRIPTION = 'Filler ticket for the #118 scaling run. '.repeat(12).trim()

const sqlite = (dbPath, sql) => execFileSync(SQLITE, [dbPath, sql], { encoding: 'utf8' }).trim()
const ticketCountOf = (dbPath) => Number(sqlite(dbPath, 'SELECT count(*) FROM tickets'))
const quoteSql = (value) => `'${String(value).replaceAll("'", "''")}'`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (message) => console.log(`[scale ${new Date().toISOString().slice(11, 19)}] ${message}`)

const backupLiveDb = (copyPath) => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    fs.rmSync(copyPath, { force: true })
    sqlite(LIVE_DB, `.backup ${quoteSql(copyPath)}`)
    const integrity = sqlite(copyPath, 'PRAGMA integrity_check')
    const copyCount = ticketCountOf(copyPath)
    const liveCount = ticketCountOf(LIVE_DB)
    log(`backup attempt ${attempt}: integrity=${integrity} copy=${copyCount} live=${liveCount}`)
    if (integrity === 'ok' && copyCount === liveCount) return { integrity, ticketCount: copyCount }
  }
  throw new Error('Backup verification failed twice; refusing to run.')
}

// Scan only ever walks the scratch projects dir, never real repos.
const pointScanAtScratch = (dbPath, projectsDir) => {
  sqlite(dbPath, `BEGIN;
    DELETE FROM user_paths WHERE kind = 'scan';
    INSERT INTO user_paths (user_id, kind, path) SELECT id, 'scan', ${quoteSql(projectsDir)} FROM users;
    COMMIT;`)
}

const makeThrowawayProject = (projectDir) => {
  fs.mkdirSync(projectDir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: projectDir })
  fs.writeFileSync(path.join(projectDir, 'package.json'), '{ "name": "scale-board", "version": "0.0.0" }\n')
  fs.writeFileSync(path.join(projectDir, 'README.md'), '# scale-board\n\nThrowaway board for the #118 scaling run.\n')
}

const OWN_RENDERER_URL = pathToFileURL(path.resolve('out/renderer/index.html')).href

const connectCdp = async (port) => {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`)
      const targets = await response.json()
      // This checkout's renderer only: another worktree's app may hold the port.
      const page = targets.find((target) => target.type === 'page' && target.url.startsWith(OWN_RENDERER_URL))
      if (page) return openCdpSession(page.webSocketDebuggerUrl)
    } catch {
      // App still starting.
    }
    await sleep(500)
  }
  throw new Error(`No renderer on CDP port ${port} after 60s.`)
}

const openCdpSession = (socketUrl) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl)
    const pending = new Map()
    let nextId = 1
    socket.onerror = reject
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    }
    const send = (method, params = {}) =>
      new Promise((resolveCall, rejectCall) => {
        const id = nextId++
        pending.set(id, { resolve: resolveCall, reject: rejectCall })
        socket.send(JSON.stringify({ id, method, params }))
      })
    // Runs an async function body in the renderer and returns its value.
    const evaluate = async (functionSource, argument) => {
      const expression = `(${functionSource})(${JSON.stringify(argument ?? null)})`
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      })
      if (exceptionDetails) {
        const description = exceptionDetails.exception?.description ?? exceptionDetails.text
        throw new Error(description)
      }
      return result.value
    }
    socket.onopen = () => resolve({ send, evaluate, close: () => socket.close() })
  })

// Shared renderer helpers, prepended to every in-page function.
const PAGE_HELPERS = `
  const raf = () => new Promise((resolve) => requestAnimationFrame(resolve))
  const waitFor = async (probe, timeoutMs, what) => {
    const startedAt = performance.now()
    for (;;) {
      const value = probe()
      if (value) return value
      if (performance.now() - startedAt > timeoutMs) throw new Error('timeout waiting for ' + what)
      await raf()
    }
  }
  const buttonByText = (text, scope = document) =>
    [...scope.querySelectorAll('button')].find((button) => button.textContent.trim() === text)
  // Modals close only when the press also started on the backdrop (#117), so send both halves.
  const closeModal = () => {
    const backdrop = document.querySelector('.modal-backdrop')
    backdrop?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    backdrop?.click()
  }
`
const inPage = (body) => `async (arg) => { ${PAGE_HELPERS} ${body} }`

const scanForProject = (cdp, projectDir) =>
  cdp.evaluate(
    inPage(`
      location.hash = '#/'
      const scan = await waitFor(() => {
        const button = buttonByText('Scan')
        return button && !button.disabled && button
      }, 30000, 'Scan button')
      scan.click()
      await waitFor(() => buttonByText('Scanning...'), 5000, 'scan start').catch(() => null)
      await waitFor(() => buttonByText('Scan'), 120000, 'scan end')
      const state = await window.projectTracker.getProjectState()
      return state.snapshot.projects.some((project) => project.path === arg.projectDir)
    `),
    { projectDir }
  )

const openBoard = (cdp, projectDir) =>
  cdp.evaluate(
    inPage(`
      location.hash = '#/board/' + encodeURIComponent(arg.projectDir)
      await waitFor(() => buttonByText('+ Ticket'), 30000, 'board')
      return true
    `),
    { projectDir }
  )

// Times one create + one open through the real Vue handlers (element.click()).
const timeSample = (cdp, title) =>
  cdp.evaluate(
    inPage(`
      const timeout = ${SAMPLE_TIMEOUT_MS}
      // Since #134 long lanes mount only the cards near their scroll position,
      // and a new ticket is appended to its lane: look at the lane bottoms, as
      // a user waiting for the new card would. Untimed.
      // Repeated: measuring the cards that mount there resizes the spacers.
      for (let pass = 0; pass < 3; pass += 1) {
        for (const laneBody of document.querySelectorAll('.lane-body')) laneBody.scrollTop = laneBody.scrollHeight
        await raf()
        await raf()
      }
      const findCard = () =>
        [...document.querySelectorAll('article.ticket')].find((card) => card.querySelector('h3')?.textContent.includes(arg.title))

      let creationSeconds = Infinity
      let accessSeconds = Infinity
      const createStartedAt = performance.now()
      try {
        buttonByText('+ Ticket').click()
        const input = await waitFor(() => document.querySelector('.modal.ticket-modal input.ticket-title-input'), timeout, 'draft modal')
        input.value = arg.title
        input.dispatchEvent(new Event('input'))
        const save = await waitFor(() => {
          const button = buttonByText('Save', document.querySelector('.modal-actions'))
          return button && !button.disabled && button
        }, timeout, 'Save enabled')
        save.click()
        await waitFor(() => findCard(), timeout, 'new card')
        await raf()
        await raf()
        creationSeconds = (performance.now() - createStartedAt) / 1000
      } catch (error) {
        closeModal()
        return { creationSeconds: null, accessSeconds: null, error: String(error) }
      }

      const card = findCard()
      const number = card.querySelector('.ticket-number')?.textContent.trim() ?? ''
      const accessStartedAt = performance.now()
      try {
        card.click()
        await waitFor(() => {
          const eyebrow = document.querySelector('.modal.ticket-modal .ticket-modal-header .eyebrow')
          return eyebrow && eyebrow.textContent.trim().startsWith(number + ' ')
        }, timeout, 'ticket modal')
        await raf()
        await raf()
        accessSeconds = (performance.now() - accessStartedAt) / 1000
      } catch (error) {
        closeModal()
        return { creationSeconds, accessSeconds: null, error: String(error) }
      }

      closeModal()
      await waitFor(() => !document.querySelector('.modal.ticket-modal'), timeout, 'modal closed')
      return { creationSeconds, accessSeconds, number }
    `),
    { title }
  )

// Bulk fill over IPC: not a measured path, so it skips the UI. Round-robin
// across lanes so no single lane holds the whole board.
const fillTickets = (cdp, { projectDir, laneIds, startIndex, count }) =>
  cdp.evaluate(
    `async (arg) => {
      for (let offset = 0; offset < arg.count; offset += 1) {
        const index = arg.startIndex + offset
        await window.projectTracker.createTicket(arg.projectDir, {
          id: crypto.randomUUID(),
          laneId: arg.laneIds[index % arg.laneIds.length],
          title: 'Fill ' + index,
          description: arg.description,
          createdAt: new Date().toISOString()
        })
      }
      return true
    }`,
    { projectDir, laneIds, startIndex, count, description: FILL_DESCRIPTION }
  )

// IPC writes use the app's own connection, so data_version never moves and
// store.refresh() sees nothing: reload so the board reads the DB fresh.
const reloadAndWaitForCards = async (cdp, expectedCards) => {
  await cdp.send('Page.reload', { ignoreCache: false })
  await sleep(500)
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    try {
      // Lane counts, not mounted cards: virtualized lanes (#134) mount only what is in view.
      const shown = await cdp.evaluate(`async () => {
        const counts = [...document.querySelectorAll('.lane-count')].map((badge) => Number(badge.textContent))
        const anyCard = document.querySelector('article.ticket') !== null
        return anyCard ? counts.reduce((total, count) => total + count, 0) : 0
      }`)
      if (shown === expectedCards) return
    } catch {
      // Context torn down mid-reload.
    }
    await sleep(250)
  }
  throw new Error(`Board never rendered ${expectedCards} cards after reload.`)
}

const boardOf = async (cdp, projectDir) => {
  const state = await cdp.evaluate(`async () => window.projectTracker.getProjectState()`)
  return state.boards?.[projectDir]
}

export const formatSeconds = (seconds) => (Number.isFinite(seconds) ? seconds.toFixed(3) : 'timeout')

// Both count as over threshold; 'error' keeps a crash from reading as slowness in the CSV.
const formatSample = (seconds, error) => {
  if (seconds !== null) return formatSeconds(seconds)
  return error?.includes('timeout waiting') ? 'timeout' : 'error'
}

const parseArgs = (argv) => ({
  keep: argv.includes('--keep'),
  port: Number(argv[argv.indexOf('--port') + 1]) || 9333,
  outDir: path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'docs/reports'),
  tag: argv.includes('--tag') ? argv[argv.indexOf('--tag') + 1] : BASELINE_TAG
})

const run = async () => {
  const options = parseArgs(process.argv.slice(2))
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-scale-')))
  const userData = path.join(scratch, 'userdata')
  const projectsDir = path.join(scratch, 'projects')
  const projectDir = path.join(projectsDir, 'scale-board')
  if (path.resolve(userData) === path.resolve(LIVE_USER_DATA)) throw new Error('Scratch userData is the live one.')
  fs.mkdirSync(userData, { recursive: true })
  log(`scratch ${scratch}`)

  const copyDb = path.join(userData, 'project-tracker.sqlite')
  const backup = backupLiveDb(copyDb)
  pointScanAtScratch(copyDb, projectsDir)
  makeThrowawayProject(projectDir)

  const electronBin = path.resolve('node_modules/.bin/electron')
  // Production renderer from out/, never the Vite dev server (HMR skews timings).
  const { VITE_DEV_SERVER_URL: _ignoredDevServer, ...parentEnv } = process.env
  const app = spawn(electronBin, ['.', `--remote-debugging-port=${options.port}`], {
    env: { ...parentEnv, PROJECT_TRACKER_USER_DATA: userData },
    stdio: 'ignore'
  })
  const runStartedAt = Date.now()
  const csvRows = [CSV_HEADER]
  const files = reportFiles(options.tag)
  const csvPath = path.join(options.outDir, files.csv)
  fs.mkdirSync(options.outDir, { recursive: true })
  fs.rmSync(csvPath, { force: true })
  let stopCause = null
  let cdp
  try {
    cdp = await connectCdp(options.port)
    await cdp.send('Page.enable')
    if (!(await scanForProject(cdp, projectDir))) throw new Error('Scan did not add the throwaway project.')
    await openBoard(cdp, projectDir)

    // A board row only exists once something is saved to it, so seed one ticket via the UI.
    const seed = await timeSample(cdp, 'Seed ticket')
    if (seed.error) throw new Error(`Seed ticket failed: ${seed.error}`)
    const board = await boardOf(cdp, projectDir)
    const laneIds = board.lanes.map((lane) => lane.id)
    let ticketCount = board.tickets.length
    let fillIndex = 0
    const baseDbCount = ticketCountOf(copyDb) - ticketCount
    log(`board has ${laneIds.length} lanes, ${ticketCount} ticket(s)`)

    for (const target of checkpoints()) {
      const fillStartedAt = Date.now()
      const toFill = target - ticketCount
      for (let done = 0; done < toFill; done += FILL_CHUNK) {
        const count = Math.min(FILL_CHUNK, toFill - done)
        await fillTickets(cdp, { projectDir, laneIds, startIndex: fillIndex, count })
        fillIndex += count
      }
      ticketCount = target
      const dbBoardCount = ticketCountOf(copyDb) - baseDbCount
      if (dbBoardCount !== target) throw new Error(`DB has ${dbBoardCount} board tickets, expected ${target}.`)
      await reloadAndWaitForCards(cdp, target)
      const fillSeconds = (Date.now() - fillStartedAt) / 1000

      const creationTimes = []
      for (let sample = 1; sample <= SAMPLES_PER_CHECKPOINT; sample += 1) {
        const result = await timeSample(cdp, `Sample c${target} k${sample}`)
        creationTimes.push(result.creationSeconds ?? Infinity)
        const creationCell = formatSample(result.creationSeconds, result.error)
        const accessCell = formatSample(result.accessSeconds, result.error)
        const row = [target, target, sample, creationCell, accessCell, fillSeconds.toFixed(1), new Date().toISOString()]
        csvRows.push(row.join(','))
        if (result.error) log(`  sample ${sample}: ${result.error}`)
      }
      // A failed sample may or may not have saved its ticket, so trust the DB.
      ticketCount = ticketCountOf(copyDb) - baseDbCount
      fs.writeFileSync(csvPath, csvRows.join('\n') + '\n')

      const medianCreationSeconds = median(creationTimes)
      log(`${target} tickets: median creation ${formatSeconds(medianCreationSeconds)}s, fill ${fillSeconds.toFixed(1)}s`)
      stopCause = stopReason({ medianCreationSeconds, ticketCount: target, elapsedMs: Date.now() - runStartedAt })
      if (stopCause) {
        log(`stopping: ${stopCause}`)
        break
      }
    }

    const finalBoardCount = ticketCountOf(copyDb) - baseDbCount
    log(`scratch board holds ${finalBoardCount} tickets; live DB count now ${ticketCountOf(LIVE_DB)} (was ${backup.ticketCount})`)
  } catch (error) {
    stopCause = `crashed: ${error.message}`
    throw error
  } finally {
    cdp?.close()
    app.kill()
    writeReport({ electronBin, csvPath, files, outDir: options.outDir, tag: options.tag, stopCause, elapsedMs: Date.now() - runStartedAt })
    // The scratch dir holds a full copy of the live DB: never leave it behind by accident.
    if (!options.keep) fs.rmSync(scratch, { recursive: true, force: true })
  }
}

const writeReport = ({ electronBin, csvPath, files, outDir, tag, stopCause, elapsedMs }) => {
  if (!fs.existsSync(csvPath)) return
  const stopPath = path.join(outDir, files.stop)
  const stopRecord = { reason: stopCause ?? 'interrupted', elapsedMinutes: elapsedMs / 60_000 }
  fs.writeFileSync(stopPath, JSON.stringify(stopRecord, null, 2) + '\n')
  const reportScript = path.resolve('scripts/scale-report.mjs')
  const pdfPath = path.join(outDir, files.pdf)
  const baselineCsv = path.join(outDir, reportFiles(BASELINE_TAG).csv)
  const baselineArgs = tag !== BASELINE_TAG && fs.existsSync(baselineCsv) ? ['--baseline', baselineCsv] : []
  execFileSync(electronBin, [reportScript, ...baselineArgs, csvPath, pdfPath], { stdio: 'inherit' })
  log(`wrote ${csvPath}, ${stopPath} and ${pdfPath}`)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  run().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
