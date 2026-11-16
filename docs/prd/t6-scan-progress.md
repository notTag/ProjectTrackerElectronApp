# PRD — Ticket #6: Report scan progress and allow cancelling a running scan

## Context
`projects:scan` is one request/response round trip. Pointing the app at a large directory (home folder, external drive) gives a frozen-looking UI with no progress and no way out. The original PRD flagged this risk: "large directories may need progress reporting later."

Source: https://github.com/notTag/ProjectTrackerElectronApp/issues/16

## Acceptance criteria
- The scanner emits progress to the renderer as it walks (directories seen / current path).
- The dashboard renders that progress instead of an indefinite "Scanning...".
- A running scan can be cancelled and leaves stored state untouched.
- A scan directory that no longer exists reports which path failed and continues with the rest (already implemented — must get a regression test, see R6).

## Code today (verified 2026-11-15 on `c36c25b`)
- `scanProjectDirectories` (`electron/scanner/projectScanner.ts:86`) is fully sync: `readdirSync` / `statSync` / `existsSync` per directory, depth cap 4, stops descending at a project marker. Root failures (missing / not a directory) push a `ScanFailure` and continue (`:142-154`)
  - `statSync(directory)` inside `visit` (`:109`) sits outside the `try` — a dir that vanishes between `readdir` and `stat` throws out of the whole scan
- Runs on the Electron main process → a long walk blocks all IPC and `webContents.send`. Progress cannot be bolted onto the sync walk; the walk itself must yield
- IPC handler `projects:scan` (`electron/main.ts:402`): validates payload, returns `toPlainJson(scanProjectDirectories(...))`
- Push-event pattern to copy: `onExternalChange` / `onFindResult` in `electron/preload.cts` (listener wrapper that withholds the IPC event, returns an unsubscribe fn)
- Renderer API: `projectTrackerApi.scanProjectDirectories` (`src/services/projectTrackerApi.ts:39`) — Electron path, plus a browser fallback `POST /api/project-scan`
- Types: `ProjectTrackerElectronApi` in `src/env.d.ts`
- Store: `scan()` (`src/stores/projects.ts:548`) sets `scanning`, awaits IPC, then `save(mergeScannedProjects(...))`. State is only written after the scan resolves → cancel = skip that `save`, no rollback
- Dashboard: "Scanning..." label on the main Scan button (`src/views/DashboardView.vue:401`) and onboarding "Scan Folder" button (`:669`); Add button also disabled while scanning (`:394`)
- Tests: `electron/scanner/projectScanner.test.ts` has 3 tests (README detection, GitHub URLs, nested names). **No failure-path tests exist** — the ticket's "covered by #4" assumption is wrong. No store tests touch `scan()`

## Decisions (defaults, no blockers)
- D1. Async walk with `node:fs/promises` (`readdir`, `stat`, `access`), still sequential — one directory at a time. Each `await` yields the main-process event loop, so IPC and `sender.send` work during a scan. No worker thread, no parallel walking
- D2. Progress payload `{ directoriesSeen: number, currentPath: string }`. Emitted at most every 100 ms plus once at the end, so the IPC channel isn't flooded on fast disks
- D3. Cancel detection lives in the renderer: the store sets a local `cancelRequested` flag in `cancelScan()` and checks it after the IPC settles (resolve or reject). No parsing of Electron's `Error invoking remote method ...` strings
- D4. Main holds one `activeScan: AbortController | null`. A second `projects:scan` while one runs throws `A scan is already running.` (buttons are already disabled, this guards the IPC boundary)
- D5. `projects:scan-cancel` is idempotent: aborts the active scan if any, otherwise no-op. Trusted-sender check like every other handler
- D6. Progress goes to `event.sender` only (the window that asked), skipped if `event.sender.isDestroyed()`
- D7. Browser fallback (`/api/project-scan`): no progress, `cancelScan()` is a no-op, `onScanProgress` returns a no-op unsubscribe. Unchanged behavior
- D8. Cancel keeps nothing: no partial results, no `scanDirectories` change from `extraDirectory`, `state` untouched

