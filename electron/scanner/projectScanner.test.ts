import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { hasReadme, scanProjectDirectories, toGithubUrl } from './projectScanner'

let tempRoot: string | undefined

const makeTempRoot = () => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'project-tracker-scanner-'))
  return tempRoot
}

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = undefined
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
