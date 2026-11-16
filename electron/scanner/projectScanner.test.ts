import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { hasReadme, scanProjectDirectories, toGithubUrl } from './projectScanner'

let tempRoot: string | undefined
const lockedDirectories: string[] = []

const makeTempRoot = () => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'project-tracker-scanner-'))
  return tempRoot
}

const makeProject = (directory: string) => {
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'package.json'), '{}')
}

const projectNames = async (directories: string[]) =>
  (await scanProjectDirectories(directories, [], [])).snapshot.projects.map((project) => project.name)

afterEach(() => {
  for (const directory of lockedDirectories.splice(0)) chmodSync(directory, 0o755)
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

describe('project scanner failures', () => {
  it('a missing root becomes one failure and the other roots still scan', async () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'app'))
    const missing = path.join(root, 'does-not-exist')

    const result = await scanProjectDirectories([missing, root], [], [])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].path).toBe(missing)
    expect(result.failures[0].message).toMatch(/ENOENT/)
    expect(result.snapshot.projects.map((project) => project.name)).toEqual(['app'])
  })

  it('a root that is a file is reported as not a directory', async () => {
    const root = makeTempRoot()
    const file = path.join(root, 'notes.txt')
    writeFileSync(file, 'hi')

    const result = await scanProjectDirectories([file], [], [])
    expect(result.failures).toEqual([{ path: file, message: 'Path is not a directory.' }])
    expect(result.snapshot.projects).toEqual([])
  })

  // root reads through any permission bits, so there is nothing to fail.
  it.skipIf(process.getuid?.() === 0)('an unreadable subdirectory fails alone; its siblings are still found', async () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'app'))
    const locked = path.join(root, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o000)
    lockedDirectories.push(locked)

    const result = await scanProjectDirectories([root], [], [])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].path).toBe(locked)
    expect(result.failures[0].message).toMatch(/EACCES/)
    expect(result.snapshot.projects.map((project) => project.name)).toEqual(['app'])
  })
})

describe('project scanner on large trees', () => {
  it('finds projects four levels down and nothing deeper', async () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'a', 'b', 'c', 'd'))
    makeProject(path.join(root, 'w', 'x', 'y', 'z', 'too-deep'))

    expect(await projectNames([root])).toEqual(['a/b/c/d'])
  })

  it('ignores markers inside node_modules, build output and dot-directories', async () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'loose', 'node_modules', 'left-pad'))
    makeProject(path.join(root, 'loose', 'dist', 'bundle'))
    makeProject(path.join(root, '.hidden', 'app'))

    expect(await projectNames([root])).toEqual([])
  })

  it('follows a symlink that points at a directory', async () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'elsewhere', 'app'))
    mkdirSync(path.join(root, 'scan'))
    symlinkSync(path.join(root, 'elsewhere', 'app'), path.join(root, 'scan', 'linked'))

    expect(await projectNames([path.join(root, 'scan')])).toEqual(['linked'])
  })

  it('stops at the first project marker instead of walking into the project', async () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'monorepo'))
    makeProject(path.join(root, 'monorepo', 'packages', 'cli'))

    expect(await projectNames([root])).toEqual(['monorepo'])
  })

  it('matches markers in any case, like the case-insensitive filesystem does', async () => {
    const root = makeTempRoot()
    mkdirSync(path.join(root, 'rusty'))
    writeFileSync(path.join(root, 'rusty', 'cargo.toml'), '')
    mkdirSync(path.join(root, 'webby'))
    writeFileSync(path.join(root, 'webby', 'Package.json'), '{}')

    expect(await projectNames([root])).toEqual(['rusty', 'webby'])
  })

  it('returns every project in a wide tree', async () => {
    const root = makeTempRoot()
    const projectCount = 500
    for (let index = 0; index < projectCount; index++) {
      makeProject(path.join(root, `group-${index % 10}`, `project-${index}`))
    }

    const result = await scanProjectDirectories([root], [], [])
    expect(result.failures).toEqual([])
    expect(result.snapshot.projects).toHaveLength(projectCount)
  })
})

describe('project scanner', () => {
  it('detects extensionless and extension README files consistently', () => {
    expect(hasReadme(['README'])).toBe(true)
    expect(hasReadme(['readme.md'])).toBe(true)
    expect(hasReadme(['README.txt'])).toBe(true)
    expect(hasReadme(['read-me.md'])).toBe(false)
  })

  it('normalizes common GitHub remote URL formats', () => {
    expect(toGithubUrl('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(toGithubUrl('ssh://git@github.com/owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(toGithubUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(toGithubUrl('https://example.com/owner/repo.git')).toBeUndefined()
  })

  it('uses scan-root-relative names for nested projects', async () => {
    const root = makeTempRoot()
    const nestedProject = path.join(root, 'ProjectTracker', 'dashboard')
    mkdirSync(path.join(nestedProject, '.git'), { recursive: true })
    writeFileSync(path.join(nestedProject, 'package.json'), '{}')
    writeFileSync(path.join(nestedProject, 'README'), '# Dashboard')
    writeFileSync(path.join(nestedProject, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:owner/dashboard.git\n')

    const result = await scanProjectDirectories([root], [], [])
    expect(result.failures).toEqual([])
    expect(result.snapshot.projects).toHaveLength(1)
    expect(result.snapshot.projects[0]).toMatchObject({
      name: 'ProjectTracker/dashboard',
      hasReadme: true,
      githubUrl: 'https://github.com/owner/dashboard'
    })
  })
})

describe('project scanner progress and cancel', () => {
  it('reports increasing progress and a final count of every directory read', async () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'a', 'app'))
    makeProject(path.join(root, 'b', 'api'))
    const progress: { directoriesSeen: number; currentPath: string }[] = []

    await scanProjectDirectories([root], [], [], { onProgress: (update) => progress.push(update) })

    // root, a, a/app, b, b/api
    expect(progress.at(-1)?.directoriesSeen).toBe(5)
    const counts = progress.map((update) => update.directoriesSeen)
    expect(counts).toEqual([...counts].sort((left, right) => left - right))
  })

  it('a pre-aborted signal rejects before reading anything', async () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'app'))
    const onProgress = vi.fn()

    await expect(
      scanProjectDirectories([root], [], [], { signal: AbortSignal.abort(), onProgress })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('aborting mid-walk stops the scan', async () => {
    const root = makeTempRoot()
    for (let index = 0; index < 50; index++) makeProject(path.join(root, `group-${index}`, 'app'))
    const controller = new AbortController()
    let lastSeen = 0

    await expect(
      scanProjectDirectories([root], [], [], {
        signal: controller.signal,
        onProgress: (update) => {
          lastSeen = update.directoriesSeen
          controller.abort()
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(lastSeen).toBe(1)
  })
})
