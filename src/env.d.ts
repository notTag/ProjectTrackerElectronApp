/// <reference types="vite/client" />

import type { ProjectTrackerState, ScanResult } from './shared/projectTypes'

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
    targetId: string
  ): Promise<{ ok: true; appLabel: string; fallbackCommand?: string }>
  readProjectReadme(path: string): Promise<{ content: string | null; fileName: string | null }>
}

declare global {
  interface Window {
    projectTracker?: ProjectTrackerElectronApi
  }
}
