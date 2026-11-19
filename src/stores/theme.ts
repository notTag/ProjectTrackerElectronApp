import { resolveThemeId } from '@nick_tag_tech/themes'
import { createThemeStore } from '@nick_tag_tech/themes/pinia'
import { watch } from 'vue'

import { useProjectsStore } from '@/stores/projects'

const THEME_STORAGE_KEY = 'project-tracker-theme'

/**
 * App-wide theme store backed by the shared design system.
 * localStorage (`project-tracker-theme`) is only a first-paint cache; the DB is
 * the source of truth — see useThemePersistence.
 */
export const useThemeStore = createThemeStore({
  storeId: 'theme',
  storageKey: THEME_STORAGE_KEY
})

const hasCachedTheme = () => {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

/**
 * Keeps the confirmed theme in sync with the DB's per-user `theme` setting.
 * localStorage is origin-scoped (dev port, file://), so it alone forgets the
 * choice. Nothing runs until project state has loaded: saving earlier would
 * write seed state over the DB. Hover previews never touch confirmedThemeId,
 * so they are never saved.
 */
export function useThemePersistence() {
  const themeStore = useThemeStore()
  const projectsStore = useProjectsStore()

  // DB → UI. Registered first so on load it applies the DB theme before the
  // UI → DB watcher compares, which then sees them equal and skips the save.
  watch(
    () => [projectsStore.loaded, projectsStore.state.themeId] as const,
    ([loaded, savedThemeId]) => {
      if (!loaded || !savedThemeId) return
      const resolvedThemeId = resolveThemeId(savedThemeId)
      if (resolvedThemeId !== themeStore.confirmedThemeId) themeStore.setTheme(resolvedThemeId)
    },
    { immediate: true }
  )

  // UI → DB. With no DB value yet, an existing localStorage choice is adopted
  // once (migration); with neither, the DB stays unset until the user picks.
  watch(
    () => [projectsStore.loaded, themeStore.confirmedThemeId] as const,
    ([loaded, confirmedThemeId]) => {
      if (!loaded) return
      const savedThemeId = projectsStore.state.themeId
      if (confirmedThemeId === savedThemeId) return
      if (!savedThemeId && !hasCachedTheme()) return
      void projectsStore.saveThemeId(confirmedThemeId)
    },
    { immediate: true }
  )
}
