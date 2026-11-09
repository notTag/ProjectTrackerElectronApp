/// <reference types="vite/client" />

import type {
  AutoRunTicketLaunch,
  GithubIssue,
  ProjectGithubData,
  ProjectTrackerState,
  ScanResult
} from './shared/projectTypes'

interface ProjectTrackerElectronApi {
  findInPage(text: string, forward?: boolean, next?: boolean): Promise<void>
  stopFindInPage(): Promise<void>
  onFindResult(callback: (result: { activeMatchOrdinal: number; matches: number }) => void): () => void
  getProjectState(): Promise<ProjectTrackerState>
  saveProjectState(state: ProjectTrackerState): Promise<ProjectTrackerState>
  // Null when nothing outside this app has written since the last read.
  refreshProjectState(): Promise<ProjectTrackerState | null>
  onExternalChange(callback: () => void): () => void
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
  ): Promise<{
    ok: true
    appLabel: string
    fallbackCommand?: string
    copiedCommand?: string
    ranCommand?: string
  }>
  autoRunLane(
    path: string,
    targetId: string,
    tickets: AutoRunTicketLaunch[],
    useWorktrees: boolean
  ): Promise<{ worktreePaths: string[] }>
  runTicketAgent(path: string, agentId: string, prompt: string): Promise<{ succeeded: boolean; output: string }>
  readProjectReadme(path: string): Promise<{ content: string | null; fileName: string | null }>
  saveLaneAgentMarkdown(
    projectPath: string,
    laneName: string,
    agentFilePath: string,
    content: string
  ): Promise<{ filePath: string; appended: boolean }>
  fetchProjectGithub(githubUrl: string): Promise<ProjectGithubData>
  fetchProjectGithubIssues(githubUrl: string): Promise<GithubIssue[]>
  setNativeTheme(type: 'light' | 'dark'): Promise<void>
}

declare global {
  interface Window {
    projectTracker?: ProjectTrackerElectronApi
  }
}
