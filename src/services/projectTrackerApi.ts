import { toPlainJson } from '@/shared/plainJson'
import type { AutoRunTicketLaunch, ProjectTrackerState, ScanResult, TerminalTab } from '@/shared/projectTypes'

const jsonHeaders = { 'Content-Type': 'application/json' }

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

  // The browser fallback has no other writers, so there is never anything new.
  async refreshProjectState(): Promise<ProjectTrackerState | null> {
    if (window.projectTracker) return window.projectTracker.refreshProjectState()
    return null
  },

  onExternalChange(callback: () => void): () => void {
    if (window.projectTracker) return window.projectTracker.onExternalChange(callback)
    return () => undefined
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

  openProjectIn(path: string, targetId: string, command?: string, title?: string) {
    return requireElectron().openProjectIn(path, targetId, command, title)
  },

  autoRunLane(
    path: string,
    targetId: string,
    tickets: AutoRunTicketLaunch[],
    useWorktrees: boolean,
    orchestrator?: TerminalTab
  ) {
    return requireElectron().autoRunLane(path, targetId, tickets, useWorktrees, orchestrator)
  },

  runTicketAgent(path: string, agentId: string, prompt: string, model?: string) {
    return requireElectron().runTicketAgent(path, agentId, prompt, model)
  },

  readProjectReadme(path: string) {
    return requireElectron().readProjectReadme(path)
  },
  saveLaneAgentMarkdown(projectPath: string, laneName: string, agentFilePath: string, content: string) {
    return requireElectron().saveLaneAgentMarkdown(projectPath, laneName, agentFilePath, content)
  },

  fetchProjectGithub(githubUrl: string) {
    return requireElectron().fetchProjectGithub(githubUrl)
  },

  getMetrics(projectPaths: string[]) {
    return requireElectron().getMetrics(projectPaths)
  },
  fetchProjectGithubIssues(githubUrl: string) {
    return requireElectron().fetchProjectGithubIssues(githubUrl)
  },

  fetchTicketPullRequest(githubUrl: string, branchName: string, pullRequestUrl?: string) {
    return requireElectron().fetchTicketPullRequest(githubUrl, branchName, pullRequestUrl)
  }
}
