# PRD — Ticket #59: DB Snapshots for backup

## Problem
The whole board lives in one file, `~/Library/Application Support/Project Tracker/project-tracker.sqlite`. Agents and the `sqlite3` CLI write to it directly, so one bad `UPDATE` or a corrupt file loses every ticket. The only backup today is the one-time `project-tracker.pre-wal-backup.sqlite` taken during the sql.js → WAL upgrade (`backUpLegacyDatabase`, `electron/storage/stateRepository.ts:235`).

## Goal
Rolling snapshots, so any of the last 7 days (or any manual backup) can be restored by hand.

## Current behaviour (verified in code)
- `StateRepository` constructor (`stateRepository.ts:196`): `mkdirSync(userData)` → open `DatabaseSync` → `PRAGMA busy_timeout = 5000` → legacy backup (`copyFileSync`, only for non-WAL files) → `journal_mode = WAL` → schema/migration transaction.
- `main.ts:722-724`: `configureApplicationMenu()` runs **before** `new StateRepository(...)`. Menu click handlers read the module-level `stateRepository` at click time, so the order is fine.
- File menu today (`main.ts:322`): `submenu: [{ role: 'close' }]`.
- `shell` and `dialog` are already imported in `main.ts`.
- Tests: `stateRepository.test.ts` builds a fresh `mkdtempSync` userData per test (`freshUserDataPath`) and cleans up in `afterEach`.

## Decisions (open questions resolved)
- D1 — **Mechanism**: `VACUUM INTO ?` on the app's own connection, with the path as a bound parameter (SQLite takes any expression there, so no string-quoting of the path). It reads one consistent snapshot through the WAL, so commits still sitting in `-wal` are included and uncommitted ones from other connections are not. `copyFileSync` would miss the `-wal`.
- D2 — **Placement**: right after `PRAGMA busy_timeout`, before the legacy backup, WAL switch and schema transaction. Busy timeout must come first: VACUUM INTO needs a read lock another process can briefly hold. Snapshotting before migrations means a migration bug can always be rolled back. Only when the DB file existed before open (`databaseExisted`), since a fresh file has nothing worth saving.
- D3 — **File name**: `snapshots/project-tracker-<UTC>.sqlite`, UTC as `YYYY-MM-DDTHH-mm-ss-SSSZ` (`new Date().toISOString()` with `:` and `.` → `-`). Colons show as `/` in Finder. Milliseconds stop two quick "Back Up Now" clicks colliding (VACUUM INTO fails if the target exists). The names sort lexically = chronologically.
- D4 — **24h gate**: list `project-tracker-*.sqlite` in `snapshots/`, take the newest by name, skip if its `mtime` is less than 24h old. That uses mtime as the ticket asks, and tests can backdate it with `utimesSync`, so no clock injection is needed.
- D5 — **Retention**: `const SNAPSHOT_RETENTION_COUNT = 7`. After each successful snapshot, sort by name, `rmSync` all but the newest 7. Only files matching the snapshot pattern are touched, so anything else the user drops in the folder stays.
- D6 — **Failure handling**: the launch snapshot runs in `try/catch`, and a failure goes to `console.warn('[snapshot] …', error)`. Startup keeps going. A half-written target file from a failed VACUUM INTO is removed (`rmSync(path, { force: true })`) so it can't count as the newest snapshot and suppress the next day's.
- D7 — **Output journal mode**: VACUUM INTO writes a rollback-journal (non-WAL) file. That's what we want: a single self-contained file, and the app switches it to WAL when it opens after a restore.
- D8 — **Menu feedback**: `Back Up Database Now` → on success `shell.showItemInFolder(snapshotPath)` (gives visible confirmation without a new dialog); on failure `dialog.showErrorBox`. `Show Backups in Finder` → `mkdirSync(snapshotsPath, { recursive: true })` then `shell.openPath(snapshotsPath)` (`openPath` fails on a missing dir).
- D9 — The manual backup ignores the 24h gate but still prunes.

