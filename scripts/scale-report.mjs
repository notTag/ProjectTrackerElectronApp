// Renders the #118 scaling CSV into a one-page PDF report (chart + table).
// Re-renders from the CSV alone, no rerun needed:
//
//   ./node_modules/.bin/electron scripts/scale-report.mjs [--baseline <t118 csv>] <csv> <pdf>

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { THRESHOLD_SECONDS, formatSeconds, median } from './scale-test.mjs'

export const parseCsv = (text) => {
  const [header, ...lines] = text.trim().split('\n')
  const columns = header.split(',')
  return lines.map((line) => {
    const values = line.split(',')
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]))
    const asSeconds = (value) => (value === 'timeout' || value === 'error' ? Infinity : Number(value))
    return {
      ...row,
      ticket_count: Number(row.ticket_count),
      sample: Number(row.sample),
      creation_s: asSeconds(row.creation_s),
      access_s: asSeconds(row.access_s),
      fill_s: Number(row.fill_s)
    }
  })
}

export const summarizeCheckpoints = (rows) => {
  const byCount = Map.groupBy(rows, (row) => row.ticket_count)
  return [...byCount].map(([ticketCount, samples]) => ({
    ticketCount,
    firstCreation: samples[0].creation_s,
    firstAccess: samples[0].access_s,
    medianCreation: median(samples.map((sample) => sample.creation_s)),
    medianAccess: median(samples.map((sample) => sample.access_s)),
    fillSeconds: samples[0].fill_s,
    finishedAt: samples.at(-1).iso_time
  }))
}

const STOP_TEXT = {
  threshold: `median Ticket Creation Time exceeded ${THRESHOLD_SECONDS}s`,
  'ticket-cap': 'safety cap reached: 20,000 tickets',
  'time-cap': 'safety cap reached: 60 min wall time'
}

// The harness writes why it stopped; no stop file means it was killed before it could.
const describeStop = (checkpoints, stopRecord) => {
  const last = checkpoints.at(-1)
  if (!stopRecord) return { text: 'run killed before the harness recorded a stop reason', last, elapsedMinutes: null }
  const text = STOP_TEXT[stopRecord.reason] ?? `run ended early: ${stopRecord.reason}`
  return { text, last, elapsedMinutes: stopRecord.elapsedMinutes }
}

