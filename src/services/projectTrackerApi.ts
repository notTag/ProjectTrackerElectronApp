import { toPlainJson } from '@/shared/plainJson'
import type {
  AgentRetryEvent,
  AutoRunTicketLaunch,
  Clearable,
  ProjectRecord,
  ProjectTrackerState,
  ProjectWritePatch,
  ScanProgress,
  ScanResult,
  SwimLane,
  TerminalTab,
  Ticket
} from '@/shared/projectTypes'

// JSON drops undefined keys, so a cleared field has to cross IPC as null.
const withNullClears = <T extends object>(patch: T): Clearable<T> => {
  const entries = Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value])
  return Object.fromEntries(entries) as Clearable<T>
}

type TicketPatch = Partial<Omit<Ticket, 'id' | 'number' | 'createdAt'>>
type LanePatch = Partial<Omit<SwimLane, 'id'>>

// Installed by the Electron preload, or by src/main.ts in the web build.
const bridge = () => {
  if (!window.projectTracker) throw new Error('Project Tracker bridge is not installed.')
  return window.projectTracker
}

export const projectTrackerApi = {
  getProjectState() {
    return bridge().getProjectState()
  },

  saveProjectState(state: ProjectTrackerState) {
    return bridge().saveProjectState(toPlainJson(state))
  },

  createTicket(projectPath: string, ticket: Ticket): Promise<Ticket> {
    const { number: _provisionalNumber, ...unnumbered } = ticket
    return bridge().createTicket(projectPath, toPlainJson(unnumbered))
  },

  // The repository stamps updatedAt unless the patch names it.
  updateTicket(id: string, patch: TicketPatch): Promise<Ticket> {
    return bridge().updateTicket(id, toPlainJson(withNullClears(patch)))
  },

  deleteTicket(id: string): Promise<void> {
    return bridge().deleteTicket(id)
  },

  createLane(projectPath: string, lane: SwimLane): Promise<SwimLane> {
    return bridge().createLane(projectPath, toPlainJson(lane))
  },

  updateLane(projectPath: string, laneId: string, patch: LanePatch): Promise<SwimLane> {
    return bridge().updateLane(projectPath, laneId, toPlainJson(withNullClears(patch)))
  },

  reorderLanes(projectPath: string, laneIds: string[]): Promise<void> {
    return bridge().reorderLanes(projectPath, [...laneIds])
  },

  deleteLane(projectPath: string, laneId: string): Promise<void> {
    return bridge().deleteLane(projectPath, laneId)
  },

  updateProject(path: string, patch: ProjectWritePatch): Promise<ProjectRecord> {
    return bridge().updateProject(path, toPlainJson(patch))
  },

  refreshProjectState(): Promise<ProjectTrackerState | null> {
    return bridge().refreshProjectState()
  },

  onExternalChange(callback: () => void): () => void {
    return bridge().onExternalChange(callback)
  },

  scanProjectDirectories(scanDirectories: string[], hiddenPaths: string[], thirdPartyPaths: string[]): Promise<ScanResult> {
    return bridge().scanProjectDirectories([...scanDirectories], [...hiddenPaths], [...thirdPartyPaths])
  },

  onScanProgress(callback: (progress: ScanProgress) => void): () => void {
    return bridge().onScanProgress(callback)
  },

  cancelScan(): Promise<void> {
    return bridge().cancelScan()
  },

  pickScanDirectory() {
    return bridge().pickScanDirectory()
  },

  pickTicketImages(ticketId: string) {
    return bridge().pickTicketImages(ticketId)
  },

  saveTicketImageBytes(ticketId: string, bytes: Uint8Array, mimeType: string) {
    return bridge().saveTicketImageBytes(ticketId, bytes, mimeType)
  },

  removeTicketImage(ticketId: string, imagePath: string) {
    return bridge().removeTicketImage(ticketId, imagePath)
  },

  openTicketImage(imagePath: string) {
    return bridge().openTicketImage(imagePath)
  },

  ticketImageUrl(imagePath: string) {
    return bridge().ticketImageUrl(imagePath)
  },

  openProjectIn(path: string, targetId: string, command?: string, title?: string) {
    return bridge().openProjectIn(path, targetId, command, title)
  },

  autoRunLane(
    path: string,
    targetId: string,
    tickets: AutoRunTicketLaunch[],
    useWorktrees: boolean,
    orchestrator?: TerminalTab
  ) {
    return bridge().autoRunLane(path, targetId, tickets, useWorktrees, orchestrator)
  },

  runTicketAgent(path: string, agentId: string, prompt: string, model?: string, sessionId?: string) {
    return bridge().runTicketAgent(path, agentId, prompt, model, sessionId)
  },

  onAgentRetry(callback: (notice: AgentRetryEvent) => void): () => void {
    return bridge().onAgentRetry(callback)
  },

  appStartedAt(): Promise<string> {
    return bridge().appStartedAt()
  },

  terminalTabsAlive(targetId: string, titles: string[]) {
    return bridge().terminalTabsAlive(targetId, titles)
  },

  readProjectReadme(path: string) {
    return bridge().readProjectReadme(path)
  },

  saveLaneAgentMarkdown(projectPath: string, laneName: string, agentFilePath: string, content: string) {
    return bridge().saveLaneAgentMarkdown(projectPath, laneName, agentFilePath, content)
  },

  fetchProjectGithub(githubUrl: string) {
    return bridge().fetchProjectGithub(githubUrl)
  },

  getMetrics(projectPaths: string[]) {
    return bridge().getMetrics(projectPaths)
  },

  fetchProjectGithubIssues(githubUrl: string, since?: string) {
    return bridge().fetchProjectGithubIssues(githubUrl, since)
  },

  fetchTicketPullRequest(githubUrl: string, branchName: string, pullRequestUrl?: string) {
    return bridge().fetchTicketPullRequest(githubUrl, branchName, pullRequestUrl)
  }
}
