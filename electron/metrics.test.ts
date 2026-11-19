import { describe, expect, it } from 'vitest'

import { ticketSessionName, type Ticket } from '../src/shared/projectTypes.js'
import { countAgentsByProject, metricWindows, parseLsofCwds, parseTicketAgentPids, prCounts } from './metrics.js'

describe('metricWindows', () => {
  it('starts today, the month and the year at local midnight; the week is a rolling 7×24h', () => {
    const now = new Date(2026, 10, 9, 15, 30) // 9 Nov 2026, 15:30 local
    const windows = metricWindows(now)
    expect(windows.today).toBe(new Date(2026, 10, 9).toISOString())
    expect(windows.week).toBe(new Date(now.getTime() - 7 * 86_400_000).toISOString())
    expect(windows.month).toBe(new Date(2026, 10, 1).toISOString())
    expect(windows.year).toBe(new Date(2026, 0, 1).toISOString())
  })

  it('on the 1st of January every calendar window starts at the same midnight', () => {
    const windows = metricWindows(new Date(2026, 0, 1, 0, 5))
    expect(windows.today).toBe(windows.month)
    expect(windows.month).toBe(windows.year)
  })
})

describe('agent process discovery', () => {
  const sessionName = (number: number) => ticketSessionName({ number } as Ticket)

  it('picks only processes the app launched for a ticket, keyed to that ticket number', () => {
    const psOutput = [
      `  101 claude --name t104 --name ${sessionName(104)} --session-id abc Instructions: do it`,
      `  102 /Users/me/.local/bin/claude --name ${sessionName(7)}`,
      `  103 claude --name ${sessionName(10)} --model opus`,
      '  201 claude --model opus --name AUTORUN-ORCHESTRATOR-IDEA',
      '  202 /Applications/Codex.app/Contents/Resources/codex app-server daemon',
      '  203 codex app-server --listen stdio',
      '  204 claude',
      '  205 claude -p fix the bug',
      `  206 zsh -c claude --name ${sessionName(5)}`,
      `  207 claude --name ${sessionName(12)}abc`, // number must end the name
      ''
    ].join('\n')
    expect(parseTicketAgentPids(psOutput)).toEqual(
      new Map([
        ['101', 104],
        ['102', 7],
        ['103', 10]
      ])
    )
  })

  it('reads pid and cwd pairs out of lsof -Fpn output, spaces included', () => {
    const lsofOutput = 'p101\nfcwd\nn/Users/me/Code/app\np102\nfcwd\nn/Users/me/My Projects/site\n'
    expect(parseLsofCwds(lsofOutput)).toEqual([
      { pid: '101', cwd: '/Users/me/Code/app' },
      { pid: '102', cwd: '/Users/me/My Projects/site' }
    ])
  })

  it('counts distinct tickets per project, worktrees included, nested projects separately', () => {
    const projects = ['/code/app', '/code/app/packages/cli', '/code/other']
    const agents = [
      { cwd: '/code/app', ticketNumber: 1 },
      { cwd: '/code/app/.worktrees/t27', ticketNumber: 27 },
      { cwd: '/code/app/.worktrees/t27', ticketNumber: 27 }, // a second session for the same ticket
      { cwd: '/code/app/packages/cli/src', ticketNumber: 1 }, // same number, different project
      { cwd: '/code/other', ticketNumber: 1 },
      { cwd: '/code/application', ticketNumber: 9 }, // a sibling sharing the prefix, not a subfolder
      { cwd: '/Users/me', ticketNumber: 9 }
    ]
    expect(countAgentsByProject(agents, projects)).toEqual({
      '/code/app': 2,
      '/code/app/packages/cli': 1,
      '/code/other': 1
    })
  })
})

describe('prCounts', () => {
  it('asks GitHub search, in one GraphQL request, for open PRs plus merged PRs since each window start', async () => {
    const requests: { apiPath: string; variables: Record<string, string> }[] = []
    const requestGithub = async <T,>(apiPath: string, body?: unknown) => {
      const { variables } = body as { variables: Record<string, string> }
      requests.push({ apiPath, variables })
      const issueCounts = Object.keys(variables).map((key, index) => [key, { issueCount: index + 1 }])
      return { data: Object.fromEntries(issueCounts) } as T
    }
    const windows = {
      today: '2026-11-09T05:00:00.000Z',
      week: '2026-11-02T20:30:00.000Z',
      month: '2026-11-01T04:00:00.000Z',
      year: '2026-01-01T05:00:00.000Z'
    }
    const result = await prCounts('owner', 'repo', windows, requestGithub)
    expect(requests).toEqual([
      {
        apiPath: '/graphql',
        variables: {
          open: 'repo:owner/repo is:pr is:open',
          today: 'repo:owner/repo is:pr is:merged merged:>=2026-11-09T05:00:00+00:00',
          week: 'repo:owner/repo is:pr is:merged merged:>=2026-11-02T20:30:00+00:00',
          month: 'repo:owner/repo is:pr is:merged merged:>=2026-11-01T04:00:00+00:00',
          year: 'repo:owner/repo is:pr is:merged merged:>=2026-01-01T05:00:00+00:00'
        }
      }
    ])
    expect(result).toEqual({ open: 1, merged: { today: 2, week: 3, month: 4, year: 5 } })
  })

  it('turns a GraphQL error (e.g. a repo it cannot see) into a thrown message for that row', async () => {
    const requestGithub = async <T,>() => ({ errors: [{ message: 'Could not resolve to a Repository' }] }) as T
    const windows = { today: '', week: '', month: '', year: '' }
    await expect(prCounts('owner', 'gone', windows, requestGithub)).rejects.toThrow('Could not resolve')
  })
})