// <tag>-scaling-raw.csv sits beside <tag>-scaling-stop.json.
const readStopRecord = (csvPath) => {
  const stopName = path.basename(csvPath).replace('-scaling-raw.csv', '-scaling-stop.json')
  const stopPath = path.join(path.dirname(csvPath), stopName)
  if (!fs.existsSync(stopPath)) return null
  return JSON.parse(fs.readFileSync(stopPath, 'utf8'))
}
const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`)

// Log x axis: checkpoints step 10 then 100, so a linear axis would crush 10–100 into one pixel column.
// Each line: { key, cssVar, label, checkpoints, dashed }. Dashed = the #118 baseline.
const renderChart = (lines, { yTitle, showThreshold }) => {
  const width = 720
  const height = 300
  const margin = { top: 16, right: 24, bottom: 44, left: 52 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const counts = lines.flatMap((line) => line.checkpoints.map((checkpoint) => checkpoint.ticketCount))
  const minLog = Math.log10(Math.min(...counts))
  const maxLog = Math.log10(Math.max(...counts, Math.min(...counts) * 10))
  const finiteTimes = lines
    .flatMap((line) => line.checkpoints.map((checkpoint) => checkpoint[line.key]))
    .filter(Number.isFinite)
  const yFloor = showThreshold ? THRESHOLD_SECONDS + 1 : 1
  const yMax = Math.ceil(Math.max(yFloor, ...finiteTimes) * 1.1)
  const xForTicketCount = (count) => margin.left + ((Math.log10(count) - minLog) / (maxLog - minLog)) * plotWidth
  const yForSeconds = (seconds) => margin.top + plotHeight - (Math.min(seconds, yMax) / yMax) * plotHeight

  const xTicks = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(
    (tick) => Math.log10(tick) >= minLog - 1e-9 && Math.log10(tick) <= maxLog + 1e-9
  )
  const yStep = yMax <= 10 ? 1 : Math.ceil(yMax / 10)
  const yTicks = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, index) => index * yStep)

  const series = ({ key, cssVar, checkpoints, dashed }) => {
    const points = checkpoints.map((checkpoint) => [xForTicketCount(checkpoint.ticketCount), yForSeconds(checkpoint[key])])
    const pathData = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
    const dash = dashed ? ' stroke-dasharray="5 4" stroke-opacity="0.7"' : ''
    const dots = dashed
      ? ''
      : points
          .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="var(${cssVar})" stroke="var(--surface-1)" stroke-width="1"/>`)
          .join('')
    return `<path d="${pathData}" fill="none" stroke="var(${cssVar})" stroke-width="2"${dash}/>${dots}`
  }

  const label = ({ key, label: text, checkpoints }) => {
    const last = checkpoints.at(-1)
    return `<text x="${xForTicketCount(last.ticketCount) - 6}" y="${yForSeconds(last[key]) - 10}" text-anchor="end" class="direct">${text}</text>`
  }

  const threshold = showThreshold
    ? `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yForSeconds(THRESHOLD_SECONDS)}" y2="${yForSeconds(THRESHOLD_SECONDS)}" class="threshold"/>
    <text x="${margin.left + 6}" y="${yForSeconds(THRESHOLD_SECONDS) - 6}" class="direct">${THRESHOLD_SECONDS}s threshold</text>`
    : ''

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(yTitle)} vs ticket count">
    ${yTicks.map((tick) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yForSeconds(tick)}" y2="${yForSeconds(tick)}" class="grid"/><text x="${margin.left - 8}" y="${yForSeconds(tick) + 4}" text-anchor="end" class="tick">${tick}</text>`).join('')}
    ${xTicks.map((tick) => `<text x="${xForTicketCount(tick)}" y="${height - margin.bottom + 18}" text-anchor="middle" class="tick">${tick.toLocaleString('en-US')}</text>`).join('')}
    <line x1="${margin.left}" x2="${width - margin.right}" y1="${yForSeconds(0)}" y2="${yForSeconds(0)}" class="axis"/>
    ${threshold}
    ${lines.map(series).join('')}
    ${lines.filter((line) => line.label).map(label).join('')}
    <text x="${margin.left + plotWidth / 2}" y="${height - 6}" text-anchor="middle" class="axis-title">Tickets on the board (log scale)</text>
    <text transform="translate(14 ${margin.top + plotHeight / 2}) rotate(-90)" text-anchor="middle" class="axis-title">${escapeHtml(yTitle)}</text>
  </svg>`
}

// Before/after at the checkpoints both runs reached.
const comparisonRows = (checkpoints, baselineCheckpoints) => {
  const baselineByCount = new Map(baselineCheckpoints.map((checkpoint) => [checkpoint.ticketCount, checkpoint]))
  const shared = checkpoints.filter((checkpoint) => baselineByCount.has(checkpoint.ticketCount))
  const wanted = [100, 1000, 5000, 10000, shared.at(-1)?.ticketCount]
  const picked = shared.filter((checkpoint) => wanted.includes(checkpoint.ticketCount))
  return picked
    .map((after) => {
      const before = baselineByCount.get(after.ticketCount)
      const ratio = after.medianCreation / after.medianAccess
      return `<tr><td>${after.ticketCount.toLocaleString('en-US')}</td>
        <td>${formatSeconds(before.medianCreation)} → ${formatSeconds(after.medianCreation)}</td>
        <td>${formatSeconds(before.medianAccess)} → ${formatSeconds(after.medianAccess)}</td>
        <td>${before.fillSeconds.toFixed(1)} → ${after.fillSeconds.toFixed(1)}</td>
        <td>${Number.isFinite(ratio) ? ratio.toFixed(2) : '—'}×</td></tr>`
    })
    .join('')
}

const machineInfo = () => {
  const gitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  const macosVersion = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()
  const appVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
  return [
    ['Machine', `${os.cpus()[0].model}, ${Math.round(os.totalmem() / 2 ** 30)} GB RAM`],
    ['OS', `macOS ${macosVersion}`],
    ['App', `Project Tracker ${appVersion} (git ${gitSha}), production renderer build`],
    ['Electron / Chromium', `${process.versions.electron} / ${process.versions.chrome}`]
  ]
}

export const renderReportHtml = (rows, stopRecord, baselineRows = null) => {
  const checkpoints = summarizeCheckpoints(rows)
  const baselineCheckpoints = baselineRows ? summarizeCheckpoints(baselineRows) : []
  const hasBaseline = baselineCheckpoints.length > 0
  const timingLines = [
    ...(hasBaseline
      ? [
          { key: 'medianCreation', cssVar: '--series-1', checkpoints: baselineCheckpoints, dashed: true },
          { key: 'medianAccess', cssVar: '--series-2', checkpoints: baselineCheckpoints, dashed: true }
        ]
      : []),
    { key: 'medianCreation', cssVar: '--series-1', label: 'Creation', checkpoints },
    { key: 'medianAccess', cssVar: '--series-2', label: 'Access', checkpoints }
  ]
  const fillLines = [
    { key: 'fillSeconds', cssVar: '--series-3', label: 'Before (#118)', checkpoints: baselineCheckpoints, dashed: true },
    { key: 'fillSeconds', cssVar: '--series-3', label: 'After', checkpoints }
  ]
  const title = hasBaseline ? 'Ticket #134 — board render scaling, before (#118) vs after' : 'Ticket #118 — single-board scaling report'
  const lede = hasBaseline
    ? 'Same harness and method as #118, rerun after the #134 render fixes (lane map, TicketCard, in-place ticket writes, virtualized lanes). Solid = after, dashed = #118.'
    : 'Ticket Creation Time and Ticket Access Time as one board grows, measured through the real UI on an isolated copy of the database.'
  const baselineLegend = hasBaseline ? '<span class="dashed">#118 (before)</span>' : `<span class="dashed">${THRESHOLD_SECONDS}s threshold</span>`
  const comparison = hasBaseline
    ? `<h2>Before → after (medians)</h2>
    <table><thead><tr><th>Tickets</th><th>Creation (s)</th><th>Access (s)</th><th>Fill + reload (s)</th><th>Creation ÷ access, after</th></tr></thead>
    <tbody>${comparisonRows(checkpoints, baselineCheckpoints)}</tbody></table>
    <h2>Fill + reload (fresh board draw)</h2>
    ${renderChart(fillLines, { yTitle: 'Seconds', showThreshold: false })}`
    : ''
  const stop = describeStop(checkpoints, stopRecord)
  const elapsedText = stop.elapsedMinutes === null ? '' : ` Run took ${stop.elapsedMinutes.toFixed(1)} min.`
  const tableRows = checkpoints
    .map((checkpoint) => {
      const over = checkpoint.medianCreation > THRESHOLD_SECONDS ? ' class="over"' : ''
      const samples = rows.filter((row) => row.ticket_count === checkpoint.ticketCount)
      return `<tr${over}><td>${checkpoint.ticketCount.toLocaleString('en-US')}</td>
        <td>${samples.map((sample) => formatSeconds(sample.creation_s)).join(' / ')}</td><td>${formatSeconds(checkpoint.medianCreation)}</td>
        <td>${samples.map((sample) => formatSeconds(sample.access_s)).join(' / ')}</td><td>${formatSeconds(checkpoint.medianAccess)}</td>
        <td>${checkpoint.fillSeconds.toFixed(1)}</td></tr>`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    .viz-root { --surface-1:#fcfcfb; --text-primary:#0b0b0b; --text-secondary:#52514e; --text-muted:#7a7974; --grid:#e6e5e1; --series-1:#2a78d6; --series-2:#eb6834; --series-3:#3a9a5b; }
    body { margin:0; font:12px/1.45 -apple-system, "Helvetica Neue", sans-serif; color:var(--text-primary); background:var(--surface-1); }
    main { padding:28px 36px; }
    h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:14px; margin:20px 0 6px; }
    .lede { color:var(--text-secondary); margin:0 0 12px; }
    .stop { border-left:3px solid var(--text-primary); padding:6px 10px; margin:10px 0; background:#f3f2ef; }
    .legend { display:flex; gap:18px; color:var(--text-secondary); margin:6px 0; }
    .legend span::before { content:""; display:inline-block; width:14px; height:2px; vertical-align:middle; margin-right:6px; background:var(--swatch); }
    .legend .dashed::before { background:none; border-top:2px dashed var(--text-secondary); height:0; }
    svg .grid { stroke:var(--grid); stroke-width:1; } svg .axis { stroke:var(--text-muted); stroke-width:1; }
    svg .threshold { stroke:var(--text-secondary); stroke-width:1.5; stroke-dasharray:6 4; }
    svg .tick { fill:var(--text-muted); font-size:10px; } svg .axis-title { fill:var(--text-secondary); font-size:11px; }
    svg .direct { fill:var(--text-primary); font-size:11px; }
    table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }
    th, td { text-align:right; padding:3px 8px; border-bottom:1px solid var(--grid); } th { color:var(--text-secondary); font-weight:600; }
    th:first-child, td:first-child { text-align:left; } tr.over td { font-weight:600; }
    dl { display:grid; grid-template-columns:max-content 1fr; gap:2px 12px; margin:0; } dt { color:var(--text-secondary); }
    ul { margin:0; padding-left:18px; }
  </style></head><body class="viz-root"><main>
    <h1>${escapeHtml(title)}</h1>
    <p class="lede">${escapeHtml(lede)}</p>
    <p class="stop"><strong>Stopped at ${stop.last.ticketCount.toLocaleString('en-US')} tickets:</strong> ${escapeHtml(stop.text)}.
      Last checkpoint medians: creation ${formatSeconds(stop.last.medianCreation)}s, access ${formatSeconds(stop.last.medianAccess)}s.${elapsedText}</p>
    <div class="legend"><span style="--swatch:var(--series-1)">Ticket Creation Time</span><span style="--swatch:var(--series-2)">Ticket Access Time</span>${baselineLegend}</div>
    ${renderChart(timingLines, { yTitle: 'Seconds (median of 3)', showThreshold: true })}
    ${comparison}

    <h2>Method</h2>
    <ul>
      <li>Live DB copied with <code>sqlite3 .backup</code>; copy checked with <code>PRAGMA integrity_check</code> = ok and ticket count = live. App launched with <code>PROJECT_TRACKER_USER_DATA</code> pointing at the copy; live DB only read.</li>
      <li>Throwaway git-init'd project added via the dashboard Scan button (scan dirs in the copy re-pointed at a scratch folder).</li>
      <li>Fill tickets created over IPC (<code>window.projectTracker.createTicket</code>), round-robin across the board's lanes, ~500-char description each; page reloaded after every fill and timing starts once the board shows every ticket (since #134: lane counts add up, as long lanes mount only the cards in view).</li>
      <li>Ticket Creation Time (since #134 each lane is first scrolled to its bottom, untimed, where the new card lands): click “+ Ticket” → type title → click Save → new card rendered (+2 animation frames). Ticket Access Time: click that card → ticket modal rendered with its #number (+2 frames). Timed in the renderer with <code>performance.now()</code>, driven over Chrome DevTools Protocol.</li>
      <li>Checkpoints 10…100 step 10, then step 100. 3 create+access samples each; the chart plots the median, the table lists every sample (first = the single timed sample). Stop rule: median creation &gt; ${THRESHOLD_SECONDS}s, or 20,000 tickets / 60 min safety cap. Sample timeout 30s.</li>
    </ul>

    <h2>Limitations</h2>
    <ul>
      <li>Local SQLite only: no network or remote-DB latency is in these numbers.</li>
      <li>Writes and one open per sample only: no search, filtering, list retrieval or sync under load. Follow-up ticket covers a test that does.</li>
    </ul>

    <h2>Environment</h2>
    <dl>${machineInfo().map(([key, value]) => `<dt>${key}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>

    <h2>Raw data</h2>
    <table><thead><tr><th>Tickets</th><th>Creation samples (s)</th><th>Median</th><th>Access samples (s)</th><th>Median</th><th>Fill + reload (s)</th></tr></thead>
    <tbody>${tableRows}</tbody></table>
  </main></body></html>`
}

const writePdf = async (csvPath, pdfPath, baselineCsvPath) => {
  const { app, BrowserWindow } = await import('electron')
  await app.whenReady()
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'))
  const baselineRows = baselineCsvPath ? parseCsv(fs.readFileSync(baselineCsvPath, 'utf8')) : null
  const html = renderReportHtml(rows, readStopRecord(csvPath), baselineRows)
  const window = new BrowserWindow({ show: false, width: 900, height: 1200 })
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  const pdf = await window.webContents.printToPDF({ printBackground: true, pageSize: 'Letter' })
  fs.writeFileSync(pdfPath, pdf)
  app.quit()
}

if (process.versions.electron) {
  const [csvPath, pdfPath] = process.argv.slice(-2).map((arg) => path.resolve(arg))
  const baselineIndex = process.argv.indexOf('--baseline')
  const baselineCsvPath = baselineIndex > 0 ? path.resolve(process.argv[baselineIndex + 1]) : null
  writePdf(csvPath, pdfPath, baselineCsvPath).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
