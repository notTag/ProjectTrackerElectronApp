import { defineStore } from 'pinia'

import {
  DEFAULT_OPEN_IN_TARGET_ID,
  findOpenInTarget,
  type OpenInTarget
} from '@/shared/openInTargets'

const STORAGE_KEY = 'project-tracker-open-in'

// Restore the saved target, ignoring stale/unknown ids (e.g. a removed app).
const loadInitialTargetId = (): string => {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored && findOpenInTarget(stored) ? stored : DEFAULT_OPEN_IN_TARGET_ID
}

/**
 * Tracks which app the "Open In" button launches projects in.
 * Persists the choice to localStorage, mirroring how the theme store persists.
 */
export const useOpenInStore = defineStore('openIn', {
  state: () => ({ selectedId: loadInitialTargetId() }),

  getters: {
    // Always resolves to a real target — falls back to the default if the
    // persisted id ever drifts out of the allowlist.
    selectedTarget: (state): OpenInTarget =>
      findOpenInTarget(state.selectedId) ?? findOpenInTarget(DEFAULT_OPEN_IN_TARGET_ID)!
  },

  actions: {
    select(id: string) {
      if (!findOpenInTarget(id)) return
      this.selectedId = id
      localStorage.setItem(STORAGE_KEY, id)
    }
  }
})
