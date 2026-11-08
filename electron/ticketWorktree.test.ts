import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureTicketWorktree, freshMainRef, repositoryRootOf, ticketWorktreePath } from './ticketWorktree.js'

// Runs real git against throwaway repos: the behaviour under test is git's.
const runGit = (repositoryPath: string, ...args: string[]) =>
  execFileSync('git', ['-C', repositoryPath, ...args], { encoding: 'utf8' }).trim()
const commit = (repositoryPath: string, message: string) =>
  runGit(repositoryPath, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', message)

// A bare "origin", the user's checkout cloned from it, and a second clone that
// stands in for teammates pushing to main after the checkout last pulled.
describe('ticket worktrees', () => {
  let scratch: string
  let originPath: string
  let checkoutPath: string
  let teammatePath: string

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), 'ticket-worktree-'))
    originPath = path.join(scratch, 'origin.git')
    checkoutPath = path.join(scratch, 'checkout')
    teammatePath = path.join(scratch, 'teammate')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', originPath])
    execFileSync('git', ['clone', '-q', originPath, teammatePath])
    commit(teammatePath, 'init')
    runGit(teammatePath, 'push', '-q', 'origin', 'main')
    execFileSync('git', ['clone', '-q', originPath, checkoutPath])
  })

  afterEach(() => rmSync(scratch, { recursive: true, force: true }))

  const setUp = async () => {
    const root = await repositoryRootOf(checkoutPath)
    return { root, baseRef: await freshMainRef(root) }
  }

  it('branches from freshly fetched main, not the stale local checkout', async () => {
    commit(teammatePath, 'landed after the checkout last pulled')
    runGit(teammatePath, 'push', '-q', 'origin', 'main')
    const remoteMainSha = runGit(teammatePath, 'rev-parse', 'HEAD')

    const { root, baseRef } = await setUp()
    const worktree = await ensureTicketWorktree(root, 1, 'ticket-1', baseRef)
    expect(baseRef).toBe('origin/main')
    expect(runGit(worktree, 'rev-parse', 'HEAD')).toBe(remoteMainSha)
    expect(runGit(checkoutPath, 'rev-parse', 'HEAD')).not.toBe(remoteMainSha)
  })

  // Tracking origin/main would make a bare `git push` from the worktree aim at main.
  it('does not set the new branch to track main', async () => {
    const { root, baseRef } = await setUp()
    const worktree = await ensureTicketWorktree(root, 2, 'ticket-2', baseRef)
    expect(() => runGit(worktree, 'rev-parse', '--abbrev-ref', '@{upstream}')).toThrow()
  })

  it('gives each ticket its own worktree on its own branch', async () => {
    const { root, baseRef } = await setUp()
    const first = await ensureTicketWorktree(root, 3, 'ticket-3-first', baseRef)
    const second = await ensureTicketWorktree(root, 4, 'ticket-4-second', baseRef)
    expect(first).not.toBe(second)
    expect(runGit(first, 'branch', '--show-current')).toBe('ticket-3-first')
    expect(runGit(second, 'branch', '--show-current')).toBe('ticket-4-second')
  })

  it('reuses the worktree on a re-run instead of failing', async () => {
    const { root, baseRef } = await setUp()
    const created = await ensureTicketWorktree(root, 5, 'ticket-5', baseRef)
    await expect(ensureTicketWorktree(root, 5, 'ticket-5', baseRef)).resolves.toBe(created)
  })

  it('reuses a worktree that already holds the branch at another path', async () => {
    const { root, baseRef } = await setUp()
    const legacyPath = path.join(root, '.worktrees', 'ticket-10')
    runGit(root, 'worktree', 'add', '-q', '-b', 'ticket-10-legacy', legacyPath, baseRef)
    const worktree = await ensureTicketWorktree(root, 10, 'ticket-10-legacy', baseRef)
    expect(realpathSync(worktree)).toBe(realpathSync(legacyPath))
  })

  it('recreates a worktree whose directory was deleted by hand', async () => {
    const { root, baseRef } = await setUp()
    const created = await ensureTicketWorktree(root, 11, 'ticket-11', baseRef)
    rmSync(created, { recursive: true, force: true })
    await expect(ensureTicketWorktree(root, 11, 'ticket-11', baseRef)).resolves.toBe(created)
    expect(runGit(created, 'branch', '--show-current')).toBe('ticket-11')
  })

  it('checks out an existing branch rather than recreating it', async () => {
    runGit(checkoutPath, 'branch', 'feature/already-here')
    const { root, baseRef } = await setUp()
    const worktree = await ensureTicketWorktree(root, 6, 'feature/already-here', baseRef)
    expect(runGit(worktree, 'branch', '--show-current')).toBe('feature/already-here')
  })

  it('keeps the worktrees out of the main checkout status, excluding them once', async () => {
    const { root, baseRef } = await setUp()
    await ensureTicketWorktree(root, 7, 'ticket-7', baseRef)
    await ensureTicketWorktree(root, 8, 'ticket-8', baseRef)
    expect(runGit(checkoutPath, 'status', '--porcelain')).toBe('')
    const exclude = readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.split('\n').filter((line) => line === '/.worktrees/')).toHaveLength(1)
  })

  it('refuses a branch name git would reject, before touching the disk', async () => {
    const { root, baseRef } = await setUp()
    await expect(ensureTicketWorktree(root, 9, 'bad..name', baseRef)).rejects.toThrow('not a valid branch name')
    expect(existsSync(ticketWorktreePath(root, 9))).toBe(false)
  })

  it('falls back to local main when the project has no origin', async () => {
    runGit(checkoutPath, 'remote', 'remove', 'origin')
    const { baseRef } = await setUp()
    expect(baseRef).toBe('main')
  })

  it('says so when the project is not a git repository', async () => {
    const notARepository = mkdtempSync(path.join(tmpdir(), 'not-a-repo-'))
    await expect(repositoryRootOf(notARepository)).rejects.toThrow('git repository')
    rmSync(notARepository, { recursive: true, force: true })
  })
})
