/// <reference types="vite/client" />

import type { ProjectTrackerBridge } from './shared/bridgeApi'

declare global {
  interface Window {
    projectTracker?: ProjectTrackerBridge
  }
}
