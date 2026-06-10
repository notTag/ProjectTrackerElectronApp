import { contextBridge, ipcRenderer } from 'electron'

import type { ProjectTrackerState } from '../src/shared/projectTypes.js'

const toPlainJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const invokePlain = async <T,>(channel: string, payload?: unknown): Promise<T> => {
  const result =
    payload === undefined
      ? await ipcRenderer.invoke(channel)
      : await ipcRenderer.invoke(channel, toPlainJson(payload))
  return toPlainJson(result) as T
}

contextBridge.exposeInMainWorld('projectTracker', {
  getProjectState: () => invokePlain('project-state:get'),
  saveProjectState: (state: ProjectTrackerState) => invokePlain('project-state:save', state),
  scanProjectDirectories: (scanDirectories: string[], hiddenPaths: string[], thirdPartyPaths: string[]) =>
    invokePlain('projects:scan', { scanDirectories, hiddenPaths, thirdPartyPaths }),
  pickScanDirectory: () => ipcRenderer.invoke('dialog:pick-scan-directory'),
  openProjectShell: (projectPath: string) => invokePlain('project:open-shell', projectPath),
  readProjectReadme: (projectPath: string) => invokePlain('project:read-readme', projectPath)
})
