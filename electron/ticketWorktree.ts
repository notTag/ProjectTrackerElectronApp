/**
 * Gives each Auto Run ticket its own git worktree and branch, so agents working
 * a lane in parallel never write into the same checkout or the same diff.
 *
 * Kept out of main.ts — which cannot be imported under test because it touches
 * the Electron app object at module load — so it can run against a real
 * throwaway repo in tests.
 */

import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Inside the project rather than beside it: sibling directories would be picked
// up by the project scanner as new projects. Excluded locally (never committed)
// so the worktrees stay out of the main checkout's git status.
export const TICKET_WORKTREE_DIRECTORY = '.worktrees'
const EXCLUDE_ENTRY = `/${TICKET_WORKTREE_DIRECTORY}/`

// A fetch must never sit waiting on a credential prompt nobody can see: with no
// terminal attached, git fails fast instead, and the timeout covers a dead remote.
const GIT_TIMEOUT_MS = 60 * 1000
const gitEnvironment = { ...process.env, GIT_TERMINAL_PROMPT: '0' }

const git = async (repositoryPath: string, args: string[]): Promise<string> => {
  const options = { env: gitEnvironment, timeout: GIT_TIMEOUT_MS }
  const { stdout } = await execFileAsync('git', ['-C', repositoryPath, ...args], options)
  return stdout.trim()
}

const gitErrorMessage = (error: unknown) => (error as { stderr?: string }).stderr?.trim() || String(error)

const gitSucceeds = (repositoryPath: string, args: string[]) =>
  git(repositoryPath, args).then(
    () => true,
    () => false
  )

export const ticketWorktreePath = (repositoryRoot: string, ticketNumber: number) =>
  path.join(repositoryRoot, TICKET_WORKTREE_DIRECTORY, `t${ticketNumber}`)

const excludeWorktreeDirectory = async (repositoryRoot: string) => {
  const commonGitDirectory = await git(repositoryRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const excludePath = path.join(commonGitDirectory, 'info', 'exclude')
  const excludeText = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
  const alreadyExcluded = excludeText.split('\n').includes(EXCLUDE_ENTRY)
  if (alreadyExcluded) return
  const separator = excludeText === '' || excludeText.endsWith('\n') ? '' : '\n'
  appendFileSync(excludePath, `${separator}${EXCLUDE_ENTRY}\n`, 'utf8')
}

export const repositoryRootOf = async (projectPath: string): Promise<string> => {
  try {
    return await git(projectPath, ['rev-parse', '--show-toplevel'])
  } catch {
    throw new Error('Auto Run needs the project to be a git repository.')
  }
}

const LOCAL_DEFAULT_BRANCH = 'main'

// New ticket branches start from the remote's default branch as of right now,
// never from whatever the main checkout happens to have checked out. Fetched
// once per Auto Run, not once per ticket. A project with no origin has nothing
// to fetch, so its local main is the freshest main there is.
export const freshMainRef = async (repositoryRoot: string): Promise<string> => {
  const remotes = (await git(repositoryRoot, ['remote'])).split('\n')
  if (!remotes.includes('origin')) {
    const hasLocalMain = await gitSucceeds(repositoryRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${LOCAL_DEFAULT_BRANCH}`])
    if (!hasLocalMain) throw new Error(`Auto Run needs an origin remote or a local "${LOCAL_DEFAULT_BRANCH}" branch.`)
    return LOCAL_DEFAULT_BRANCH
  }

  try {
    await git(repositoryRoot, ['fetch', '--quiet', 'origin'])
  } catch (error) {
    throw new Error(`Could not fetch origin — ${gitErrorMessage(error)}`)
  }
  // origin/HEAD names the remote's default branch, but only once a clone or
  // `git remote set-head` has recorded it; origin/main covers repos where it hasn't.
  const remoteDefault = await git(repositoryRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')
  if (remoteDefault) return remoteDefault
  const fallbackRef = `origin/${LOCAL_DEFAULT_BRANCH}`
  const hasFallback = await gitSucceeds(repositoryRoot, ['rev-parse', '--verify', '--quiet', `refs/remotes/${fallbackRef}`])
  if (!hasFallback) throw new Error('Could not tell which branch is origin\'s default. Run `git remote set-head origin --auto`.')
  return fallbackRef
}

// git refuses to check one branch out in two worktrees, so a branch already
// checked out elsewhere (a worktree from before the tN directory naming, or one
// made by hand) is reused where it lives. The main checkout never counts: agents
// must not write into it.
const linkedWorktreeHoldingBranch = async (repositoryRoot: string, branchName: string) => {
  const porcelain = await git(repositoryRoot, ['worktree', 'list', '--porcelain'])
  const worktreeEntries = porcelain.split('\n\n')
  const branchLine = `branch refs/heads/${branchName}`
  const holdingEntry = worktreeEntries.find((entry) => entry.split('\n').includes(branchLine))
  if (!holdingEntry) return null
  const holdingPath = holdingEntry.split('\n')[0].replace(/^worktree /, '')
  const isMainCheckout = path.resolve(holdingPath) === path.resolve(repositoryRoot)
  return isMainCheckout ? null : holdingPath
}

// Re-running Auto Run on the same ticket reuses its worktree, so an agent picks
// up where the last one left off instead of failing on "already exists". An
// existing branch is checked out as-is; only brand-new branches use baseRef.
// ponytail: a reused worktree is trusted as-is; check its branch matches if
// tickets ever get renamed mid-flight.
export const ensureTicketWorktree = async (
  repositoryRoot: string,
  ticketNumber: number,
  branchName: string,
  baseRef: string
): Promise<string> => {
  const branchNameIsValid = await gitSucceeds(repositoryRoot, ['check-ref-format', '--branch', branchName])
  if (!branchNameIsValid) throw new Error(`#${ticketNumber}: "${branchName}" is not a valid branch name.`)

  await excludeWorktreeDirectory(repositoryRoot)
  const worktreePath = ticketWorktreePath(repositoryRoot, ticketNumber)
  if (existsSync(path.join(worktreePath, '.git'))) return worktreePath

  // Drops registrations whose directory was deleted by hand; otherwise git
  // still counts their branch as checked out and refuses to add it again.
  await git(repositoryRoot, ['worktree', 'prune'])
  const existingWorktree = await linkedWorktreeHoldingBranch(repositoryRoot, branchName)
  if (existingWorktree) return existingWorktree

  const branchExists = await gitSucceeds(repositoryRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`])
  const addArgs = branchExists
    ? ['worktree', 'add', worktreePath, branchName]
    : ['worktree', 'add', '--no-track', '-b', branchName, worktreePath, baseRef]
  try {
    await git(repositoryRoot, addArgs)
  } catch (error) {
    throw new Error(`#${ticketNumber}: could not create worktree — ${gitErrorMessage(error)}`)
  }
  return worktreePath
}
