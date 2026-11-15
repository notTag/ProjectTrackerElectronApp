# Storage seam

`StateRepository` (`electron/storage/stateRepository.ts`) is the only code that touches the database. A server-backed store would replace this class. This page lists what callers depend on, so a replacement knows what it has to keep and what it can change. For the tables themselves, see README → Data storage.

## Public surface

Called from `electron/main.ts`, the only caller outside tests:

| Method | Used by |
|--------|---------|
| `new StateRepository(userDataPath, userId = 'local')` | app startup. Throws on a corrupt or unreadable file, and startup then shows an error dialog and quits |
| `getState(): ProjectTrackerState` | `project-state:get`, `project-state:refresh`, and path checks in every IPC handler that takes a project path (`assertScannedProjectPath`) |
| `saveState(state): ProjectTrackerState` | `project-state:save` |
| `hasExternalChanges(): boolean` | 10-second poll (`EXTERNAL_CHANGE_POLL_MS`) that tells the renderer to refresh |
| `closedTicketMetrics(projectPaths, windows)` | `metrics:get` |

Row-level methods exist but only tests call them so far: `createTicket`, `updateTicket`, `moveTicket`, `deleteTicket`, `upsertSwimLane`, `deleteSwimLane`, `upsertProject`, `addProjectMember`, `setSetting`.

## What callers assume

- **Synchronous calls.** Every method returns a value directly; nothing is awaited. Path checks call `getState()` inline in the middle of a handler.
- **One local file.** `<userData>/project-tracker.sqlite`, opened once at startup and held for the life of the process. No connection pool, no reconnect.
- **Per-user scoping.** The constructor takes a `userId` (`'local'` today). Scan directories and settings belong to that user. Projects, lanes and tickets are shared rows, visible to members of the project.
- **Whole-state in, changed rows out.** The renderer sends the whole `ProjectTrackerState`. `saveState` compares it with the state it last returned and writes only the differences: changed fields for tickets, changed rows for everything else.

## Outside writers

Other processes write to the same file: a second app instance, the `sqlite3` CLI, agents updating tickets.

- WAL mode plus `busy_timeout = 5000`, so readers don't block the writer and a competing writer waits instead of failing. Writes use `BEGIN IMMEDIATE`.
- `hasExternalChanges()` compares `PRAGMA data_version` with its value at the last read. The value only moves when another connection commits.
- Conflict model: last writer wins per field. Nothing merges or detects conflicts.

## What a remote implementation would change

- **Go async.** The IPC handlers are already `async`, so `await repository.getState()` fits there. `assertScannedProjectPath` and the other inline `getState()` reads need an `await` or a cached copy of the scan directories.
- **Push instead of poll.** Swap the `data_version` poll for a change notification (websocket or server-sent events) that sends the same `project-state:external-change` event to the renderer.
- **Decide the conflict model.** Per-field last-writer-wins works for one person on several machines. Several people editing the same ticket need versioning on rows, an `updated_at` check on write, or merging.
- **Keep startup failure visible.** The local open can throw today. A remote store adds "server unreachable", which needs the same treatment: tell the user, don't hang.
- **Keep scan directories per machine.** `user_paths` lives on each machine because paths only make sense on the machine they came from. Don't sync them as shared data.
