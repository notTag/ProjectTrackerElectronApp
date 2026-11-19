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

const readCachedThemeId = () => {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    return null
  }
}

const isKnownThemeId = (themeId: string | null): themeId is string =>
  themeId !== null && resolveThemeId(themeId) === themeId

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
  // Read before any setTheme rewrites it: only a pre-existing valid cache migrates.
  const cachedThemeIdAtBoot = readCachedThemeId()
  // An older save landing after a newer pick would otherwise flip the UI back.
  let themeSavesInFlight = 0

  const saveThemeId = async (themeId: string) => {
    themeSavesInFlight += 1
    try {
      await projectsStore.saveThemeId(themeId)
    } finally {
      themeSavesInFlight -= 1
    }
  }

  // DB → UI. Registered first so on load it applies the DB theme before the
  // UI → DB watcher compares, which then sees them equal and skips the save.
  watch(
    () => [projectsStore.loaded, projectsStore.state.themeId] as const,
    ([loaded, savedThemeId]) => {
      if (!loaded || !savedThemeId || themeSavesInFlight > 0) return
      const resolvedThemeId = resolveThemeId(savedThemeId)
      if (resolvedThemeId !== themeStore.confirmedThemeId) themeStore.setTheme(resolvedThemeId)
    },
    { immediate: true }
  )

  // UI → DB. Compares against the resolved DB id, so an id this build doesn't
  // know is never overwritten by its default fallback. With no DB value, a
  // valid cached choice is adopted on load (migration); otherwise the DB
  // stays unset until the user picks.
  watch(
    () => [projectsStore.loaded, themeStore.confirmedThemeId] as const,
    ([loaded, confirmedThemeId], previous) => {
      if (!loaded) return
      const savedThemeId = projectsStore.state.themeId
      if (savedThemeId && resolveThemeId(savedThemeId) === confirmedThemeId) return
      if (!savedThemeId) {
        const justLoaded = previous?.[0] !== true
        const userPicked = !justLoaded
        const migrating = justLoaded && isKnownThemeId(cachedThemeIdAtBoot)
        if (!userPicked && !migrating) return
      }
      void saveThemeId(confirmedThemeId)
    },
    { immediate: true }
  )
}
