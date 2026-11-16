import { execFile } from 'node:child_process'

import type { MetricWindows, ProjectPrMetrics } from '../src/shared/projectTypes.js'

// Local time on purpose: "today" and "this month" mean the user's calendar,
// not UTC's. The week is rolling, so it ignores the calendar.
export const metricWindows = (now: Date): MetricWindows => {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  return {
    today: startOfToday.toISOString(),
    week: sevenDaysAgo.toISOString(),
    month: startOfMonth.toISOString(),
    year: startOfYear.toISOString()
  }
}

const WINDOW_KEYS = ['today', 'week', 'month', 'year'] as const

// GitHub search takes an explicit offset; second precision is all it accepts.
const githubSearchDate = (isoTimestamp: string) => `${isoTimestamp.slice(0, 19)}+00:00`

type CountKey = 'open' | (typeof WINDOW_KEYS)[number]
type GraphqlCounts = Record<CountKey, { issueCount: number }>

interface GraphqlResponse {
  data?: GraphqlCounts
  errors?: { message: string }[]
}

const COUNT_KEYS: CountKey[] = ['open', ...WINDOW_KEYS]
const countFields = COUNT_KEYS.map((key) => `${key}: search(query: $${key}, type: ISSUE) { issueCount }`)
const countVariables = COUNT_KEYS.map((key) => `$${key}: String!`)
const PR_COUNTS_QUERY = `query(${countVariables.join(', ')}) { ${countFields.join(' ')} }`

// One GraphQL request per repo carries all five counts. REST search would be
// five calls each against its 30/min limit, which the dashboard passes at ~6 repos.
export const prCounts = async (
  owner: string,
  repo: string,
  windows: MetricWindows,
  requestGithub: <T>(apiPath: string, body?: unknown) => Promise<T>
): Promise<ProjectPrMetrics> => {
  const repoPrs = `repo:${owner}/${repo} is:pr`
  const mergedSince = (key: (typeof WINDOW_KEYS)[number]) =>
    `${repoPrs} is:merged merged:>=${githubSearchDate(windows[key])}`
  const variables = {
    open: `${repoPrs} is:open`,
    today: mergedSince('today'),
    week: mergedSince('week'),
    month: mergedSince('month'),
    year: mergedSince('year')
  }

  const response = await requestGithub<GraphqlResponse>('/graphql', { query: PR_COUNTS_QUERY, variables })
  const firstError = response.errors?.[0]
  if (firstError || !response.data) throw new Error(firstError?.message ?? 'GitHub returned no PR counts.')

  const counts = response.data
  return {
    open: counts.open.issueCount,
    merged: {
      today: counts.today.issueCount,
      week: counts.week.issueCount,
      month: counts.month.issueCount,
      year: counts.year.issueCount
    }
  }
}

// Built-in agent binaries (projectTypes.ts DEFAULT_AGENT and friends). Custom
// agents with other binaries aren't counted.
export const AGENT_PROCESS_NAMES = ['claude', 'codex', 'hermes']

// `ps -o comm` reports argv[0], which stays `claude` for the native installer
// even though the kernel name lsof's -c matches is the version (`2.1.322`).
export const parseAgentPids = (psOutput: string, processNames: string[]): string[] => {
  const pids: string[] = []
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line)
    if (!match) continue
    const [, pid, command] = match
    const executableName = command.trim().split('/').pop() ?? ''
    if (processNames.includes(executableName)) pids.push(pid)
  }
  return pids
}

// `lsof -Fpn` prints a `p<pid>` line, then `f<fd>` and `n<path>` lines for it.
export const parseLsofCwds = (lsofOutput: string): string[] => {
  const cwds: string[] = []
  for (const line of lsofOutput.split('\n')) {
    if (line.startsWith('n')) cwds.push(line.slice(1))
  }
  return cwds
}

// The longest matching path wins, so a project nested in another project's
// folder gets its own agents. Worktrees under <project>/.worktrees match too.
export const countAgentsByProject = (cwds: string[], projectPaths: string[]): Record<string, number> => {
  const counts = Object.fromEntries(projectPaths.map((projectPath) => [projectPath, 0]))
  const longestFirst = [...projectPaths].sort((a, b) => b.length - a.length)
  for (const cwd of cwds) {
    const owner = longestFirst.find((projectPath) => cwd === projectPath || cwd.startsWith(`${projectPath}/`))
    if (owner) counts[owner] += 1
  }
  return counts
}

const runForOutput = (command: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(command, args, { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      // lsof exits 1 when a listed pid has already exited but still prints the
      // rest. Any other failure (a timeout kill included) would be an undercount.
      const isPartialListing = error?.code === 1 && stdout !== ''
      if (error && !isPartialListing) return reject(error)
      resolve(stdout)
    })
  })

export const runningAgentsByProject = async (projectPaths: string[]): Promise<Record<string, number>> => {
  const psOutput = await runForOutput('/bin/ps', ['-axo', 'pid=,comm='])
  const agentPids = parseAgentPids(psOutput, AGENT_PROCESS_NAMES)
  if (agentPids.length === 0) return countAgentsByProject([], projectPaths)
  const lsofOutput = await runForOutput('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-p', agentPids.join(','), '-Fpn'])
  return countAgentsByProject(parseLsofCwds(lsofOutput), projectPaths)
}
