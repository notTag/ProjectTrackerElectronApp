import { DEFAULT_THEME_ID, themeList } from '@nick_tag_tech/themes'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { createSeedState, type ProjectTrackerState } from '@/shared/projectTypes'

const api = vi.hoisted(() => ({
  getProjectState: vi.fn(),
  refreshProjectState: vi.fn(),
  saveProjectState: vi.fn(async (state: unknown) => state),
  appStartedAt: vi.fn(async () => '2026-01-02T12:00:00.000Z'),
  terminalTabsAlive: vi.fn(async () => ({}))
}))
vi.mock('@/services/projectTrackerApi', () => ({ projectTrackerApi: api }))

const cache = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => cache.get(key) ?? null,
  setItem: (key: string, value: string) => void cache.set(key, value)
})

const { useProjectsStore } = await import('./projects')
const { useThemePersistence, useThemeStore } = await import('./theme')

const OTHER_THEME_ID = themeList.map((theme) => theme.id).find((id) => id !== DEFAULT_THEME_ID)!
const settle = () => new Promise((resolve) => setTimeout(resolve, 0)).then(nextTick)

const boot = async (dbState: Partial<ProjectTrackerState>) => {
  api.getProjectState.mockResolvedValue({ ...createSeedState(), ...dbState })
  const projects = useProjectsStore()
  const theme = useThemeStore()
  useThemePersistence()
  await settle()
  return { projects, theme }
}

const savedThemeIds = () => api.saveProjectState.mock.calls.map(([state]) => (state as ProjectTrackerState).themeId)

describe('useThemePersistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    cache.clear()
  })

  it('saves nothing before project state loads', async () => {
    const { theme } = await boot({})
    theme.setTheme(OTHER_THEME_ID)
    await settle()
    expect(api.saveProjectState).not.toHaveBeenCalled()
  })

  it('applies the DB theme on load without saving it back', async () => {
    const { projects, theme } = await boot({ themeId: OTHER_THEME_ID })
    await projects.load()
    await settle()
    expect(theme.confirmedThemeId).toBe(OTHER_THEME_ID)
    expect(api.saveProjectState).not.toHaveBeenCalled()
  })

  it('saves a confirmed pick but never a hover preview', async () => {
    const { projects, theme } = await boot({})
    await projects.load()
    theme.previewTheme(OTHER_THEME_ID)
    await settle()
    expect(api.saveProjectState).not.toHaveBeenCalled()

    theme.setTheme(OTHER_THEME_ID)
    await settle()
    expect(savedThemeIds()).toEqual([OTHER_THEME_ID])
  })

  it('adopts an existing localStorage theme into an empty DB once', async () => {
    cache.set('project-tracker-theme', OTHER_THEME_ID)
    const { projects } = await boot({})
    await projects.load()
    await settle()
    expect(savedThemeIds()).toEqual([OTHER_THEME_ID])
  })

  it('leaves the DB unset when neither DB nor localStorage has a theme', async () => {
    const { projects } = await boot({})
    await projects.load()
    await settle()
    expect(api.saveProjectState).not.toHaveBeenCalled()
  })

  it('falls back to the default for an unknown DB theme id', async () => {
    cache.set('project-tracker-theme', OTHER_THEME_ID)
    const { projects, theme } = await boot({ themeId: 'removed-theme' })
    await projects.load()
    await settle()
    expect(theme.confirmedThemeId).toBe(DEFAULT_THEME_ID)
    expect(api.saveProjectState).not.toHaveBeenCalled()
  })

  it('does not migrate an unknown cached theme id', async () => {
    cache.set('project-tracker-theme', 'removed-theme')
    const { projects } = await boot({})
    await projects.load()
    await settle()
    expect(api.saveProjectState).not.toHaveBeenCalled()
  })

  it('saves a pick into an empty DB even when localStorage cannot be written', async () => {
    const { projects, theme } = await boot({})
    await projects.load()
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    theme.setTheme(OTHER_THEME_ID)
    await settle()
    setItemSpy.mockRestore()
    expect(savedThemeIds()).toEqual([OTHER_THEME_ID])
  })

  it('keeps the latest pick when an older save lands after it', async () => {
    const { projects, theme } = await boot({ themeId: DEFAULT_THEME_ID })
    await projects.load()
    const appliedThemeIds: string[] = []
    theme.$subscribe(() => appliedThemeIds.push(theme.confirmedThemeId))
    const [firstPick, secondPick] = themeList.map((entry) => entry.id).filter((id) => id !== DEFAULT_THEME_ID)
    theme.setTheme(firstPick)
    await nextTick()
    theme.setTheme(secondPick)
    await settle()
    await settle()
    expect(savedThemeIds()).toEqual([firstPick, secondPick])
    expect(theme.confirmedThemeId).toBe(secondPick)
    expect(appliedThemeIds.lastIndexOf(firstPick)).toBeLessThan(appliedThemeIds.indexOf(secondPick))
  })

  it('starts syncing once a refresh delivers state after a failed first load', async () => {
    api.getProjectState.mockRejectedValueOnce(new Error('database is locked'))
    const { projects, theme } = await boot({ themeId: OTHER_THEME_ID })
    await projects.load()
    api.refreshProjectState.mockResolvedValueOnce({ ...createSeedState(), themeId: OTHER_THEME_ID })
    await projects.refresh()
    await settle()
    expect(theme.confirmedThemeId).toBe(OTHER_THEME_ID)
  })
})
