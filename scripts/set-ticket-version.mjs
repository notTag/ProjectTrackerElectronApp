import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { parseArgs as parseNodeArgs } from 'node:util'

const USAGE = 'Usage: bun run set-version <version> <ticket> [<ticket>...] [--project <path>] [--db <path>]'

// Same file as TRACKER_DATABASE_PATH in src/shared/projectTypes.ts.
const DEFAULT_DATABASE_PATH = join(homedir(), 'Library/Application Support/Project Tracker/project-tracker.sqlite')

// Copy of SEMANTIC_VERSION_PATTERN in src/shared/projectTypes.ts (.mjs can't
// import the TS helper); the parity test keeps the two from drifting.
const SEMANTIC_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

// Mirrors normalizeSemanticVersion: undefined = empty, null = invalid.
export const normalizeVersion = (input) => {
  const trimmed = input.trim()
  if (!trimmed) return undefined
  const withoutPrefix = trimmed.replace(/^v/i, '')
  return SEMANTIC_VERSION_PATTERN.test(withoutPrefix) ? withoutPrefix : null
}

const parseTicketNumber = (token) => {
  const digits = token.replace(/^#/, '')
  const isTicketNumber = /^[1-9]\d*$/.test(digits) && Number.isSafeInteger(Number(digits))
  if (!isTicketNumber) throw new Error(`Not a ticket number: "${token}"\n${USAGE}`)
  return Number(digits)
}

export const parseArgs = (argv) => {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    allowPositionals: true,
    options: { project: { type: 'string' }, db: { type: 'string' } }
  })
  const [versionInput, ...ticketTokens] = positionals
  if (versionInput === undefined) throw new Error(`Missing version.\n${USAGE}`)

  const version = normalizeVersion(versionInput)
  if (!version) throw new Error(`Not a semantic version (MAJOR.MINOR.PATCH): "${versionInput}"`)

  const splitTokens = ticketTokens.flatMap((token) => token.split(',')).filter(Boolean)
  const ticketNumbers = [...new Set(splitTokens.map(parseTicketNumber))]
  if (ticketNumbers.length === 0) throw new Error(`Missing ticket numbers.\n${USAGE}`)

  return { version, ticketNumbers, projectPath: values.project, dbPath: values.db }
}

// Throws before writing anything if any number is missing for this project —
// numbers repeat across projects, so a wrong path must never write elsewhere.
export const applyVersion = ({ db, projectPath, version, ticketNumbers }) => {
  const selectTicket = db.prepare('SELECT id, title, version FROM tickets WHERE project_path = ? AND number = ?')
  const updateTicket = db.prepare('UPDATE tickets SET version = ?, updated_at = ? WHERE id = ?')
  const updatedAt = new Date().toISOString()

  db.exec('BEGIN IMMEDIATE')
  try {
    const found = ticketNumbers.map((number) => ({ number, row: selectTicket.get(projectPath, number) }))
    const missingNumbers = found.filter(({ row }) => !row).map(({ number }) => `#${number}`)
    if (missingNumbers.length > 0) {
      throw new Error(`No tickets ${missingNumbers.join(', ')} in project ${projectPath}. Nothing was changed.`)
    }

    for (const { row } of found) updateTicket.run(version, updatedAt, row.id)
    db.exec('COMMIT')
    return found.map(({ number, row }) => ({ number, title: row.title, from: row.version ?? null, to: version }))
  } catch (error) {
    // A failed COMMIT can auto-roll back; a second ROLLBACK would mask the real error.
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

// The tracker keys projects by main checkout, so worktrees resolve to it too.
const mainCheckoutPath = () => {
  const gitArgs = ['rev-parse', '--path-format=absolute', '--git-common-dir']
  let gitCommonDir
  try {
    gitCommonDir = execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    throw new Error('Not inside a git repo; pass --project <path>.')
  }
  return dirname(gitCommonDir)
}

const formatChange = ({ number, title, from, to }) => `#${number} ${title}: ${from ?? 'unset'} → ${to}`

const main = (argv) => {
  const { version, ticketNumbers, projectPath, dbPath } = parseArgs(argv)
  // The app stores project_path via path.resolve. `bun run` runs from the
  // package root and sets no INIT_CWD, so relative paths resolve there.
  const resolvedProjectPath = projectPath ? resolve(projectPath) : mainCheckoutPath()
  const databasePath = dbPath ? resolve(dbPath) : DEFAULT_DATABASE_PATH
  // DatabaseSync creates missing files; an empty DB at the app's path would confuse its first launch.
  if (!existsSync(databasePath)) throw new Error(`No tracker database at ${databasePath}`)
  const db = new DatabaseSync(databasePath)
  try {
    // Same wait as the app, so a write while it's open queues instead of failing.
    db.exec('PRAGMA busy_timeout = 5000')
    const changes = applyVersion({ db, projectPath: resolvedProjectPath, version, ticketNumbers })
    for (const change of changes) {
      console.log(formatChange(change))
    }
  } finally {
    db.close()
  }
}

const entryScriptPath = process.argv[1]
const realEntryScriptPath = entryScriptPath ? realpathSync(entryScriptPath) : null
const entryScriptUrl = realEntryScriptPath ? pathToFileURL(realEntryScriptPath).href : null
const isRunDirectly = import.meta.url === entryScriptUrl

if (isRunDirectly) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
