# PRD — Ticket #4: Milestone 3 hardening

Branch: `t4-milestone-3-hardening` · Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t4` · Source: GitHub issue #18

## Context
`PRD.md` → Milestone 3 (Hardening) is the last open milestone:
- Failure states are covered with tests.
- Packaged app smoke test is documented.
- Large scans and missing directories are handled gracefully.
- Storage repository boundaries are documented for future cloud/database migration.

Tests today cover happy paths (shared reducers, `StateRepository`, scanner helpers). The failure paths users actually hit are untested, and two of them live inline in `electron/main.ts`, which imports `electron` and can't be unit-tested.

## Code today (verified 2026-11-13 on `c36c25b`)
- Scanner: `scanProjectDirectories` (`electron/scanner/projectScanner.ts:86`).
  - Root missing / unreadable → `statSync` throws → `ScanFailure` with the fs message (`:151`).
  - Root is a file → `ScanFailure` `'Path is not a directory.'` (`:147`).
  - Unreadable dir during walk → `readdirSync` throws → `ScanFailure` (`:104`); unstat-able child → `ScanFailure` (`:136`).
  - Bounds: depth cap `depth >= 4` (`:129`), dot-dirs + `SKIP_NAMES` skipped (`:132`), stops descending at the first project marker (`:110`). Fully synchronous, no progress reporting.
  - Existing tests (`projectScanner.test.ts`) only cover `hasReadme`, `toGithubUrl`, nested naming.
- GitHub: `requestGithub` (`electron/main.ts:183`) — token from `resolveGithubToken()`, global `fetch`, status → message mapping (401 no token, 404 ±token, 401 with token, 403, other non-OK). `fetch` throwing (offline) propagates the raw `TypeError: fetch failed`. Callers already accept it as an injected fn (`prCounts(..., requestGithub)`, see `electron/metrics.test.ts:68`).
- SQLite startup: `StateRepository` constructor (`electron/storage/stateRepository.ts:196`) opens via `new DatabaseSync`, then PRAGMAs + schema in a transaction. A non-SQLite file throws (`file is not a database`) at the first statement. Called at `main.ts:724` inside `app.whenReady().then(async …)` with **no catch** → unhandled rejection, no window, app sits in the dock. This is a real user-facing bug, not just a missing test.
- `project:open-in` (`main.ts:436`): `assertTrustedSender` → type checks (`:444–445`) → `findOpenInTarget` allowlist → `assertScannedProjectPath` (path must be inside a scan dir) → launch; `catch` writes `cd "<path>"` to clipboard and returns `{ ok: true, fallbackCommand }` (`~:474`).
- `assertTrustedSender` (`main.ts:221`): no `senderFrame.url` → reject; dev server origin or `file://` (packaged) → allow; else reject. Reads module-level `devServerUrl` / `allowedDevOrigin`.
- Test runner: `bun run test` → `vitest run`. Packaging: `bun run dist` → `electron-builder --mac`.

## Requirements
R1. Scanner failure tests in `projectScanner.test.ts` (temp-dir fixtures):
- missing root → one `ScanFailure` for that path, no throw, other roots still scanned
- root is a file → `'Path is not a directory.'`
- unreadable subdir (`chmod 000`, restore in `afterEach`) → `ScanFailure` for it, sibling projects still found. Skip when `process.getuid?.() === 0` (root reads everything).

R2. Large-scan graceful handling (test, no new feature):
- fixture deeper than the cap → nothing below depth 4 visited
- `node_modules` / dot-dir containing markers → not reported as projects
- A wide fixture (e.g. ~500 dirs) completes and returns all projects — guards against an accidental O(n²) or recursion blow-up. No timing assertions.

R3. GitHub error mapping — extract `requestGithub` to `electron/githubRequest.ts` as a factory taking `fetch` and `resolveToken`; `main.ts` builds the real one. Tests pin each message:
- 401 no token / 401 with token / 404 no token (private-repo hint) / 404 with token / 403 / 500 → `HTTP 500`
- `fetch` rejects → readable message (new: `'Could not reach GitHub. Check your connection.'`), original error as `cause`
- success: GET without body, POST JSON with body, `Authorization` only when a token exists

