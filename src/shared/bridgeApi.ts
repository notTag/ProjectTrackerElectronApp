import type {
  AgentRetryEvent,
  AutoRunTicketLaunch,
  GithubIssueLists,
  LaneStoreEntry,
  LaneWritePatch,
  LaneMarkdownContext,
  LaneMarkdownKind,
  ProjectGithubData,
  ProjectMetrics,
  ProjectRecord,
  ProjectTrackerState,
  ProjectWritePatch,
  PullRequestStatus,
  ScanProgress,
  ScanResult,
  SwimLane,
  TabLiveness,
  TerminalTab,
  Ticket,
  TicketWritePatch
} from './projectTypes.js'

// Channels both transports carry: Electron IPC (preload.cts) and the local web
// server (electron/web/server.ts). The handlers for them live in
// electron/ipcHandlers.ts, typed as a Record over this list, so a channel added
// here without a handler (or the reverse) fails typecheck.
export const IPC_CHANNELS = [
  'project-state:get',
  'project-state:refresh',
  'project-state:save',
  'ticket:create',
  'ticket:update',
  'ticket:delete',
  'ticket-images:save-bytes',
  'ticket-images:remove',
  'ticket-images:copy',
  'ticket-images:open',
  'lane:create',
  'lane:update',
  'lane:reorder',
  'lane:delete',
  'workflow:activate',
  'workflow:create',
  'lane-store:list',
  'lane-store:save',
  'lane-store:delete',
  'lane-store:add',
  'project:update',
  'projects:scan',
  'projects:scan-cancel',
  'dialog:pick-scan-directory',
  'project:open-in',
  'lane:auto-run',
  'ticket:run-agent',
  'app:started-at',
  'terminal:tabs-alive',
  'metrics:get',
  'project:fetch-github',
  'ticket:fetch-pull-request',
  'project:fetch-github-issues',
  'project:read-readme',
  'lane:read-markdown-context',
  'lane:ensure-markdown-files'
] as const

export type IpcChannel = (typeof IPC_CHANNELS)[number]

export type PageFindResult = { activeMatchOrdinal: number; matches: number; finalUpdate: boolean }

// window.projectTracker. The preload and src/services/webBridge.ts both
// `satisfies` this, so neither can drift from what the renderer calls.
export interface ProjectTrackerBridge {
  // Electron-only: the web build leaves them out and the browser's own find and
  // theme handling take over.
  findInPage?(text: string, forward?: boolean, newSession?: boolean): Promise<void>
  stopFindInPage?(): Promise<void>
  onFindResult?(callback: (result: PageFindResult) => void): () => void
  setNativeTheme?(type: 'light' | 'dark'): Promise<void>

  getProjectState(): Promise<ProjectTrackerState>
  saveProjectState(state: ProjectTrackerState): Promise<ProjectTrackerState>
  // Null when nothing outside this app has written since the last read.
  refreshProjectState(): Promise<ProjectTrackerState | null>
  createTicket(projectPath: string, ticket: Omit<Ticket, 'number'>): Promise<Ticket>
  updateTicket(id: string, patch: TicketWritePatch): Promise<Ticket>
  deleteTicket(id: string): Promise<void>
  // Each returns/accepts absolute paths of the copies under <userData>/attachments.
  pickTicketImages(ticketId: string): Promise<string[]>
  saveTicketImageBytes(ticketId: string, bytes: Uint8Array, mimeType: string): Promise<string>
  removeTicketImage(ticketId: string, imagePath: string): Promise<void>
  copyTicketImages(ticketId: string, imagePaths: string[]): Promise<string[]>
  openTicketImage(imagePath: string): Promise<void>
  // Where an <img> loads an attachment: a custom scheme in Electron, a server route on the web.
  ticketImageUrl(imagePath: string): string
  createLane(projectPath: string, lane: SwimLane): Promise<SwimLane>
  updateLane(projectPath: string, laneId: string, patch: LaneWritePatch): Promise<SwimLane>
  reorderLanes(projectPath: string, laneIds: string[]): Promise<void>
  deleteLane(projectPath: string, laneId: string): Promise<void>
  // Both return a fresh read: the board's lanes are replaced wholesale.
  activateWorkflow(projectPath: string, workflowId: string): Promise<ProjectTrackerState>
  createWorkflow(projectPath: string, name: string): Promise<ProjectTrackerState>
  listLaneStore(): Promise<LaneStoreEntry[]>
  saveLaneToStore(projectPath: string, laneId: string): Promise<LaneStoreEntry>
  deleteLaneStoreEntry(entryId: string): Promise<void>
  addLaneFromStore(projectPath: string, entryId: string): Promise<ProjectTrackerState>
  updateProject(path: string, patch: ProjectWritePatch): Promise<ProjectRecord>
  onExternalChange(callback: () => void): () => void
  scanProjectDirectories(scanDirectories: string[], hiddenPaths: string[], thirdPartyPaths: string[]): Promise<ScanResult>
  onScanProgress(callback: (progress: ScanProgress) => void): () => void
  cancelScan(): Promise<void>
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
  runTicketAgent(
    path: string,
    agentId: string,
    prompt: string,
    model?: string,
    sessionId?: string
  ): Promise<{ succeeded: boolean; output: string; attempts?: number }>
  onAgentRetry(callback: (notice: AgentRetryEvent) => void): () => void
  appStartedAt(): Promise<string>
  terminalTabsAlive(targetId: string, titles: string[]): Promise<TabLiveness[]>
  readProjectReadme(path: string): Promise<{ content: string | null; fileName: string | null }>
  readLaneMarkdownContext(
    kind: LaneMarkdownKind,
    projectPath: string,
    laneName: string,
    filePath: string
  ): Promise<LaneMarkdownContext | null>
  ensureLaneMarkdownFiles(projectPath: string, laneId: string): Promise<SwimLane>
  fetchProjectGithub(githubUrl: string): Promise<ProjectGithubData>
  fetchProjectGithubIssues(githubUrl: string, since?: string): Promise<GithubIssueLists>
  getMetrics(projectPaths: string[]): Promise<ProjectMetrics[]>
  fetchTicketPullRequest(githubUrl: string, branchName: string, pullRequestUrl?: string): Promise<PullRequestStatus | null>
}
