import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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

const projectNames = (directories: string[]) =>
  scanProjectDirectories(directories, [], []).snapshot.projects.map((project) => project.name)

afterEach(() => {
  for (const directory of lockedDirectories.splice(0)) chmodSync(directory, 0o755)
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
})

describe('project scanner failures', () => {
  it('a missing root becomes one failure and the other roots still scan', () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'app'))
    const missing = path.join(root, 'does-not-exist')

    const result = scanProjectDirectories([missing, root], [], [])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].path).toBe(missing)
    expect(result.failures[0].message).toMatch(/ENOENT/)
    expect(result.snapshot.projects.map((project) => project.name)).toEqual(['app'])
  })

  it('a root that is a file is reported as not a directory', () => {
    const root = makeTempRoot()
    const file = path.join(root, 'notes.txt')
    writeFileSync(file, 'hi')

    const result = scanProjectDirectories([file], [], [])
    expect(result.failures).toEqual([{ path: file, message: 'Path is not a directory.' }])
    expect(result.snapshot.projects).toEqual([])
  })

  // root reads through any permission bits, so there is nothing to fail.
  it.skipIf(process.getuid?.() === 0)('an unreadable subdirectory fails alone; its siblings are still found', () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'app'))
    const locked = path.join(root, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o000)
    lockedDirectories.push(locked)

    const result = scanProjectDirectories([root], [], [])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].path).toBe(locked)
    expect(result.failures[0].message).toMatch(/EACCES/)
    expect(result.snapshot.projects.map((project) => project.name)).toEqual(['app'])
  })
})

describe('project scanner on large trees', () => {
  it('finds projects four levels down and nothing deeper', () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'a', 'b', 'c', 'd'))
    makeProject(path.join(root, 'w', 'x', 'y', 'z', 'too-deep'))

    expect(projectNames([root])).toEqual(['a/b/c/d'])
  })

  it('ignores markers inside node_modules, build output and dot-directories', () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'loose', 'node_modules', 'left-pad'))
    makeProject(path.join(root, 'loose', 'dist', 'bundle'))
    makeProject(path.join(root, '.hidden', 'app'))

    expect(projectNames([root])).toEqual([])
  })

  it('stops at the first project marker instead of walking into the project', () => {
    const root = makeTempRoot()
    makeProject(path.join(root, 'monorepo'))
    makeProject(path.join(root, 'monorepo', 'packages', 'cli'))

    expect(projectNames([root])).toEqual(['monorepo'])
  })

  it('returns every project in a wide tree', () => {
    const root = makeTempRoot()
    const projectCount = 500
    for (let index = 0; index < projectCount; index++) {
      makeProject(path.join(root, `group-${index % 10}`, `project-${index}`))
    }

    const result = scanProjectDirectories([root], [], [])
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

  it('uses scan-root-relative names for nested projects', () => {
    const root = makeTempRoot()
    const nestedProject = path.join(root, 'ProjectTracker', 'dashboard')
    mkdirSync(path.join(nestedProject, '.git'), { recursive: true })
    writeFileSync(path.join(nestedProject, 'package.json'), '{}')
    writeFileSync(path.join(nestedProject, 'README'), '# Dashboard')
    writeFileSync(path.join(nestedProject, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:owner/dashboard.git\n')

    const result = scanProjectDirectories([root], [], [])
    expect(result.failures).toEqual([])
    expect(result.snapshot.projects).toHaveLength(1)
    expect(result.snapshot.projects[0]).toMatchObject({
      name: 'ProjectTracker/dashboard',
      hasReadme: true,
      githubUrl: 'https://github.com/owner/dashboard'
    })
  })
})
