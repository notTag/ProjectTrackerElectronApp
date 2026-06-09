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
  openProjectShell(path: string): Promise<{ ok: true; fallbackCommand?: string }>
  readProjectReadme(path: string): Promise<{ content: string | null; fileName: string | null }>
}

declare global {
  interface Window {
    projectTracker?: ProjectTrackerElectronApi
  }
}
