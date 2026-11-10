import { describe, expect, it } from 'vitest'

import {
  AGENT_PROCESS_NAMES,
  countAgentsByProject,
  metricWindows,
  parseAgentPids,
  parseLsofCwds,
  prCounts
} from './metrics.js'

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
  it('picks agent pids by argv[0] basename, whatever the install path', () => {
    const psOutput = [
      '  101 claude',
      '  102 /Users/me/.vscode/extensions/claude-code/native-binary/claude',
      '  103 node',
      '  104 /opt/homebrew/bin/codex',
      '  105 claude-helper',
      '  106 hermes',
      ''
    ].join('\n')
    expect(parseAgentPids(psOutput, AGENT_PROCESS_NAMES)).toEqual(['101', '102', '104', '106'])
  })

  it('reads cwd paths out of lsof -Fpn output, spaces included', () => {
    const lsofOutput = 'p101\nfcwd\nn/Users/me/Code/app\np102\nfcwd\nn/Users/me/My Projects/site\n'
    expect(parseLsofCwds(lsofOutput)).toEqual(['/Users/me/Code/app', '/Users/me/My Projects/site'])
  })

  it('counts worktrees for their project and gives nested projects their own agents', () => {
    const projects = ['/code/app', '/code/app/packages/cli', '/code/other']
    const cwds = [
      '/code/app',
      '/code/app/.worktrees/t27',
      '/code/app/packages/cli/src',
      '/code/application', // a sibling sharing the prefix, not a subfolder
      '/Users/me'
    ]
    expect(countAgentsByProject(cwds, projects)).toEqual({
      '/code/app': 2,
      '/code/app/packages/cli': 1,
      '/code/other': 0
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
