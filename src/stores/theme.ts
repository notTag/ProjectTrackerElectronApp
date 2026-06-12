import { createThemeStore } from '@nick_tag_tech/themes/pinia'

/**
 * App-wide theme store backed by the shared design system.
 * Persists the confirmed theme id to localStorage under `project-tracker-theme`.
 */
export const useThemeStore = createThemeStore({
  storeId: 'theme',
  storageKey: 'project-tracker-theme'
})
