import { contextBridge, ipcRenderer } from 'electron'

import type {
  AutoRunTicketLaunch,
  LaneWritePatch,
  ProjectTrackerState,
  ProjectWritePatch,
  SwimLane,
  TerminalTab,
  Ticket,
  TicketWritePatch
} from '../src/shared/projectTypes.js'

// Copy of src/shared/plainJson.ts: a sandboxed preload can only require('electron').
const toPlainJson = <T,>(value: T): T => {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? (undefined as T) : (JSON.parse(serialized) as T)
}

const invokePlain = async <T,>(channel: string, payload?: unknown): Promise<T> => {
  const result =
    payload === undefined
      ? await ipcRenderer.invoke(channel)
      : await ipcRenderer.invoke(channel, toPlainJson(payload))
  return toPlainJson(result) as T
}

contextBridge.exposeInMainWorld('projectTracker', {
  findInPage: (text: string, forward = true, next = false) => ipcRenderer.invoke('page-find:search', text, forward, next),
  stopFindInPage: () => ipcRenderer.invoke('page-find:stop'),
  onFindResult: (callback: (result: { activeMatchOrdinal: number; matches: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: { activeMatchOrdinal: number; matches: number }) => callback(result)
    ipcRenderer.on('page-find:result', listener)
    return () => ipcRenderer.removeListener('page-find:result', listener)
  },
  getProjectState: () => invokePlain('project-state:get'),
  saveProjectState: (state: ProjectTrackerState) => invokePlain('project-state:save', state),
  refreshProjectState: () => invokePlain('project-state:refresh'),
  createTicket: (projectPath: string, ticket: Omit<Ticket, 'number'>) => invokePlain('ticket:create', { projectPath, ticket }),
  updateTicket: (id: string, patch: TicketWritePatch) => invokePlain('ticket:update', { id, patch }),
  moveTicket: (id: string, laneId: string) => invokePlain('ticket:move', { id, laneId }),
  deleteTicket: (id: string) => invokePlain('ticket:delete', { id }),
  createLane: (projectPath: string, lane: SwimLane) => invokePlain('lane:create', { projectPath, lane }),
  updateLane: (projectPath: string, laneId: string, patch: LaneWritePatch) =>
    invokePlain('lane:update', { projectPath, laneId, patch }),
  reorderLanes: (projectPath: string, laneIds: string[]) => invokePlain('lane:reorder', { projectPath, laneIds }),
  deleteLane: (projectPath: string, laneId: string) => invokePlain('lane:delete', { projectPath, laneId }),
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
  pickScanDirectory: () => ipcRenderer.invoke('dialog:pick-scan-directory'),
  openProjectIn: (projectPath: string, targetId: string, command?: string, title?: string) =>
    invokePlain('project:open-in', { projectPath, targetId, command, title }),
  autoRunLane: (
    projectPath: string,
    targetId: string,
    tickets: AutoRunTicketLaunch[],
    useWorktrees: boolean,
    orchestrator?: TerminalTab
  ) => invokePlain('lane:auto-run', { projectPath, targetId, tickets, useWorktrees, orchestrator }),
  runTicketAgent: (projectPath: string, agentId: string, prompt: string, model?: string) =>
    invokePlain('ticket:run-agent', { projectPath, agentId, prompt, model }),
  readProjectReadme:(projectPath: string) => invokePlain('project:read-readme', projectPath),
  saveLaneAgentMarkdown: (projectPath: string, laneName: string, agentFilePath: string, content: string) =>
    invokePlain('lane:save-agent-markdown', { projectPath, laneName, agentFilePath, content }),
  fetchProjectGithub: (githubUrl: string) => invokePlain('project:fetch-github', githubUrl),
  getMetrics: (projectPaths: string[]) => invokePlain('metrics:get', { projectPaths }),
  fetchProjectGithubIssues: (githubUrl: string) => invokePlain('project:fetch-github-issues', githubUrl),
  fetchTicketPullRequest: (githubUrl: string, branchName: string, pullRequestUrl?: string) =>
    invokePlain('ticket:fetch-pull-request', { githubUrl, branchName, pullRequestUrl }),
  setNativeTheme: (type: 'light' | 'dark') => invokePlain('theme:set-native', type)
})
