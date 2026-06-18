export type ProjectStatus = 'active' | 'ongoing' | 'paused' | 'completed' | 'archived' | 'hidden' | 'unknown'

export type ProjectPriority = 'high' | 'medium' | 'low' | 'none'

export type ProjectSource = 'first-party' | 'third-party'

export interface ProjectGithubData {
  defaultBranch: string
  openIssues: number
  stars: number
  forks: number
  description?: string
  pushedAt?: string
  fetchedAt: string
}

export interface ProjectRecord {
  path: string
  name: string
  status: ProjectStatus
  priority: ProjectPriority
  notes: string
  source: ProjectSource
  packageManager?: string
  githubUrl?: string
  github?: ProjectGithubData
  hasGit: boolean
  hasPackageJson: boolean
  hasReadme: boolean
  lastModifiedAt?: string
  lastScannedAt: string
}

export interface ProjectSnapshot {
  projects: ProjectRecord[]
  scannedAt?: string
  failures: ScanFailure[]
}

export interface ProjectTrackerState {
  version: number
  updatedAt: string
  scanDirectories: string[]
  hiddenPaths: string[]
  thirdPartyPaths: string[]
  snapshot: ProjectSnapshot
}

export interface ScanFailure {
  path: string
  message: string
}

export interface ScanResult {
  snapshot: ProjectSnapshot
  failures: ScanFailure[]
}

export const createSeedState = (): ProjectTrackerState => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  scanDirectories: [],
  hiddenPaths: [],
  thirdPartyPaths: [],
  snapshot: {
    scannedAt: undefined,
    failures: [],
    projects: [
      {
        path: '/Users/example/Projects/sample-app',
        name: 'sample-app',
        status: 'unknown',
        priority: 'none',
        notes: 'Seed project shown until your first scan succeeds.',
        source: 'first-party',
        packageManager: 'npm',
        githubUrl: 'https://github.com/example/sample-app',
        hasGit: true,
        hasPackageJson: true,
        hasReadme: true,
        lastModifiedAt: undefined,
        lastScannedAt: new Date().toISOString()
      }
    ]
  }
})

export const mergeScannedProjects = (
  previous: ProjectTrackerState,
  scannedProjects: ProjectRecord[],
  failures: ScanFailure[]
): ProjectTrackerState => {
  const existingByPath = new Map(previous.snapshot.projects.map((project) => [project.path, project]))
  const projects = scannedProjects.map((project) => {
    const existing = existingByPath.get(project.path)
    return {
      ...project,
      status: existing?.status ?? project.status,
      priority: existing?.priority ?? project.priority,
      notes: existing?.notes ?? project.notes,
      githubUrl: project.githubUrl ?? existing?.githubUrl,
      github: existing?.github ?? project.github
    }
  })

  return {
    ...previous,
    updatedAt: new Date().toISOString(),
    snapshot: {
      scannedAt: new Date().toISOString(),
      projects,
      failures
    }
  }
}
