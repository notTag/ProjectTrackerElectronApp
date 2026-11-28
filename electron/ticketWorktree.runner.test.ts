import { describe, expect, it } from 'vitest'

import { ensureTicketWorktree, type MachineRunner } from './ticketWorktree.js'

const REPOSITORY_ROOT = '/repo'
const WORKTREE_PATH = '/repo/.worktrees/t3'
const MAIN_ONLY_PORCELAIN = 'worktree /repo\nHEAD abc\nbranch refs/heads/main'

const fakeRunner = (options: { existingBranch?: boolean; existingPaths?: string[] } = {}) => {
  const gitCalls: string[][] = []
  const existingPaths = new Set(options.existingPaths ?? [])
  const stdoutFor = (gitArgs: string[]) => {
    const command = gitArgs.join(' ')
    if (command === 'rev-parse --path-format=absolute --git-common-dir') return '/repo/.git\n'
    if (command === 'worktree list --porcelain') return MAIN_ONLY_PORCELAIN
    if (command === 'rev-parse --verify --quiet refs/heads/ticket-3' && !options.existingBranch) {
      throw new Error('no such branch')
    }
    return ''
  }
  const runner: MachineRunner = {
    run: async (args) => {
      const gitArgs = args.slice(2)
      gitCalls.push(gitArgs)
      return stdoutFor(gitArgs)
    },
    pathExists: (filePath) => existingPaths.has(filePath),
    readText: () => '',
    appendText: () => {}
  }
  return { runner, gitCalls }
}

const SHARED_PREFIX = [
  ['check-ref-format', '--branch', 'ticket-3'],
  ['rev-parse', '--path-format=absolute', '--git-common-dir']
]
const LOOKUP_CALLS = [
  ['worktree', 'prune'],
  ['worktree', 'list', '--porcelain'],
  ['rev-parse', '--verify', '--quiet', 'refs/heads/ticket-3']
]

describe('ensureTicketWorktree on an injected runner', () => {
  it('creates a new branch from the base ref', async () => {
    const { runner, gitCalls } = fakeRunner()
    await expect(ensureTicketWorktree(REPOSITORY_ROOT, 3, 'ticket-3', 'origin/main', runner)).resolves.toBe(WORKTREE_PATH)
    expect(gitCalls).toEqual([
      ...SHARED_PREFIX,
      ...LOOKUP_CALLS,
      ['worktree', 'add', '--no-track', '-b', 'ticket-3', WORKTREE_PATH, 'origin/main']
    ])
  })

  it('checks out an existing branch as-is', async () => {
    const { runner, gitCalls } = fakeRunner({ existingBranch: true })
    await ensureTicketWorktree(REPOSITORY_ROOT, 3, 'ticket-3', 'origin/main', runner)
    expect(gitCalls).toEqual([...SHARED_PREFIX, ...LOOKUP_CALLS, ['worktree', 'add', WORKTREE_PATH, 'ticket-3']])
  })

  it('reuses a worktree that is already there without touching git again', async () => {
    const { runner, gitCalls } = fakeRunner({ existingPaths: [`${WORKTREE_PATH}/.git`] })
    await expect(ensureTicketWorktree(REPOSITORY_ROOT, 3, 'ticket-3', 'origin/main', runner)).resolves.toBe(WORKTREE_PATH)
    expect(gitCalls).toEqual(SHARED_PREFIX)
  })

  it('sends every git call with -C at the repository root', async () => {
    const recordedArgs: string[][] = []
    const { runner } = fakeRunner()
    const recordingRunner: MachineRunner = {
      ...runner,
      run: (args) => {
        recordedArgs.push(args)
        return runner.run(args)
      }
    }
    await ensureTicketWorktree(REPOSITORY_ROOT, 3, 'ticket-3', 'origin/main', recordingRunner)
    expect(recordedArgs.every((args) => args[0] === '-C' && args[1] === REPOSITORY_ROOT)).toBe(true)
  })
})
