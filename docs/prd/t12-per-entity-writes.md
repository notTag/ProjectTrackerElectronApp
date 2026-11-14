# PRD — Ticket #12: Replace whole-state IPC saves with per-entity writes

Source: https://github.com/notTag/ProjectTrackerElectronApp/issues/10
Branch: `t12-replace-whole-state`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t12`

## Context
README → Known limits: "Every save still sends the entire state over IPC … The renderer doesn't call the row-level repository methods yet."

The main-process diff (`saveState` vs `baseline`) already stopped the SQLite write amplification. What is left:
- Every edit ships the whole `ProjectTrackerState` over IPC, then a full `getState()` read back. Completion moves add a second full round trip
- Correctness depends on main's `baseline` matching what the renderer holds. That's why `refresh()` and `writeState()` share `saveQueue`
- The row-level repo methods have no IPC channel and no caller

## Code today (checked 2026-11-13 on `c36c25b`)
- `src/stores/projects.ts`
  - `updateBoard(projectPath, mutate, alsoCompletedIds)` (`:181`) → `save()` → `writeState()` (`:481`). Every board edit goes through it: `addLane`, `updateLane`, `removeLane`, `addTicket`, `updateTicket`, `markAgentRunSeen`, `removeTicket`, `pullGithubIssues`, auto-run worktree placement (`:708`), `BoardView.vue:638` external links
  - `moveLane` (`:224`) is optimistic: it applies the move, then calls `save(redo, undo)`
  - `writeState`: candidate → `withCompletionMoves` → `saveProjectState` → `handoffsBetween(candidate, fresh)` → a second save if the fresh read carries outside completions
  - `refresh()` (`:412`): applies the fresh read, then whole-state saves any completion moves it triggers
  - `updateProject` (`:582`): notes / priority via `setNotes` / `setPriority`. `setStatus`, `toggleHidden`, `toggleThirdParty` also touch `hiddenPaths` / `thirdPartyPaths`
- `electron/storage/stateRepository.ts`
  - `getState` sets `baseline` (`:358`). `saveState` diffs and returns `getState()` (`:366`)
  - `createTicket` numbers inside a transaction (`:372`)
  - `updateTicket` (`:382`) re-reads the row, merges the patch and **always stamps `updatedAt`**, which breaks `markAgentRunSeen` (it deliberately doesn't stamp)
  - `deleteTicket`, `upsertSwimLane`, `deleteSwimLane`, `setSetting`: bare `run`, no `transaction()`
  - `upsertProject` writes the whole row from the caller's copy. There's no patch variant
  - None of them touch `baseline`
- `electron/main.ts:391` `project-state:save` → `isProjectTrackerState` (`:244`) validation, `assertTrustedSender`, `toPlainJson`

## Decisions (defaults, no blockers)
- D1 Keep the scope: the goals are a smaller IPC payload, no renderer↔baseline coupling for edits, and row-level methods that agents / the CLI can share later
- D2 Per-entity channels return the written entity (the row as stored), not a state re-read. Outside changes come only through `refresh()` (poll / focus / external-change event)
- D3 No compare-and-swap on `updated_at`. Last write wins stays, and stays documented
- D4 **The renderer diffs, the store dispatches.** Keep `updateBoard(projectPath, mutate)` and its in-queue mutate (callers rely on reading the latest state inside the queue, e.g. external links). Add a pure `boardWrites(before, after)` that turns the board change into per-entity calls. Every existing caller moves onto per-entity writes and no call site needs rewriting. A new action calling the API directly is fine, but not required
- D5 A multi-entity edit (GitHub import, worktree placement, completion moves) becomes a sequence of per-entity calls with no cross-call transaction. A partial failure is recoverable: imports dedupe on `external_id` and placements re-run. `ponytail:` note on the dispatcher; add a `board:apply` batch channel if partial writes become a problem
- D6 Any failed per-entity call → apply `undo` if given, then a full `getProjectState()` re-read. Renderer state and main's baseline both reset to the DB, so neither can drift
- D7 Settings stay on whole-state (scan dirs, hidden / third-party paths, board preferences). So do `setStatus` / `toggleHidden`, since they change `hiddenPaths` in the same edit

## Requirements

### R1 IPC channels
Each new handler calls `assertTrustedSender`, validates its payload (throws `Invalid … payload.` like the existing handlers) and returns `toPlainJson(...)`. Wire every channel through `electron/main.ts`, `electron/preload.cts` (`invokePlain`), `src/env.d.ts` and `src/services/projectTrackerApi.ts` (with the same plain-JSON and no-bridge fallback as `saveProjectState`)
- `ticket:create` `{ projectPath, ticket: Omit<Ticket,'number'> }` → `Ticket` (repo-numbered)
- `ticket:update` `{ id, patch }` → `Ticket`. Patch keys must be ticket fields other than `id` / `number` / `createdAt`
- `ticket:move` `{ id, laneId }` → `Ticket`
- `ticket:delete` `{ id }` → `void`
- `lane:create` `{ projectPath, lane: SwimLane }` → `SwimLane` (appended last)
- `lane:update` `{ projectPath, laneId, patch: Partial<Omit<SwimLane,'id'>> }` → `SwimLane` (same patch shape as `updateLaneInBoard`)
- `lane:reorder` `{ projectPath, laneIds: string[] }` → `void`
- `lane:delete` `{ projectPath, laneId }` → `void`
- `project:update` `{ path, patch: Partial<Pick<ProjectRecord,'notes'|'priority'|'status'>> }` → `ProjectRecord`
- Validation: reuse the ticket / lane shape checks behind `isProjectTrackerState`, extracting them into `isTicket` / `isSwimLane` if they're inline. Normalize `projectPath` with `normalizePath` like the scan handlers do
- Repo throws (unknown id, etc.) propagate to the renderer as a rejected invoke

### R2 Repository
- `updateTicket`: stamp `updatedAt` only if the patch doesn't carry it. Callers that edit already send it, and `markAgentRunSeen` doesn't send it so its no-stamp behavior survives. Field-level merge onto the freshly read row stays as it is
- New `updateSwimLane(projectPath, laneId, patch)`: read row, merge, upsert at its current position, in one transaction
- New `reorderSwimLanes(projectPath, laneIds)`: one transaction that sets `position` for every listed lane. Lanes on the board but not listed (added by another writer) keep their relative order after the listed ones
- New `updateProject(path, patch)`: read row, merge only `notes` / `priority` / `status`, `writeProjectRow`, in one transaction. `upsertProject` stays for scan merges
- `lane:create` → `upsertSwimLane` at `max(position)+1`
- Wrap `deleteTicket`, `upsertSwimLane`, `deleteSwimLane` in `transaction()`
- `createTicket` stays the only source of ticket numbers on these paths. The renderer's number is ignored and the returned one wins
- **Baseline patch:** after each per-entity commit, splice the written row (or the removal / new positions) into `this.baseline` when a baseline exists. A later `saveState` then doesn't see the entity as a renderer-side change and can't revert it. One private helper per entity kind, not a re-read of the whole state

### R3 Renderer store
- `src/shared/projectTypes.ts`: pure `boardWrites(before: ProjectBoard, after: ProjectBoard): BoardWrite[]`. Order:
  1. lane creates
  2. lane updates (changed fields only)
  3. ticket creates
  4. ticket updates (changed fields only, `undefined` kept as an explicit clear)
  5. lane reorder (only if the id order changed)
  6. ticket deletes
  7. lane deletes
  - Lanes come first so tickets never point at a missing lane, and deletes come last so a removed lane's tickets move out before the lane goes. Unchanged entities produce nothing
- `writeState` (whole-state path) splits into:
  - `writeBoard(projectPath, mutate, undo?, alsoCompletedIds)` on `saveQueue`:
    1. `before = this.state`, then `candidate = mutate(before)`
    2. `withCompletionMoves(before, candidate, alsoCompletedIds)`
    3. `boardWrites(beforeBoard, settledBoard)` → dispatch sequentially
    4. splice each returned entity into `this.state`, so created tickets get repo numbers
    5. `handoffsBetween(candidate, this.state)` → full-auto handoffs
  - On failure → D6
  - `writeState` is kept unchanged for R5 callers only
- `updateBoard` and `moveLane` call `writeBoard`. `moveLane` keeps its optimistic apply and anchored undo. `addTicketToBoard` / `addGithubIssuesToBoard` can keep assigning a provisional number for the optimistic view. The repo's number replaces it once the write returns
- `updateProject` → `project:update`, then splice into `snapshot.projects`
- `refresh()`: outside completion moves → `ticket:move` per moved ticket instead of `saveProjectState`. Fresh-read handling is otherwise unchanged
- `save()` keeps its boolean return and its `saving` / `error` handling, so `pullGithubIssues` / `saveLaneAgentMarkdown` `if (!saved)` checks still work

### R4 Completion moves + full-auto
- Own edits: completion moves and handoffs come from locally patched state (above). The second "outside completions in the fresh read" write is gone from the edit path
- Outside changes: only `refresh()` detects them. It already computes `handoffsBetween(previous, fresh)` and runs `startFullAutoHandoffs` after the queue
- Notices: `completionMovesNotice(moved)` stays on both paths

### R5 Whole-state `project-state:save` remains for
- Seed state (`getState` on an empty DB)
- `scan()` → `mergeScannedProjects`
- `addScanDirectory` / `removeScanDirectory`, `toggleHidden`, `toggleThirdParty`, `setStatus`
- `saveBoardPreferences`
- Update the `ponytail:` comment above `saveState` to say exactly this

### R6 Tests
- `electron/storage/stateRepository.test.ts`
  - each per-entity write (ticket create / update / move / delete, lane create / update / reorder / delete, project update) leaves unrelated rows untouched: a ticket in another lane and another project, other lanes' positions, project rows
  - the same holds when a second connection changed those rows between the read and the write
  - `updateTicket` without `updatedAt` in the patch stamps it; with `updatedAt` it keeps the given value
  - `reorderSwimLanes` with a lane missing from the list keeps that lane on the board
  - Baseline: a per-entity write followed by `saveState(stateFromBeforeTheWrite + unrelated change)` doesn't revert the entity
- `src/shared/projectTypes.test.ts`: `boardWrites` emits nothing for an identical board, only the changed fields for one ticket field edit, and lane-before-ticket / delete-last ordering
- `src/stores/projects.test.ts`
  - `updateTicket`, `addTicket`, `removeTicket`, `addLane`, `updateLane`, `moveLane`, `removeLane` and `updateProject` call the per-entity API and never `saveProjectState`
  - a created ticket takes the repo-returned number
  - a failed write reverts the optimistic `moveLane` and triggers a re-read
  - a completion move triggered by an edit starts a full-auto handoff with no fresh read
  - `scan` / `saveBoardPreferences` still use `saveProjectState`

### R7 Docs
- README Known limits:
  - replace the first bullet: ordinary edits send only the changed entity. Scans, scan-directory / hidden / third-party edits and board preferences still send whole state and are diffed in main
  - multi-entity edits aren't atomic (D5)
  - keep the last-write-wins bullet
- `feature-map.md`: only if it documents the save path

## Done when
- [ ] Per-entity IPC channels exist for ticket create / update / move / delete, lane create / update / reorder / delete, and project field edits
- [ ] Ordinary edits call them, and `saveProjectState` is only reached from R5 callers
- [ ] Repository tests show that per-entity writes leave unrelated rows alone and don't get reverted by a later whole-state save
- [ ] `bun run test` + typecheck green; README Known limits updated

## Out of scope
- Per-entity channels for settings / board preferences
- Optimistic concurrency / conflict UI
- Main pushing change notifications instead of polling
- `board:apply` batch channel (D5 upgrade path)

## Open questions
None. All defaults are taken above. D4 (diff-and-dispatch rather than rewriting each action) is the main call to revisit in review.

## Branch / worktree
- Branch: `t12-replace-whole-state`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t12`
