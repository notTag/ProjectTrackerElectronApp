# PRD — #111 Persist selected theme to the DB

## Why a PRD
- Small change, but it crosses storage (new `user_settings` key), shared types, the renderer theme store, and boot ordering. A save that fires before project state loads would write seed state over the real DB, so the ordering rules need to be written down.

## Problem
- The selected theme is lost across restarts.

## Root cause (verified in code, 2026-11-19)
- `src/stores/theme.ts` → `createThemeStore` (`@nick_tag_tech/themes/pinia`, `dist/adapters/pinia.js`) persists only to `localStorage['project-tracker-theme']`.
	- `loadThemeId()` runs once at store creation: `resolveThemeId(localStorage.getItem(key))`.
	- `setTheme(id)` sets `themeId`, clears preview, writes localStorage. `previewTheme`/`revertPreview` touch only `previewingId`.
- localStorage is origin-scoped. Dev loads `VITE_DEV_SERVER_URL` (port moves when 5173 is taken), packaged loads `file://`. Each origin has its own storage.
- Other per-user settings already live in SQLite `user_settings` (`board_preferences`, `electron/storage/schema.ts:246`).

## Existing path to reuse
- `settingsOf(state)`, `electron/storage/stateRepository.ts:120`, maps state → `user_settings` keys. The writer (`:879`) diffs against the baseline, so a key is written only when it changes.
- `load` reads settings at `stateRepository.ts:486` (`boardPreferences: parseJson(...)`).
- Renderer: `saveBoardPreferences` in `src/stores/projects.ts:305` → `this.save(state => ({ ...state, boardPreferences }))`. Copy this shape.
- Projects store starts as `createSeedState()` (`projects.ts:261`). `load()` (`:562`) is called from views (`DashboardView.vue:168`, `BoardView.vue:618`), not from `App.vue`.
- `App.vue:61` already owns the theme effect (`useThemeEffect(currentTheme)`).

## Changes
1. Types — `src/shared/projectTypes.ts` `ProjectTrackerState`: add `themeId?: string` (optional, so older state still loads; per-user like `boardPreferences`).
2. Schema — `electron/storage/schema.ts`: `export const SETTING_THEME = 'theme'`. No migration; `user_settings` is key/value.
3. Repository — `stateRepository.ts`:
	- `settingsOf`: `[SETTING_THEME]: state.themeId`. When the value is `undefined`, follow `SETTING_SCANNED_AT` (it can already be undefined).
	- load: `themeId: this.readSetting(SETTING_THEME)`.
4. Projects store — `saveThemeId(themeId)` action: `this.save(s => ({ ...s, themeId }))`. Add a non-persisted `loaded` flag, set true only after `load()` succeeds. If an existing equivalent turns up, use that instead.
5. Theme sync — put it in `App.vue` beside `useThemeEffect`, or in a small `useThemePersistence()` in `src/stores/theme.ts`. Keep it to two watchers:
	- DB → UI: watch `projects.state.themeId`. Once `loaded`, if it is set and differs from `confirmedThemeId`, call `themeStore.setTheme(resolveThemeId(id))`. `setTheme` also refreshes the localStorage cache.
	- UI → DB: watch `confirmedThemeId`. Once `loaded`, if it differs from `projects.state.themeId`, call `projects.saveThemeId(id)`. Preview changes `activeThemeId` only, so hover is never saved.
	- Migration: on the first `loaded` with no `state.themeId`, save the current `confirmedThemeId` (read from localStorage at store creation). Only do this if localStorage actually has a value; otherwise leave the DB unset and use the default. This happens once, because afterwards the DB has a value.
6. Keep `createThemeStore` and its localStorage write as the first-paint cache. The library stays unchanged.

## Ordering rules
- Never call `saveThemeId` before `loaded`: `save` would write `createSeedState()` over the real DB.
- DB wins over localStorage once loaded.
- `refresh()` (writes from another process) brings in a new `themeId` → the DB → UI watcher applies it. That is fine: same user, same DB.
- A brief flash is acceptable when the localStorage cache is stale (e.g. a new dev port) until state loads. No bootstrap script is added (YAGNI).

## Acceptance criteria
- Pick a theme → quit → relaunch → same theme.
- Survives a dev-server port change and switching between dev and packaged builds (same DB).
- Hover preview is never persisted; only a confirmed selection is.
- An unknown or removed theme id in the DB falls back to the default via `resolveThemeId`.
- Existing localStorage theme is adopted into the DB on first run.
- Unit test (`electron/storage/stateRepository.test.ts`, near the `boardPreferences` test at ~:867): `themeId` round-trips, and is per-user (Alice sets it, Bob sees `undefined`).
- Optional store test (`src/stores/projects.test.ts`): `saveThemeId` sends `themeId` in the saved state.

## Out of scope
- Inline bootstrap script for no-flash first paint.
- Changing `@nick_tag_tech/themes`.

## Notes for dev lane
- The worktree has no `node_modules`. Run `bun install` before tests.
- Manual check: drive the app on an isolated DB copy (see memory: drive-app-via-cdp). Pick a theme, restart, confirm it stuck. Also confirm `SELECT value FROM user_settings WHERE key='theme'`.

## Open questions
- None.