## Requirements
- R1. Scanner (`electron/scanner/projectScanner.ts`):
  - Signature: `scanProjectDirectories(scanDirectories, hiddenPaths, thirdPartyPaths, options?: { onProgress?: (progress: ScanProgress) => void; signal?: AbortSignal }): Promise<ScanResult>`
  - `visit` becomes async; `readdirSync` → `readdir`, `statSync` → `stat`, `existsSync` → small `pathExists` helper over `access`. Marker / package-manager / git checks can reuse the `entries` list from the parent `readdir` instead of extra `access` calls where the file is in that dir
  - Move the in-`visit` `stat(directory)` into the existing `try` so a vanishing dir becomes a `ScanFailure`, not a crashed scan
  - `signal?.throwIfAborted()` at the top of `visit` and before each root → throws `AbortError`
  - Count every directory `visit` reads as seen; throttle `onProgress` per D2
  - Existing failure behavior unchanged: missing root, not-a-directory root, unreadable child → `ScanFailure`, scan continues
- R2. Shared type (`src/shared/projectTypes.ts`): `export interface ScanProgress { directoriesSeen: number; currentPath: string }` next to `ScanFailure`
- R3. IPC (`electron/main.ts`):
  - `projects:scan` handler becomes `async`; reject if `activeScan` is set (D4); create `AbortController`, pass `{ signal, onProgress }` where `onProgress` does `event.sender.send('projects:scan-progress', progress)` guarded by D6; clear `activeScan` in `finally`
  - New `projects:scan-cancel` handler per D5
- R4. Preload + API + types:
  - `electron/preload.cts`: `onScanProgress(callback) → unsubscribe` (copy `onFindResult` shape), `cancelScan: () => ipcRenderer.invoke('projects:scan-cancel')`
  - `src/env.d.ts`: add both to `ProjectTrackerElectronApi`
  - `src/services/projectTrackerApi.ts`: `onScanProgress` / `cancelScan` with D7 fallbacks
- R5. Store (`src/stores/projects.ts`):
  - State: `scanProgress: ScanProgress | null` (default `null`)
  - `scan()`: subscribe `onScanProgress` → `this.scanProgress = progress` before the IPC call; unsubscribe and clear `scanProgress` in `finally`. Reset `cancelRequested = false` at start
  - After the IPC settles: if `cancelRequested` → `notice = 'Scan cancelled.'`, `error = null`, return `false`, no `save` (both resolve and reject paths)
  - New action `cancelScan()`: no-op unless `scanning`; sets `cancelRequested`, calls `projectTrackerApi.cancelScan()`
- R6. Dashboard (`src/views/DashboardView.vue`):
  - While `store.scanning`: show "Scanned N folders" + current path (single line, CSS ellipsis, full path in `title`) next to the Scan button, and a secondary "Cancel" button calling `store.cancelScan()`
  - Same progress line + Cancel in the onboarding modal's actions
  - Before the first progress event arrives, show "Scanning..." as today
- R7. Tests:
  - `projectScanner.test.ts`: update existing call to `await`. New: `onProgress` called with increasing `directoriesSeen` and a final call whose count equals dirs visited; pre-aborted signal rejects with `AbortError` and visits nothing; abort mid-walk (abort inside `onProgress`) rejects; missing root + valid root → failure for the missing path and projects from the valid one; file-as-root → `Path is not a directory.`
  - `projects.test.ts`: mocked API — cancel during scan → `save` not called, `state` unchanged, notice `Scan cancelled.`; normal scan still saves; `scanProgress` reset to `null` after
- R8. Docs: `feature-map.md` — scan progress line and Cancel button on dashboard + onboarding

## Verification
- `bun run typecheck`, `bun run test`
- Run the app on an isolated DB copy (per memory: never the live DB), add a large scan dir (e.g. `~`), click Scan → counter + path update, UI stays responsive (open another board / modal mid-scan), click Cancel → "Scan cancelled.", project list unchanged. Scan again to completion → results saved

## Out of scope
- Worker-thread scanner, parallel walking, partial results on cancel
- Progress for the browser fallback
- Aborting the scan when the window closes (result is discarded anyway)
- ETA / percentage (total dir count unknown up front)

## Branch / worktree
- Branch: `t6-report-scan-progress`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t6`
- PRD file: `docs/prd/t6-scan-progress.md` (in worktree, uncommitted)
