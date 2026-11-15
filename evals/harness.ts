/**
 * Builds a throwaway world for one behavioral eval run — fixture git repo,
 * temp Project Tracker DB, stubbed outward-facing CLIs — runs the lane's agent
 * in it, and grades what the agent left behind.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { runAgentHeadless } from '../electron/agentRun.js'
import { DATABASE_FILE_NAME, StateRepository } from '../electron/storage/stateRepository.js'
import {
  availableAgents,
  DEFAULT_AGENT,
  findAgent,
  ticketAgentPrompt,
  type Agent,
  type ProjectRecord
} from '../src/shared/projectTypes.js'
import {
  EVAL_TICKET_NUMBER,
  REPO_ROOT,
  fixtureLanes,
  laneById,
  ticketFromCase,
  type EvalCase
} from './fixtures.js'
import { parseTrajectory } from './judge.js'

// Real path: macOS tmpdir() is a /var symlink, and the agent sees /private/var.
const SANDBOX_PREFIX = path.join(realpathSync(tmpdir()), 'project-tracker-eval-')
const STUBBED_COMMANDS = ['gh', 'osascript', 'mise']
const FAKE_PULL_REQUEST_URL = 'https://github.com/example/eval-fixture/pull/1'

export const REAL_DATABASE_PATH = path.join(homedir(), 'Library', 'Application Support', 'Project Tracker', DATABASE_FILE_NAME)

export interface Sandbox {
  root: string
  repoPath: string
  databasePath: string
  stubLogPath: string
  // Repo tip after setup; everything the agent commits is reachable from
  // some ref but not from this.
  baselineCommit: string
  // Only its .local/bin matters: runAgentHeadless puts that first on PATH,
  // which is where the stubs live. HOME itself is left alone.
  searchHome: string
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Eval', '-c', 'user.email=eval@example.com', ...args], {
    cwd,
    stdio: 'pipe'
  })

// A local bare repo stands in for origin, so fetch/push/worktree steps work
// with no network and nothing leaves the temp dir.
const createFixtureRepo = (root: string, evalCase: EvalCase): string => {
  const repoPath = path.join(root, 'repo')
  const originPath = path.join(root, 'origin.git')
  mkdirSync(repoPath)
  git(root, 'init', '-q', '--bare', '-b', 'main', originPath)
  git(repoPath, 'init', '-q', '-b', 'main')
  writeFileSync(path.join(repoPath, 'README.md'), '# eval-fixture\n')
  // Lanes linked to a markdown file reference it repo-relative, so it has to be here.
  cpSync(path.join(REPO_ROOT, 'agent-context'), path.join(repoPath, 'agent-context'), { recursive: true })
  git(repoPath, 'add', '.')
  git(repoPath, 'commit', '-q', '-m', 'Initial commit')
  git(repoPath, 'remote', 'add', 'origin', originPath)
  git(repoPath, 'push', '-q', '-u', 'origin', 'main')

  const branchName = evalCase.ticket.branchName
  if (evalCase.setup === 'branch-with-commit' && branchName) {
    git(repoPath, 'checkout', '-q', '-b', branchName)
    writeFileSync(path.join(repoPath, 'CONTRIBUTING.md'), 'Open a PR against main.\n')
    git(repoPath, 'add', '.')
    git(repoPath, 'commit', '-q', '-m', 'Add CONTRIBUTING.md')
    git(repoPath, 'push', '-q', '-u', 'origin', branchName)
  }
  return repoPath
}

// --body-file contents are logged too: the PR body is what the in-pr rubric grades.
const stubScript = (commandName: string, stubLogPath: string) => `#!/bin/sh
printf '%s\\n' "${commandName} $*" >> '${stubLogPath}'
previous=''
for argument in "$@"; do
  if [ "$previous" = "--body-file" ] && [ -f "$argument" ]; then
    { echo "--- body-file ---"; cat "$argument"; echo; echo "--- end body-file ---"; } >> '${stubLogPath}'
  fi
  previous="$argument"
done
case "$*" in
  "pr create"*) echo '${FAKE_PULL_REQUEST_URL}' ;;
esac
exit 0
`

const installStubs = (searchHome: string, stubLogPath: string) => {
  const stubDirectory = path.join(searchHome, '.local', 'bin')
  mkdirSync(stubDirectory, { recursive: true })
  writeFileSync(stubLogPath, '')
  for (const commandName of STUBBED_COMMANDS) {
    const stubPath = path.join(stubDirectory, commandName)
    writeFileSync(stubPath, stubScript(commandName, stubLogPath))
    chmodSync(stubPath, 0o755)
  }
}

const fixtureProject = (repoPath: string): ProjectRecord => ({
  path: repoPath,
  name: 'eval-fixture',
  status: 'active',
  priority: 'none',
  notes: '',
  source: 'first-party',
  hasGit: true,
  hasPackageJson: false,
  hasReadme: true,
  lastScannedAt: new Date().toISOString()
})

// Lane moves leave no trace in the end state, so "exactly one move" needs a log.
const MOVE_LOG_SQL = `
  CREATE TABLE eval_moves (ticket_id TEXT, from_lane TEXT, to_lane TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TRIGGER eval_move_log AFTER UPDATE OF lane_id ON tickets
  WHEN OLD.lane_id IS NOT NEW.lane_id
  BEGIN
    INSERT INTO eval_moves (ticket_id, from_lane, to_lane) VALUES (OLD.id, OLD.lane_id, NEW.lane_id);
  END;
`

const seedDatabase = (userDataPath: string, repoPath: string, evalCase: EvalCase): string => {
  const repository = new StateRepository(userDataPath)
  repository.upsertProject(fixtureProject(repoPath))
  fixtureLanes.forEach((lane, position) => repository.upsertSwimLane(repoPath, lane, position))
  const { number: _number, ...ticket } = ticketFromCase(evalCase)
  repository.createTicket(repoPath, ticket)

  const databasePath = path.join(userDataPath, DATABASE_FILE_NAME)
  const database = new DatabaseSync(databasePath)
  // createTicket numbers from 1; the guard watches EVAL_TICKET_NUMBER instead.
  database.prepare('UPDATE tickets SET number = ? WHERE id = ?').run(EVAL_TICKET_NUMBER, ticket.id)
  database.exec(MOVE_LOG_SQL)
  database.close()
  return databasePath
}

export const createSandbox = (evalCase: EvalCase): Sandbox => {
  const root = mkdtempSync(SANDBOX_PREFIX)
  const repoPath = createFixtureRepo(root, evalCase)
  const searchHome = path.join(root, 'search-home')
  const stubLogPath = path.join(root, 'stub.log')
  installStubs(searchHome, stubLogPath)
  const databasePath = seedDatabase(path.join(root, 'userData'), repoPath, evalCase)
  const baselineCommit = git(repoPath, 'rev-parse', 'HEAD').toString().trim()
  return { root, repoPath, databasePath, stubLogPath, baselineCommit, searchHome }
}

const evalPreamble = (sandbox: Sandbox) =>
  [
    'Eval run.',
    `The Project Tracker DB for this run is "${sandbox.databasePath}". Use it in place of any DB path in CLAUDE.md, memory, or elsewhere, and never open any other Project Tracker DB.`,
    `This board's project_path is "${sandbox.repoPath}".`,
    'There is no terminal tab to close, no orchestrator and no other agents: skip any step that closes a tab, kills a process, or messages another agent or session.',
    `${STUBBED_COMMANDS.join(', ')} are stubbed for this run; use them normally.`
  ].join(' ')

// The sandbox replaces the search path's home, so the agent's own CLI —
// usually in the real ~/.local/bin — is resolved up front.
const resolveCommand = (command: string): string => {
  const realSearchDirectories = [path.join(homedir(), '.local', 'bin'), path.join(homedir(), '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin']
  const pathDirectories = (process.env.PATH ?? '').split(':')
  const candidates = [...realSearchDirectories, ...pathDirectories].map((directory) => path.join(directory, command))
  return candidates.find((candidate) => existsSync(candidate)) ?? command
}

export const evalAgent = (): Agent => findAgent(availableAgents({}), process.env.EVAL_AGENT)

export const runCaseAgent = async (sandbox: Sandbox, evalCase: EvalCase) => {
  const agent = evalAgent()
  const lane = laneById(evalCase.laneId)
  const ticket = ticketFromCase(evalCase)
  const context = { projectPath: sandbox.repoPath, databasePath: sandbox.databasePath }
  const lanePrompt = ticketAgentPrompt(ticket, lane, context)
  const preamble = evalPreamble(sandbox)
  // Claude Code takes the preamble as system prompt; other CLIs have no
  // common flag for it, so it leads their prompt instead.
  const usesClaudeFlags = agent.id === DEFAULT_AGENT.id
  // Defaults stay the production args so evals catch permission gaps the Run
  // button has too; EVAL_EXTRA_ARGS (e.g. `--allowedTools Bash(sqlite3:*)`)
  // grades the prompt past them.
  const extraArgs = (process.env.EVAL_EXTRA_ARGS ?? '').split(/\s+/).filter(Boolean)
  const productionArgs = [...agent.headlessArgs, ...extraArgs]
  // stream-json records every tool call, which is what the judge grades process from.
  const claudeArgs = ['--append-system-prompt', preamble, '--output-format', 'stream-json', '--verbose']
  const headlessArgs = usesClaudeFlags ? [...productionArgs, ...claudeArgs] : productionArgs
  const prompt = usesClaudeFlags ? lanePrompt : `${preamble}\n\n${lanePrompt}`
  const resolvedAgent = { ...agent, command: resolveCommand(agent.command), headlessArgs }
  const agentRun = await runAgentHeadless(resolvedAgent, prompt, sandbox.repoPath, sandbox.searchHome)
  if (!usesClaudeFlags) return { succeeded: agentRun.succeeded, finalMessage: agentRun.output, trajectory: [] }

  const { steps, finalMessage } = parseTrajectory(agentRun.output)
  // A run that died before its result event still shows why, from the raw output.
  const finalOrRaw = finalMessage || agentRun.output
  return { succeeded: agentRun.succeeded, finalMessage: finalOrRaw, trajectory: steps }
}

export type CaseAgentRun = Awaited<ReturnType<typeof runCaseAgent>>

const EVIDENCE_SECTION_CHARACTERS = 12_000

// Long sections keep their start and end: setup and the final steps are where
// the graded decisions usually sit.
const clip = (text: string) => {
  if (text.length <= EVIDENCE_SECTION_CHARACTERS) return text
  const half = EVIDENCE_SECTION_CHARACTERS / 2
  return `${text.slice(0, half)}\n…[clipped]…\n${text.slice(-half)}`
}

const TICKET_EVIDENCE_COLUMNS = ['lane_id', 'title', 'description', 'branch_name', 'worktree_path', 'pull_request_url', 'version', 'checklist_json']

const ticketSnapshot = (row: Row | undefined) =>
  row ? TICKET_EVIDENCE_COLUMNS.map((column) => `${column}: ${String(row[column] ?? '')}`).join('\n') : '(ticket deleted)'

const agentCommits = (sandbox: Sandbox) => {
  const log = git(sandbox.repoPath, 'log', '--all', '-p', '--format=commit %h%d %s', '--not', sandbox.baselineCommit)
  return log.toString().trim() || '(no new commits)'
}

export const collectEvidence = (sandbox: Sandbox, evalCase: EvalCase, seededRow: Row, agentRun: CaseAgentRun): string => {
  const database = new DatabaseSync(sandbox.databasePath, { readOnly: true })
  const ticketId = ticketFromCase(evalCase).id
  const finalRow = database.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as Row | undefined
  const moveRows = database.prepare('SELECT from_lane, to_lane FROM eval_moves WHERE ticket_id = ?').all(ticketId) as Row[]
  database.close()
  const moves = moveRows.map((row) => `${String(row.from_lane)} → ${String(row.to_lane)}`).join('\n') || '(none)'
  const sections: [string, string][] = [
    ['Lane prompt the agent was given', laneById(evalCase.laneId).agentPrompt],
    ['Ticket before the run', ticketSnapshot(seededRow)],
    ['Ticket after the run', ticketSnapshot(finalRow)],
    ['Lane moves', moves],
    ['Stubbed command calls (gh, mise, osascript)', readFileSync(sandbox.stubLogPath, 'utf8').trim() || '(none)'],
    ['New git commits', agentCommits(sandbox)],
    ['Agent tool-call trajectory', agentRun.trajectory.join('\n') || '(not captured)'],
    ["Agent's final message", agentRun.finalMessage]
  ]
  return sections.map(([title, body]) => `## ${title}\n${clip(body)}`).join('\n\n')
}

type Row = Record<string, unknown>

const isNonEmpty = (value: unknown) => typeof value === 'string' && value.trim() !== ''

export const gradeCase = (sandbox: Sandbox, evalCase: EvalCase, seededRow: Row): string[] => {
  const database = new DatabaseSync(sandbox.databasePath, { readOnly: true })
  const ticketId = ticketFromCase(evalCase).id
  const ticketRow = database.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as Row | undefined
  const moveRows = database.prepare('SELECT to_lane FROM eval_moves WHERE ticket_id = ?').all(ticketId) as Row[]
  database.close()
  if (!ticketRow) return ['ticket row is gone']

  const failures: string[] = []
  const { endLane, moves, fields = {}, stubCalls = [] } = evalCase.expect
  if (ticketRow.lane_id !== endLane) failures.push(`end lane ${String(ticketRow.lane_id)}, expected ${endLane}`)
  if (moves !== undefined && moveRows.length !== moves) {
    const movePath = moveRows.map((row) => row.to_lane).join(' → ') || 'none'
    failures.push(`${moveRows.length} moves (${movePath}), expected ${moves}`)
  }
  for (const [column, check] of Object.entries(fields)) {
    const value = ticketRow[column]
    if (check === 'nonEmpty' && !isNonEmpty(value)) failures.push(`${column} is empty`)
    if (check === 'changed' && value === seededRow[column]) failures.push(`${column} unchanged`)
  }
  const stubLog = readFileSync(sandbox.stubLogPath, 'utf8')
  for (const expectedCall of stubCalls) {
    if (!stubLog.includes(expectedCall)) failures.push(`no stub call matching "${expectedCall}"`)
  }
  return failures
}

export const readSeededRow = (sandbox: Sandbox, evalCase: EvalCase): Row => {
  const database = new DatabaseSync(sandbox.databasePath, { readOnly: true })
  const row = database.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketFromCase(evalCase).id) as Row
  database.close()
  return row
}

// Rows any misdirected eval write would touch: the eval ticket's number, or a
// sandbox project path. Watching only these keeps the guard quiet while the
// real board's own agents write to it in parallel.
export const realDatabaseStrayRows = (): number | undefined => {
  if (!existsSync(REAL_DATABASE_PATH)) return undefined
  const database = new DatabaseSync(REAL_DATABASE_PATH, { readOnly: true })
  const row = database
    .prepare('SELECT count(*) AS stray FROM tickets WHERE number = ? OR project_path LIKE ?')
    .get(EVAL_TICKET_NUMBER, `${SANDBOX_PREFIX}%`) as Row
  database.close()
  return Number(row.stray)
}
