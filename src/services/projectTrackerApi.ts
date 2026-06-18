import type { ProjectTrackerState, ScanResult } from '@/shared/projectTypes'

const jsonHeaders = { 'Content-Type': 'application/json' }

const toPlainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const requireElectron = () => {
  if (!window.projectTracker) {
    throw new Error('Project Tracker desktop APIs are unavailable in this environment.')
  }
  return window.projectTracker
}

export const projectTrackerApi = {
  async getProjectState() {
    if (window.projectTracker) return window.projectTracker.getProjectState()
    const stored = localStorage.getItem('project-tracker-state')
    if (!stored) throw new Error('No browser fallback state exists yet.')
    return JSON.parse(stored) as ProjectTrackerState
  },

  async saveProjectState(state: ProjectTrackerState) {
    const plainState = toPlainJson(state)
    if (window.projectTracker) return window.projectTracker.saveProjectState(plainState)
    localStorage.setItem('project-tracker-state', JSON.stringify(plainState))
    return plainState
  },

  async scanProjectDirectories(
    scanDirectories: string[],
    hiddenPaths: string[],
    thirdPartyPaths: string[]
  ): Promise<ScanResult> {
    const plainScanDirectories = [...scanDirectories]
    const plainHiddenPaths = [...hiddenPaths]
    const plainThirdPartyPaths = [...thirdPartyPaths]

    if (window.projectTracker) {
      return window.projectTracker.scanProjectDirectories(plainScanDirectories, plainHiddenPaths, plainThirdPartyPaths)
    }
    const response = await fetch('/api/project-scan', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        scanDirectories: plainScanDirectories,
        hiddenPaths: plainHiddenPaths,
        thirdPartyPaths: plainThirdPartyPaths
      })
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json() as Promise<ScanResult>
  },

  pickScanDirectory() {
    return requireElectron().pickScanDirectory()
  },

  openProjectIn(path: string, targetId: string) {
    return requireElectron().openProjectIn(path, targetId)
  },

  readProjectReadme(path: string) {
    return requireElectron().readProjectReadme(path)
  },

  fetchProjectGithub(githubUrl: string) {
    return requireElectron().fetchProjectGithub(githubUrl)
  }
}
