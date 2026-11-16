import { describe, expect, it } from 'vitest'

import { projectMatchesFilters, type ProjectFilters } from './projectFilters'
import type { ProjectPriority, ProjectRecord, ProjectStatus } from './projectTypes'

const project = (path: string, status: ProjectStatus, priority: ProjectPriority = 'none'): ProjectRecord => ({
  path,
  name: path.slice(1),
  status,
  priority,
  notes: '',
  source: 'first-party',
  hasGit: true,
  hasPackageJson: false,
  hasReadme: false,
  lastScannedAt: '2026-01-01T00:00:00.000Z'
})

const projects = [
  project('/alpha', 'active', 'high'),
  project('/beta', 'active', 'low'),
  project('/gamma', 'completed'),
  project('/delta', 'hidden'),
  project('/epsilon', 'active')
]

const noFilters: ProjectFilters = {
  query: '',
  statuses: [],
  priorities: [],
  thirdPartyOnly: false,
  hiddenPaths: ['/epsilon'],
  thirdPartyPaths: ['/beta']
}

const matchingPaths = (overrides: Partial<ProjectFilters>) => {
  const filters = { ...noFilters, ...overrides }
  const matches = projects.filter((candidate) => projectMatchesFilters(candidate, candidate.name, filters))
  return matches.map((match) => match.path)
}

describe('projectMatchesFilters', () => {
  it('Active filter keeps only active, non-hidden projects', () => {
    expect(matchingPaths({ statuses: ['active'] })).toEqual(['/alpha', '/beta'])
  })

  it('excludes hidden projects (by status or hiddenPaths) unless the hidden filter is on', () => {
    expect(matchingPaths({})).toEqual(['/alpha', '/beta', '/gamma'])
    expect(matchingPaths({ statuses: ['active', 'hidden'] })).toEqual(['/alpha', '/beta', '/delta', '/epsilon'])
  })

  it('applies priority, third-party and search filters', () => {
    expect(matchingPaths({ priorities: ['high'] })).toEqual(['/alpha'])
    expect(matchingPaths({ thirdPartyOnly: true })).toEqual(['/beta'])
    expect(matchingPaths({ query: 'GAM' })).toEqual(['/gamma'])
  })

  it('returns nothing when no project matches', () => {
    expect(matchingPaths({ query: 'no-such-project' })).toEqual([])
  })
})
