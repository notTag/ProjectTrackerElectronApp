/// <reference types="vite/client" />

import type {
  GithubIssue,
  ProjectGithubData,
  ProjectTrackerState,
  ScanResult
} from './shared/projectTypes'

interface ProjectTrackerElectronApi {
  getProjectState(): Promise<ProjectTrackerState>
  saveProjectState(state: ProjectTrackerState): Promise<ProjectTrackerState>
  scanProjectDirectories(
    scanDirectories: string[],
    hiddenPaths: string[],
    thirdPartyPaths: string[]
  ): Promise<ScanResult>
  pickScanDirectory(): Promise<string | null>
  openProjectIn(
    path: string,
    targetId: string,
    command?: string
  ): Promise<{ ok: true; appLabel: string; fallbackCommand?: string; copiedCommand?: string }>
  readProjectReadme(path: string): Promise<{ content: string | null; fileName: string | null }>
  fetchProjectGithub(githubUrl: string): Promise<ProjectGithubData>
  fetchProjectGithubIssues(githubUrl: string): Promise<GithubIssue[]>
  setNativeTheme(type: 'light' | 'dark'): Promise<void>
}

declare global {
  interface Window {
    projectTracker?: ProjectTrackerElectronApi
  }
}
