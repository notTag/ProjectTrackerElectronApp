# PRD — Ticket #118: Application Scalability testing

## Problem
Nobody knows how many tickets one board can hold before creating or opening a ticket gets slow. We want to find that point before a real board reaches it.

## Goal
A repeatable harness that grows one board on an isolated DB copy, times **Ticket Creation Time** and **Ticket Access Time** at each checkpoint, and stops at the first checkpoint where creation takes more than 5s. Output is a PDF report plus the raw CSV.

## Current behaviour (verified in code)
- `electron/main.ts:32`: `PROJECT_TRACKER_USER_DATA` → `app.setPath('userData', …)` before anything reads userData. The DB is `<userData>/project-tracker.sqlite`.
- Bulk path: `window.projectTracker.createTicket(projectPath, ticket)` (`electron/preload.cts:43`) → `'ticket:create'` (`electron/ipcHandlers.ts:352`) → `StateRepository.createTicket` (`electron/storage/stateRepository.ts:521`). It numbers the ticket inside the transaction, so callers leave `number` out.
- **The renderer does not see bulk-created tickets.** `store.refresh()` (`src/stores/projects.ts:589`) calls `project-state:refresh`, which returns `null` unless `hasExternalChanges()`. That flag is `PRAGMA data_version`, and data_version only moves when a *different* connection commits. IPC writes go through the app's own connection, so they never move it. After each bulk fill the harness must reload the page (`Page.reload`) before it touches the UI. Otherwise the board stays stale, and a whole-state `project-state:save` from the stale store could diff the bulk tickets away.
- UI path (`src/views/BoardView.vue`):
  - `+ Ticket` button (`:1539`, `class="secondary"`, title "What you want to build") → `startTicketDraft()` → draft modal `.modal.ticket-modal` with eyebrow "New ticket" (`:1880`).
  - Title: `input.ticket-title-input` (`v-model`). Save: `.modal-actions button` with text "Save", disabled until the title is non-blank (`:1942`). `saveTicketDraft` → `store.addTicket(...)`.
  - Card: `article.ticket` inside `.lane-body`, `@click="openTicketId = ticket.id"` (`:1706-1714`).
  - Open modal: `.modal.ticket-modal`, whose header eyebrow reads `#<number> · Created …` (`:1966-1970`). Its `@focusin` triggers `store.refresh()`.
  - Close: click on `.modal-backdrop` itself (`@click.self="closeModals"`).
- Routes: `#/` dashboard, `#/board/:projectPath` (`src/main.ts:18-19`, hash history).
- The CDP recipe is in `docs/packaged-smoke-test.md` and `docs/prd/t85-web-app-parity.md`. Node 22 has a global `WebSocket`, so no `ws`/playwright dependency is needed.
- PDF: Electron's `webContents.printToPDF` is already available, so no new dependency is needed.
- Machine for the run: Apple M2, 16 GB, macOS 26.6.2, Node 22.23.1, app `0.7.0` (package.json), Electron ^35.4.

## Decisions (defaulted under full auto; flip here if wrong)
- D1 — **Build under test**: `bun run build`, then `PROJECT_TRACKER_USER_DATA=<scratch>/userdata ./node_modules/.bin/electron . --remote-debugging-port=9333`. That is the production renderer from `out/`, not the Vite dev server (dev HMR/devtools skew timings). Not the signed `.app`: the `dist` build needs notarize env and doesn't change renderer perf.
- D2 — **Isolation** (acceptance criterion 1):
  1. `sqlite3 "<live db>" ".backup '<scratch>/userdata/project-tracker.sqlite'"`. Never `cp`, because of WAL.
  2. Verify: `PRAGMA integrity_check` on the copy = `ok`, and `SELECT count(*) FROM tickets` on the copy = the same query on the live DB, read back-to-back. The harness aborts on mismatch. A mismatch can be a live agent write between the two reads, so retry the backup once before failing.
  3. In the copy, point `user_paths` rows with kind='scan' at `<scratch>/projects`, so a Scan never walks real repos.
  4. The harness refuses to start if the resolved userData equals the real `~/Library/Application Support/Project Tracker`.