R4. Corrupt / unreadable SQLite at startup:
- `stateRepository.test.ts`: garbage bytes written to the DB file → constructor throws; the original file is left byte-identical (no truncation, no overwrite).
- `main.ts:724`: wrap construction; on failure `dialog.showErrorBox` naming the DB path + error, then `app.quit()`. Never delete/rename the user's DB automatically.

R5. `project:open-in` validation + fallback — extract the payload checks and the launch/fallback decision into a pure-ish module (e.g. `electron/openIn.ts`) with launcher + clipboard injected. Tests:
- non-string `projectPath` / `targetId` → existing error messages
- unknown `targetId` (incl. `'constructor'`) → `Unknown open-in target`
- path outside scan dirs → rejected by the scanned-path check
- launcher throws → clipboard gets `cd "<path>"`, result has `fallbackCommand`
- ticket command present → copied to clipboard before launch

R6. Trusted sender — extract `isTrustedSenderUrl(senderUrl, devServerUrl)`; `assertTrustedSender` becomes a one-line wrapper. Tests: missing URL, `file://` packaged, dev origin in dev, foreign origin, `file://` while in dev mode → rejected.

R7. `docs/packaged-smoke-test.md` — numbered checklist for the `.app`, linked from README:
- `bun run dist`, open the built `.app` from `release/` (confirm actual output dir)
- first-run scan-directory prompt → pick dir → projects listed
- edit a project field + create/move a ticket
- quit (⌘Q), relaunch → edits survived
- corrupt-DB path from R4 shows the error dialog (on a copy of userData)
- open-in a terminal + an editor
- note macOS version + build hash tested

R8. `docs/storage-seam.md` — the boundary a server-backed store would replace, linked from README:
- public surface of `StateRepository` (list the methods callers use from `main.ts`)
- caller assumptions: synchronous calls, single local file under `userData`, per-user scoping via `userId`, row-level upserts of changed fields only
- outside-writer contract: WAL + `busy_timeout`, `PRAGMA data_version` polling (`hasExternalChanges`, `EXTERNAL_CHANGE_POLL_MS`)
- what a remote impl would need to change (async API → IPC handlers already `async`; change-notification instead of polling; conflict model = last writer wins per field today)

## Decisions (defaults, no blockers)
- D1. Extract, don't harness: no Electron test runner / Playwright. Pure modules with injected deps; `main.ts` keeps only wiring.
- D2. Tests pin current user-facing strings. Only new string: offline message (R3) and the startup error dialog (R4).
- D3. R4 fixes the silent startup hang (small, in scope — "failure states" includes the user seeing one). Recovery stays manual; the dialog names the file.
- D4. Large scans: verify bounds, don't add progress reporting or async scanning (`PRD.md` Risks already parks that).
- D5. Three new source files max: `githubRequest.ts` (R3), `openIn.ts` (R5), `trustedSender.ts` (R6 — every handler uses it, so not inside `openIn.ts`). No shared "ipc utils" grab-bag.

## Out of scope / follow-ups
- 403 always reads "rate limit reached"; a 403 can also be a token missing scope. Check `x-ratelimit-remaining: 0` to tell them apart → separate ticket.
- Other IPC handlers (`lane:auto-run`, `ticket:run-agent`, …) payload tests — same pattern, later.
- Scan progress / cancellation.

## Acceptance
- `bun run test` green, with a failing-path test for each of R1–R6.
- `bun run typecheck`/build clean (whatever `package.json` defines).
- Corrupt DB → error dialog + quit, verified manually once.
- `docs/packaged-smoke-test.md` + `docs/storage-seam.md` committed and linked from README.
- All four Milestone 3 bullets in `PRD.md` satisfied; mark the milestone done in `PRD.md`.
