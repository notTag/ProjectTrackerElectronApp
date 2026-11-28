import { contextBridge, ipcRenderer } from 'electron'

import type {
  AgentRetryEvent,
  AutoRunTicketLaunch,
  LaneWritePatch,
  ProjectTrackerState,
  ProjectWritePatch,
  ScanProgress,
  SwimLane,
  TerminalTab,
  Ticket,
  TicketWritePatch
} from '../src/shared/projectTypes.js'
import type { IpcChannel, PageFindResult, ProjectTrackerBridge } from '../src/shared/bridgeApi.js'

// Copy of src/shared/plainJson.ts: a sandboxed preload can only require('electron').
const toPlainJson = <T,>(value: T): T => {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? (undefined as T) : (JSON.parse(serialized) as T)
}

const invokePlain = async <T,>(channel: IpcChannel, payload?: unknown): Promise<T> => {
  const result =
    payload === undefined
      ? await ipcRenderer.invoke(channel)
      : await ipcRenderer.invoke(channel, toPlainJson(payload))
  return toPlainJson(result) as T
}

contextBridge.exposeInMainWorld('projectTracker', {
  findInPage: (text: string, forward = true, next = false) => ipcRenderer.invoke('page-find:search', text, forward, next),
  stopFindInPage: () => ipcRenderer.invoke('page-find:stop'),
  onFindResult: (callback: (result: PageFindResult) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: PageFindResult) => callback(result)
    ipcRenderer.on('page-find:result', listener)
    return () => ipcRenderer.removeListener('page-find:result', listener)
  },
  getProjectState: () => invokePlain('project-state:get'),
  saveProjectState: (state: ProjectTrackerState) => invokePlain('project-state:save', state),
  refreshProjectState: () => invokePlain('project-state:refresh'),
  createTicket: (projectPath: string, ticket: Omit<Ticket, 'number'>) => invokePlain('ticket:create', { projectPath, ticket }),
  updateTicket: (id: string, patch: TicketWritePatch) => invokePlain('ticket:update', { id, patch }),
  deleteTicket: (id: string) => invokePlain('ticket:delete', { id }),
  // Electron-only channel: the web bridge picks files in the browser and sends their bytes.
  pickTicketImages: (ticketId: string) => ipcRenderer.invoke('ticket-images:pick', { ticketId }),
  saveTicketImageBytes: (ticketId: string, bytes: Uint8Array, mimeType: string) =>
    ipcRenderer.invoke('ticket-images:save-bytes', { ticketId, bytes, mimeType }),
  removeTicketImage: (ticketId: string, imagePath: string) =>
    invokePlain('ticket-images:remove', { ticketId, imagePath }),
  openTicketImage: (imagePath: string) => invokePlain('ticket-images:open', imagePath),
  ticketImageUrl: (imagePath: string) => `ticket-image://local/${encodeURIComponent(imagePath)}`,
  createLane: (projectPath: string, lane: SwimLane) => invokePlain('lane:create', { projectPath, lane }),
  updateLane: (projectPath: string, laneId: string, patch: LaneWritePatch) =>
    invokePlain('lane:update', { projectPath, laneId, patch }),
  reorderLanes: (projectPath: string, laneIds: string[]) => invokePlain('lane:reorder', { projectPath, laneIds }),
  deleteLane: (projectPath: string, laneId: string) => invokePlain('lane:delete', { projectPath, laneId }),
  activateWorkflow: (projectPath: string, workflowId: string) =>
    invokePlain('workflow:activate', { projectPath, workflowId }),
  createWorkflow: (projectPath: string, name: string) => invokePlain('workflow:create', { projectPath, name }),
  listLaneStore: () => invokePlain('lane-store:list'),
  saveLaneToStore: (projectPath: string, laneId: string) => invokePlain('lane-store:save', { projectPath, laneId }),
  deleteLaneStoreEntry: (entryId: string) => invokePlain('lane-store:delete', { entryId }),
  addLaneFromStore: (projectPath: string, entryId: string) => invokePlain('lane-store:add', { projectPath, entryId }),
  updateProject: (path: string, patch: ProjectWritePatch) => invokePlain('project:update', { path, patch }),
  // The IPC event object is withheld so the renderer never gets ipcRenderer access.
  onExternalChange: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('project-state:external-change', listener)
    return () => {
      ipcRenderer.removeListener('project-state:external-change', listener)
    }
  },
  scanProjectDirectories: (scanDirectories: string[], hiddenPaths: string[], thirdPartyPaths: string[]) =>
    invokePlain('projects:scan', { scanDirectories, hiddenPaths, thirdPartyPaths }),
  onScanProgress: (callback: (progress: ScanProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => callback(progress)
    ipcRenderer.on('projects:scan-progress', listener)
    return () => ipcRenderer.removeListener('projects:scan-progress', listener)
  },
  cancelScan: () => invokePlain('projects:scan-cancel'),
  pickScanDirectory: () => invokePlain('dialog:pick-scan-directory'),
  openProjectIn: (projectPath: string, targetId: string, command?: string, title?: string) =>
    invokePlain('project:open-in', { projectPath, targetId, command, title }),
  autoRunLane: (
    projectPath: string,
    targetId: string,
    tickets: AutoRunTicketLaunch[],
    useWorktrees: boolean,
    orchestrator?: TerminalTab
  ) => invokePlain('lane:auto-run', { projectPath, targetId, tickets, useWorktrees, orchestrator }),
  runTicketAgent: (projectPath: string, agentId: string, prompt: string, model?: string, sessionId?: string) =>
    invokePlain('ticket:run-agent', { projectPath, agentId, prompt, model, sessionId }),
  onAgentRetry: (callback: (notice: AgentRetryEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, notice: AgentRetryEvent) => callback(notice)
    ipcRenderer.on('ticket:agent-retry', listener)
    return () => ipcRenderer.removeListener('ticket:agent-retry', listener)
  },
  appStartedAt: () => invokePlain('app:started-at'),
  terminalTabsAlive: (targetId: string, titles: string[]) => invokePlain('terminal:tabs-alive', { targetId, titles }),
  readProjectReadme: (projectPath: string) => invokePlain('project:read-readme', projectPath),
  readLaneMarkdownContext: (kind: string, projectPath: string, laneName: string, filePath: string) =>
    invokePlain('lane:read-markdown-context', { kind, projectPath, laneName, filePath }),
  ensureLaneMarkdownFiles: (projectPath: string, laneId: string) =>
    invokePlain('lane:ensure-markdown-files', { projectPath, laneId }),
  fetchProjectGithub: (githubUrl: string) => invokePlain('project:fetch-github', githubUrl),
  getMetrics: (projectPaths: string[]) => invokePlain('metrics:get', { projectPaths }),
  fetchProjectGithubIssues: (githubUrl: string, since?: string) =>
    invokePlain('project:fetch-github-issues', { githubUrl, since }),
  fetchTicketPullRequest: (githubUrl: string, branchName: string, pullRequestUrl?: string) =>
    invokePlain('ticket:fetch-pull-request', { githubUrl, branchName, pullRequestUrl }),
  setNativeTheme: (type: 'light' | 'dark') => ipcRenderer.invoke('theme:set-native', type)
} satisfies ProjectTrackerBridge)