## Requirements
- R1 — Launch with an existing DB and no snapshot younger than 24h → one new file in `<userData>/snapshots/`.
- R2 — Launch with a snapshot younger than 24h → no new file.
- R3 — After any snapshot, at most 7 `project-tracker-*.sqlite` files remain, the newest ones.
- R4 — A snapshot includes WAL-only committed rows, excludes other connections' uncommitted rows, and passes `PRAGMA integrity_check`.
- R5 — A snapshot failure never throws out of the constructor.
- R6 — File menu: `Back Up Database Now`, `Show Backups in Finder`, separator, `Close`.
- R7 — README Data storage section documents the location and restore steps.

## Implementation
`electron/storage/stateRepository.ts`
- Export `SNAPSHOTS_DIRECTORY_NAME = 'snapshots'`, `SNAPSHOT_RETENTION_COUNT = 7`.
- Store `private readonly snapshotsPath` (set in the constructor).
- `backUpNow(): string` (public) → `mkdirSync(snapshotsPath, recursive)`, build the path, `this.db.prepare('VACUUM INTO ?').run(path)`, prune, return the path. Throws on failure (on failure, remove the partial file first).
- `private snapshotIfStale()` → newest snapshot mtime check, then `backUpNow()` inside `try/catch` + `console.warn`.
- `private pruneSnapshots()` → keep newest `SNAPSHOT_RETENTION_COUNT`.
- `get snapshotsDirectory()` (public) so `main.ts` doesn't rebuild the path.
- Constructor: `if (databaseExisted) this.snapshotIfStale()` right after `busy_timeout`.

`electron/main.ts`
- File submenu per R6 / D8. Handlers guard `stateRepository` being undefined (the menu is built before the repo exists).

`README.md` — after the DB path block in "Data storage":
- Location: `~/Library/Application Support/Project Tracker/snapshots/`, one on launch at most every 24h, the newest 7 kept, plus `File → Back Up Database Now`.
- Restore: 1) quit the app (and stop agents writing to the DB) 2) copy the chosen snapshot over `project-tracker.sqlite` 3) delete `project-tracker.sqlite-wal` and `project-tracker.sqlite-shm` 4) relaunch.

## Testing
`electron/storage/stateRepository.test.ts`, new `describe('snapshots')`, using `freshUserDataPath`. A first `new StateRepository(dir)` creates the DB, and snapshots only start from the second open (D2).
1. **create**: open, then open a second instance on the same dir (`StateRepository` has no `close()`; WAL allows several connections, and the existing two-instance tests already do this) → `snapshots/` has 1 file. It opens with `DatabaseSync` and `integrity_check` = `ok`.
2. **24h skip**: reopen again → still 1. Backdate it with `utimesSync` by 25h, reopen → 2.
3. **prune**: write 8 dummy `project-tracker-2000-01-0NT…Z.sqlite` files, call `backUpNow()` → 7 remain, the oldest names are gone, the new one is present. A non-matching file in the dir survives.
4. **WAL consistency**: second `DatabaseSync` on the same file with `PRAGMA wal_autocheckpoint = 0`. It inserts a committed row (WAL-only), then `BEGIN IMMEDIATE` + inserts an uncommitted row. Repo `backUpNow()` → the snapshot has the committed row, not the uncommitted one, and `integrity_check` = `ok`. Roll back the second connection afterwards.
5. **failure doesn't block**: create `snapshots/` and `chmodSync(0o500)`, backdate/empty → `new StateRepository(dir)` doesn't throw and `loadState()` works. Restore the mode to 0o700 before cleanup.
- Manual: `bun run dev`, click File → Back Up Database Now (Finder reveals the new file), then File → Show Backups in Finder.
- `bun run test` and `bun run build` are green.

## Out of scope
- Restore UI, configurable schedule/retention, cloud or off-machine sync. Add them when manual restore proves painful.
- Snapshotting on quit, or periodically while the app runs (launch + manual covers the ticket).

## Open questions
None. The defaults above stand. D8 (Finder reveal as the success feedback) is the main judgement call and is easy to swap for a dialog in review.

## Branch / worktree
- Branch: `t59-db-snapshots-for`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t59`
