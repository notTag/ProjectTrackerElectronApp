# PRD — Ticket #97: Script to apply a version number to a list of tickets

## Context
Ticket #51 added `tickets.version` (SemVer, set per ticket in the modal or by a lane agent via `sqlite3`). At release time the user wants to stamp one version on many tickets at once, e.g. every ticket shipping in `0.5.0`, instead of editing each modal or hand-writing SQL.

## Acceptance criteria
- Script takes a list of tickets and a version number
- Applies that version to every listed ticket

## Code today (verified 2026-11-17 on `917d257`)
- Column: `tickets.version TEXT`, NULL = unset. Ticket `number` unique per `project_path` only (`UNIQUE (project_path, number)`)
- Validation: `normalizeSemanticVersion` (`src/shared/projectTypes.ts:618`) — trims, strips leading `v`, `undefined` empty, `null` invalid
- DB path: `TRACKER_DATABASE_PATH` (`src/shared/projectTypes.ts:962`) = `~/Library/Application Support/Project Tracker/project-tracker.sqlite`
- App opens DB with `node:sqlite`, WAL + `busy_timeout`, polls `PRAGMA data_version` → outside writes show up live, no restart
- Existing scripts: `scripts/*.mjs` + sibling `*.test.mjs` (e.g. `check-release-env.mjs`), wired in `package.json` `scripts`
- Runtime: Node 22.23 (has `node:sqlite`); `.mjs` can't import the TS helper directly

## Decisions (defaults, no blockers)
- D1. File: `scripts/set-ticket-version.mjs` + `scripts/set-ticket-version.test.mjs`; `package.json` script `"set-version": "node scripts/set-ticket-version.mjs"`
- D2. CLI: `bun run set-version <version> <ticket> [<ticket>...]`
  - Version first, then tickets. Tickets = numbers, `#` prefix allowed, space or comma separated (`12 #14 15,16`)
  - Optional `--project <path>`; default = main checkout of the cwd repo (`dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`) so it works from worktrees
  - Optional `--db <path>`; default = tracker DB path. Lets tests and isolated-DB runs point elsewhere
- D3. Validation: SemVer regex copied into the script (same one as `normalizeSemanticVersion`, leading `v` stripped). Test asserts parity with the TS helper so they can't drift. Invalid → exit 1, nothing written
- D4. All-or-nothing: look up every ticket first; any number not found for that project → print the missing ones, exit 1, write nothing. Otherwise one `BEGIN IMMEDIATE…COMMIT` updating `version` + `updated_at` (ISO ms Z)
- D5. Overwrite existing versions; print one line per ticket `#12 <title>: 0.4.0 → 0.5.0` (`unset` when NULL) so overwrites are visible
- D6. Open DB with `PRAGMA busy_timeout = 5000` like the app, so it's safe while the app is running

## Requirements
- R1. Arg parsing: pure exported fn `parseArgs(argv)` → `{ version, ticketNumbers, projectPath?, dbPath? }` or throws usage error. Dedupe ticket numbers. No version or no tickets → usage message, exit 1
- R2. Pure exported fn `normalizeVersion(input)` mirroring `normalizeSemanticVersion`
- R3. Exported fn `applyVersion({ db, projectPath, version, ticketNumbers })` → per-ticket `{ number, title, from, to }`; throws listing missing numbers before any write
- R4. `main` only when run directly (same `pathToFileURL(realpathSync(...))` guard as `check-release-env.mjs`)
- R5. Tests (`vitest`, temp DB with minimal `tickets` table):
  - parseArgs: `#`/comma/space forms, dedupe, flags, missing version/tickets
  - normalizeVersion parity with `normalizeSemanticVersion` over valid + invalid cases (`v1.2.3`, `1.2.3-rc.1+b5`, `1.2`, `1.2.3.4`, `01.2.3`, empty)
  - applyVersion: sets version + updated_at; overwrites; missing number → nothing written; same number in another project untouched
- R6. Docs: usage line in `README.md` (or wherever scripts are documented)

## Out of scope
- Picking tickets by lane / label / PR / date (only explicit numbers)
- Clearing a version (set to NULL) — use the modal
- Bumping `package.json`, git tags, GitHub releases
- UI for bulk version edits
- Dry-run flag — output already shows from → to; add if wanted

## Risks
- Regex duplicated in `.mjs` — mitigated by the parity test
- Wrong project path → "not found" error, never a silent write to another board (numbers repeat across projects)

## Open questions
None.

## Branch / worktree
- Branch: `t97-create-a-script`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t97`

- PRD file: `docs/prd/t97-set-ticket-version.md` (committed on the branch)