- D3 — **Throwaway project**: `<scratch>/projects/scale-board` with `git init` + `package.json` + `README.md` (the scanner skips bare dirs). Added by clicking the dashboard **Scan** button over CDP. Raw `scanProjectDirectories` does not persist. The board's default lanes come from that.
- D4 — **Scratch dir**: `$TMPDIR/pt-scale-<timestamp>`, created by the harness and removed at the end unless `--keep`.
- D5 — **Bulk fill** goes through `window.projectTracker.createTicket` in a `Runtime.evaluate` loop. Tickets are spread round-robin across the board's lanes, which is more realistic than one 20k-card lane and puts the load on the board render either way. Each gets a title `Fill <n>` and a fixed ~500-char description, about the size of a real ticket. Fill time is logged but is not a measured metric. After each fill: `Page.reload`, then wait for `article.ticket` count = DB count before timing.
- D6 — **Timing runs in the renderer**: `performance.now()` around a `Runtime.evaluate` (awaitPromise) that clicks through `element.click()`, so the real Vue handlers run. It waits on a DOM condition (rAF poll), then waits two more rAFs so the result has been painted.
  - Creation: start → click `+ Ticket` → set the title input value to a unique `Sample <checkpoint>-<k>` + dispatch `input` → wait for Save to be enabled → click Save → stop when an `article.ticket` containing that title exists.
  - Access: start → click that card → stop when `.ticket-modal` exists and its eyebrow contains `#<number>`. Then close via the backdrop and wait for the modal to be gone (untimed).
  - Sample timeout: 30s. A timeout is recorded as `timeout` and counts as > 5s.
- D7 — **Samples**: 3 create+access pairs per checkpoint. "One timed sample" = the first pair, "median of 3" = the median of all three. Both go in the CSV and report. The **stop rule uses the median creation time** (> 5s), so one GC pause can't end the run. The samples add 3 tickets. The next fill tops up to the next target, so every checkpoint starts at exactly its target count.
- D8 — **Checkpoints**: 10, 20, … 100, then 200, 300, … Stop at the first checkpoint whose median creation > 5s. Also stop at 20,000 tickets or 60 min wall time (fill + samples). The report says which of the three ended the run.
- D9 — **Outputs**:
  - `docs/reports/t118-scaling-raw.csv`: `checkpoint,ticket_count,sample,creation_s,access_s,fill_s,iso_time`
  - `docs/reports/t118-scaling-report.pdf`
- D10 — **Report rendering**: `scripts/scale-report.mjs` reads the CSV and builds one HTML page: inline SVG line chart with x = ticket count, y = seconds, a creation series, an access series and a dashed 5s threshold line. Below the chart: the raw data table, machine/app/Electron version + git SHA, the method (this D-list in brief), and where the run stopped and why. Run as `electron scripts/scale-report.mjs <csv> <pdf>`: a hidden `BrowserWindow`, `loadURL(data:…)`, `printToPDF`. It re-renders from the CSV alone, so no rerun is needed. No chart library.
- D11 — **Harness**: `scripts/scale-test.mjs`, a plain Node ESM script with no new deps. It does D2 → D3 → launch → loop → CSV → calls `scale-report.mjs` → kills the app → cleans scratch. A `package.json` script `"scale-test": "node scripts/scale-test.mjs"` makes it repeatable.
- D12 — **Self-check**: pure helpers (checkpoint sequence, median, stop decision) exported from the harness and covered by `scripts/scale-test.test.mjs`, matching the existing `scripts/*.test.mjs` pattern.

## Requirements
- R1 — Backup made with `.backup`, integrity `ok`, ticket count matches live. The harness aborts otherwise.
- R2 — The app under test runs only against the scratch userData. The live DB gets no writes, only the backup read.
- R3 — Throwaway git-init'd project added via dashboard Scan in the isolated DB.
- R4 — Checkpoints 10…100 by 10, then by 100. At each: 3 creation + 3 access samples through the real UI path, with ticket count recorded.
- R5 — Stops at the first median creation > 5s, or at 20,000 tickets / 60 min with "cap reached" in the report.
- R6 — `docs/reports/t118-scaling-report.pdf` + `docs/reports/t118-scaling-raw.csv` committed. The PDF has the chart (2 series + 5s line), raw table, machine/app version, method, and stop reason.
- R7 — `scripts/scale-test.mjs` + `scripts/scale-report.mjs` committed. `bun run scale-test` reproduces the run.
- R8 — `bun run test` passes, including the new helper test.

## Verification
- Run `bun run scale-test` end to end once, then open the PDF and check the chart, table and stop reason.
- Spot-check the scratch DB: `SELECT count(*) FROM tickets WHERE project_path = '<scratch>/projects/scale-board'` equals the last CSV ticket count + 3.
- Confirm the live DB ticket count didn't jump by thousands.

## Out of scope
- Fixing any slowness found. File follow-up tickets that name the checkpoint and metric.
- Multi-project / many-board scaling, web mode (`bun run web`), GitHub Issues sync.
- Profiling *why* it's slow (flame graphs etc.) beyond what the timings show.

## Branch / worktree
- Branch: `t118-application-scalability-testing`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t118`
