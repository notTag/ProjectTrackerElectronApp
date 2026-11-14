/// <reference types="vite/client" />

import type {
  AutoRunTicketLaunch,
  GithubIssue,
  LaneWritePatch,
  ProjectGithubData,
  ProjectMetrics,
  ProjectRecord,
  ProjectTrackerState,
  ProjectWritePatch,
  PullRequestStatus,
  ScanResult,
  SwimLane,
  TerminalTab,
  Ticket,
  TicketWritePatch
} from './shared/projectTypes'

interface ProjectTrackerElectronApi {
  findInPage(text: string, forward?: boolean, next?: boolean): Promise<void>
  stopFindInPage(): Promise<void>
  onFindResult(callback: (result: { activeMatchOrdinal: number; matches: number }) => void): () => void
  getProjectState(): Promise<ProjectTrackerState>
  saveProjectState(state: ProjectTrackerState): Promise<ProjectTrackerState>
  // Null when nothing outside this app has written since the last read.
  refreshProjectState(): Promise<ProjectTrackerState | null>
  createTicket(projectPath: string, ticket: Omit<Ticket, 'number'>): Promise<Ticket>
  updateTicket(id: string, patch: TicketWritePatch): Promise<Ticket>
  moveTicket(id: string, laneId: string): Promise<Ticket>
  deleteTicket(id: string): Promise<void>
  createLane(projectPath: string, lane: SwimLane): Promise<SwimLane>
  updateLane(projectPath: string, laneId: string, patch: LaneWritePatch): Promise<SwimLane>
  reorderLanes(projectPath: string, laneIds: string[]): Promise<void>
  deleteLane(projectPath: string, laneId: string): Promise<void>
  updateProject(path: string, patch: ProjectWritePatch): Promise<ProjectRecord>
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
    command?: string,
    title?: string
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
    useWorktrees: boolean,
    orchestrator?: TerminalTab
  ): Promise<{ worktreePaths: string[] }>
  runTicketAgent(path: string, agentId: string, prompt: string, model?: string): Promise<{ succeeded: boolean; output: string }>
  readProjectReadme(path: string): Promise<{ content: string | null; fileName: string | null }>
  saveLaneAgentMarkdown(
    projectPath: string,
    laneName: string,
    agentFilePath: string,
    content: string
  ): Promise<{ filePath: string; appended: boolean }>
  fetchProjectGithub(githubUrl: string): Promise<ProjectGithubData>
  fetchProjectGithubIssues(githubUrl: string): Promise<GithubIssue[]>
  getMetrics(projectPaths: string[]): Promise<ProjectMetrics[]>
  fetchTicketPullRequest(githubUrl: string, branchName: string, pullRequestUrl?: string): Promise<PullRequestStatus | null>
  setNativeTheme(type: 'light' | 'dark'): Promise<void>
}

declare global {
  interface Window {
    projectTracker?: ProjectTrackerElectronApi
  }
}
