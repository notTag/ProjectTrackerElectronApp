import { contextBridge, ipcRenderer } from 'electron'

import type { AutoRunTicketLaunch, ProjectTrackerState } from '../src/shared/projectTypes.js'

const toPlainJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

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
  openProjectIn: (projectPath: string, targetId: string, command?: string) =>
    invokePlain('project:open-in', { projectPath, targetId, command }),
  autoRunLane: (projectPath: string, targetId: string, tickets: AutoRunTicketLaunch[], useWorktrees: boolean) =>
    invokePlain('lane:auto-run', { projectPath, targetId, tickets, useWorktrees }),
  runTicketAgent: (projectPath: string, ticketId: string, agentId: string, prompt: string) =>
    invokePlain('ticket:run-agent', { projectPath, ticketId, agentId, prompt }),
  cancelTicketAgent: (ticketId: string) => invokePlain('ticket:cancel-agent', ticketId),
  readProjectReadme:(projectPath: string) => invokePlain('project:read-readme', projectPath),
  saveLaneAgentMarkdown: (projectPath: string, laneName: string, agentFilePath: string, content: string) =>
    invokePlain('lane:save-agent-markdown', { projectPath, laneName, agentFilePath, content }),
  fetchProjectGithub: (githubUrl: string) => invokePlain('project:fetch-github', githubUrl),
  fetchProjectGithubIssues: (githubUrl: string) => invokePlain('project:fetch-github-issues', githubUrl),
  setNativeTheme: (type: 'light' | 'dark') => invokePlain('theme:set-native', type)
})
