# PRD — Ticket #85: Web app with full Electron feature parity

Branch: `t85-replicate-all-features`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t85`

## Context

Ticket asks for every Electron feature in the web app, and allows starting over. The approach in the ticket is decided. This PRD pins down how to build it against the code as it is today.

## Code today (verified 2026-11-16 on `f9a3efb`)

- Old `ProjectTracker/web-app/` and `ProjectTracker/api/` (empty) sit in the parent folder `/Users/nicktag/Code/Projects/ProjectTracker/`, which is **not a git repo**. Deleting them can't be undone with git.
- Renderer reaches the main process only through `window.projectTracker`. Preload: `electron/preload.cts`. Type: `ProjectTrackerElectronApi` in `src/env.d.ts`. Nothing makes the preload object conform to that interface.
- `electron/main.ts` registers 27 `ipcMain.handle` channels in `registerIpc()` (lines ~432–860). The ticket says 26. The extra one is `ticket:fetch-pull-request` (line 735).
  - Window-only, staying in main: `page-find:search`, `page-find:stop`, `theme:set-native`.
  - Platform-bound, needs an injected dependency: `dialog:pick-scan-directory` (`dialog.showOpenDialog`), `project:open-in` (`clipboard.writeText`, `shell.openPath` on non-mac).
  - The other 22 use only Node, `stateRepository`, and `app.getPath('home')`, which is the same as `os.homedir()`.
- Every handler calls `assertTrustedSender(event)` first (`electron/trustedSender.ts`).
- Main → renderer pushes:
  - `project-state:external-change`: sent by a 10 s `setInterval` (`EXTERNAL_CHANGE_POLL_MS`) when `stateRepository.hasExternalChanges()` returns true
  - `ticket:agent-retry`: sent to the calling `event.sender` from inside `ticket:run-agent`
  - `page-find:result`
- `StateRepository` keeps **one** diff baseline per instance (`saveState` → `writeChanges(normalized, this.baseline)`). `hasExternalChanges()` compares `PRAGMA data_version` against the version at the last read. `data_version` only moves when *another connection* commits.
- `node:sqlite` does not load under Bun 1.3.11 ("No such built-in module"). Node is v22.23.1. The server has to run on Node.
- `src/services/projectTrackerApi.ts` still has a browser fallback from the old web app: localStorage state (`project-tracker-state`), `fetch('/api/project-scan')`, and `requireElectron()` errors.
- Router uses `createWebHashHistory()` (`src/main.ts`), so a static server only has to serve `index.html`.
- CSP in `index.html` already allows `connect-src 'self'`. Same-origin fetch and EventSource work without changes.
- `tsconfig.electron.json` compiles `electron/**` and `src/shared/**` into `out/main`.

## Decisions (defaults, no blockers)

- D1. **One `StateRepository` per browser tab, not one per server.** Each tab gets a client id: a random UUID created by the web bridge and sent as an `X-Client-Id` header and an SSE query param. The server keeps `Map<clientId, StateRepository>`, created on first request and closed when that tab's SSE stream disconnects (after a 30 s grace period for reloads).
  - Why: a single shared repository would share one diff baseline. A stale tab's `saveState` would then write back old field values over another tab's edits.
  - With one connection per tab, a write from tab A moves `data_version` for tab B's connection. The existing `hasExternalChanges` and `refresh()` flow then works unchanged, the same as between the desktop app and agents.
  - `ponytail:` open connections grow with open tabs. That is fine for one local user.
- D2. **One generic route: `POST /api/invoke/<channel>`**, with a JSON body equal to the preload's payload, and a `{ result }` / `{ error: message }` response. The web bridge mirrors the preload's `invokePlain` line for line, so the payload shape can't drift. No REST design per resource.
- D3. **Server runs on Node**, compiled by the existing `tsconfig.electron.json`. Lives at `electron/web/server.ts`. No new framework: `node:http` plus a small static file server for `out/renderer`.
- D4. **No new dependencies.**
  - Folder chooser: `execFile('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose a project folder")'])`. Exit code 1 with `-128` means the user cancelled, which returns `null`.
  - Clipboard: `execFile('pbcopy')`, with the text written to stdin.
- D5. **Delete the legacy browser fallback** in `projectTrackerApi.ts` (localStorage state, `/api/project-scan` fetch, `requireElectron` message). Both builds now install a bridge, so the fallback is dead code that points at the deleted web app. Store tests mock the api module, so they're unaffected (verify).
- D6. **Delete, don't keep, the old dirs.** Move `ProjectTracker/web-app/` and `ProjectTracker/api/` to `~/.Trash` instead of `rm -rf`, because they aren't under git. Leave the other parent-folder leftovers (`projecttracker-state.json`, `scripts/scan-projects.sh`, `docs/`) alone. They're outside the ticket's scope. Update this repo's `PRD.md` "Current System" section, which still describes `web-app/`.
- D7. **Port.** Default `5174` (`5173` is the Electron dev server), overridable with `PROJECT_TRACKER_WEB_PORT`. If the port is taken, fail with a clear message. Don't pick a random port.
- D8. **Find on page.** `PageFind` doesn't render when `window.projectTracker.findInPage` is missing. In the interface, `findInPage`, `stopFindInPage`, `onFindResult` and `setNativeTheme` become optional (`setNativeTheme` is already called with `?.`). The browser's own ⌘F takes over.

## Requirements

### R1. Shared handler module — `electron/ipcHandlers.ts`
- Move the bodies of the 24 non-window handlers out of `registerIpc()` into `createIpcHandlers(deps)`, which returns `Record<IpcChannel, (payload: unknown, context: CallContext) => Promise<unknown>>`.
  - `deps`: `getRepository(context)`, `homeDirectory`, `pickDirectory()`, `writeClipboard(text)`, `openPath(path)`, plus anything else `registerIpc` closes over today (`availableAgents`, `assertScannedProjectPath` and its `getState()` reads, the warp config dir).
  - `CallContext`: `{ onAgentRetry(notice) }` and the client's repository.
- Validation, `normalizePath`, `assertScannedProjectPath`, the fixed-list id lookups and argv-only `execFile` move unchanged. No logic copied between the two callers.
- `electron/main.ts`: a loop of `ipcMain.handle(channel, (event, payload) => { assertTrustedSender(event); return handler(payload, contextFor(event)) })`. Page-find and theme stay inline. `contextFor` routes `onAgentRetry` to `event.sender.send('ticket:agent-retry', …)`.
- Export a `const IPC_CHANNELS = [...] as const` list that both sides import.

### R2. Web bridge — `src/services/webBridge.ts`
- `export const webBridge = { … } satisfies ProjectTrackerElectronApi`. Each method calls `invoke('<channel>', payload)` with exactly the payload `preload.cts` builds. `satisfies` makes `bun run typecheck` fail when the interface changes and the web bridge doesn't follow.
- Add a typed check on the preload too (e.g. `satisfies` on the `exposeInMainWorld` object, if `.cts` type imports allow it). Otherwise add a test that compares the preload's channel strings to `IPC_CHANNELS`.
- `onExternalChange` and `onAgentRetry`: one shared `EventSource('/api/events?client=<id>')`. Event names `external-change` and `agent-retry`. Agent-retry events go only to the tab that started the run.
- Install before mount: in `src/main.ts`, `if (import.meta.env.MODE === 'web') window.projectTracker = webBridge`. Desktop builds tree-shake it out.
- Errors: rethrow `new Error(message)` so existing helpers like `isGithubUnreachableError` still match.

### R3. Web server — `electron/web/server.ts`
- `listen(port, '127.0.0.1')`. Never `0.0.0.0`.
- Request guard, checked before any route (static included):
  - `Host` must be `127.0.0.1:<port>` or `localhost:<port>`. This blocks DNS rebinding.
  - `POST` also needs `Origin` equal to `http://127.0.0.1:<port>` or `http://localhost:<port>`, and `Content-Type: application/json`, which forces a CORS preflight that the server never approves.
  - Anything else gets `403`. No CORS headers, ever.
- Response headers: `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`. The meta tag's `frame-ancestors` is ignored by browsers.
- Body limit (e.g. 10 MB, which covers a full `saveState`). Unknown channel → `404`.
- Server-only poll: every 10 s, for each connected client whose repository `hasExternalChanges()`, send `external-change`. Same constant as main.
- Startup failure: if `new StateRepository(userData)` throws, print the same message as the desktop error box and exit non-zero.
- DB path: `~/Library/Application Support/Project Tracker`, overridable with `PROJECT_TRACKER_USER_DATA`, the same env var main honors.
- Print the URL on start. Opening the browser automatically is optional; if added, use `open <url>` via `execFile`.

### R4. Build and scripts — `package.json`, `vite.config.ts`
- `"web": "vite build --mode web --outDir out/web && tsc -p tsconfig.electron.json && node out/main/electron/web/server.js"`.
- Web mode needs `base: '/'` (desktop keeps `'./'`) and its own outDir, so the two builds don't overwrite each other.
- `build` and `dist` stay as they are. `electron-builder` `files` must not ship `out/web`. Check that the `out/**/*` glob doesn't pull it in, or have `rm -rf out` in `build` handle it.

### R5. Renderer tweaks
- `PageFind.vue`: render only when `findInPage` exists (D8).
- Folder picking: the scan dirs panel already has a path input (check during dev). If it doesn't, add a text input that takes an absolute path next to the ⊕ button, validated server-side by the existing `projects:scan` normalization.
- Any Electron-only labels ("desktop APIs are unavailable…") go away with D5.

### R6. Parity check
Walk `feature-map.md` sections 1–3 in the browser and confirm every item that the ticket's acceptance list names works. Left out on purpose: 1.1 Window, 1.2 Application menu and 1.9 Auto-update (out of scope), plus 1.4 PageFind (replaced). Record the walk-through in the PR body as a checklist.

### R7. Tests (vitest)
- `electron/web/server.test.ts`: start the server on port 0 against a temp `PROJECT_TRACKER_USER_DATA` and call routes with `fetch`:
  - state: get → save → refresh returns `null`. A write through a second client id makes the first client's refresh return state (proves D1).
  - tickets: create, update, delete
  - lanes: create, update, reorder, delete
  - projects: `project:update`, plus `project:read-readme` rejected for a path outside the scan dirs
  - agents: `ticket:run-agent` with an unknown agent id rejected. Don't spawn anything real.
  - origin: wrong `Origin` → 403, wrong `Host` → 403, missing JSON content type → 403
- An existing IPC-level test (if any), or a new one, confirms `main.ts` still routes through the shared handlers.
- `bun run typecheck` and `bun run test` pass. Test files must not leave temp dirs in the repo root (see memory: no `git add -A`).

### R8. Docs
- `README.md`: a "Web app" section covering `bun run web`, the URL, the port env var, local-only, and that the desktop app and the web app can run at the same time against the same DB.
- `feature-map.md`: add a section for the web mode (entry point, security guard, what's missing compared with desktop).
- `docs/storage-seam.md`: note that the web server is a second caller of `StateRepository`, with one instance per tab.

### R9. Manual check (run-app-before-merge)
- Back up the real DB with `sqlite3 … ".backup"` and point `PROJECT_TRACKER_USER_DATA` at a copy.
- Run `bun run web` and the desktop app at the same time against that copy.
- Move a ticket in the desktop app and see it in the browser within ~10 s. Do the same in reverse.
- Add a scan dir with the osascript chooser, Open In a terminal, ▶ Run an agent on a throwaway ticket, and confirm the PR state refresh works.

## Out of scope
As in the ticket: hosted or multi-user use, auth, remote DB, auto-update, the application menu, native chrome, `theme:set-native`, signing, module federation, and mobile layout work. Also out: a Vite dev-server mode with hot reload for the web build. Add it when someone needs to iterate on web-only UI.

## Risks
- **Local CSRF/DNS rebinding is the main threat.** The server can launch terminals and agents. The R3 guard is required, not nice to have, and the origin test must stay.
- `osascript choose folder` opens behind the browser window on some setups. The text-input fallback covers that.
- An agent run (`ticket:run-agent`) can take minutes on one HTTP request. Node's default `server.requestTimeout` (300 s) could cut it off. Set `requestTimeout = 0` for that route, or for the whole server since it's local-only.
- Refactoring `registerIpc` touches every desktop handler. Desktop regression risk is covered by the existing suite plus R9.

## Open questions
None. D1 (one repository per tab) and D6 (move the old dirs to Trash, leave the other parent-folder leftovers alone) are the calls most worth a second look in review.
