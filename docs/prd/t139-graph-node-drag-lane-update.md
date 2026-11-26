# PRD — Ticket #139: BUG: Graph view lane node drag fails (`lane:update` rejected)

## Summary
Dropping a dragged lane node in the graph view shows `Error invoking remote method 'lane:update': Error: Invalid lane update payload.` and the position is lost. Fix so the drop persists `graphPosition`, make the validation error say which key was rejected, and add an IPC-level regression test.

## Evidence (verified on main @ b0f8dd9)
- Drop path: `src/components/TicketGraph.vue:144` `dropNode()` → `emit('editLane', lane, { graphPosition })` → `src/views/BoardView.vue:1085` `editLane` → `store.updateLane` → `boardWrites` (`src/shared/projectTypes.ts:2251`) diffs lane vs baseline with `changedFields` → `{ kind: 'lane:update', patch }` → `src/stores/projects.ts:243` → preload `invokePlain` (JSON round-trip, so `undefined` keys drop) → `electron/ipcHandlers.ts:437`.
- Validator: `LANE_PATCH_FIELDS` (`electron/ipcHandlers.ts:241`) includes `graphPosition`; `isPatchOf` (`:262`) accepts `null` or `{x,y}` finite numbers. A plain `{ graphPosition: {x,y} }` patch passes on current main.
- Timeline: `graphPosition` was added to the whitelist in babd8ab (#131, 11-25 02:01). Screenshot 02:46. Installed app v0.8.0 has no graph drag → error came from a dev build.
- No status node: `TicketGraph` gets `:lanes="visibleLanes"`, so the unassigned lane can be dragged. `updateSwimLane` (`electron/storage/stateRepository.ts:574`) already handles `UNASSIGNED_LANE_ID` with no row (creates it via `createUnassignedLane()`, position -1).
- Tests: `electron/storage/stateRepository.test.ts:286` covers repository-level `graphPosition`. `electron/web/server.test.ts:168` (`describe('lanes')`) drives the real handlers through `invoke('lane:update', …)` but never sends `graphPosition`. No IPC test covers it.

## Root-cause hypotheses (in order)
1. Stale dev main process (leading). electron-vite hot-reloads the renderer only; a main process started before babd8ab keeps the old whitelist without `graphPosition` → exactly this error.
2. Extra or invalid key in the diffed patch: a `REQUIRED_TEXT_KEYS` field arriving as non-string, a lane field without a `LANE_PATCH_FIELDS` entry (e.g. from #133 workflows), or a non-finite x/y.
3. Unassigned-lane-specific diff: `before.unassignedLane ?? createUnassignedLane()` baseline vs the dragged object yielding keys the validator rejects.

## Scope
In:
- Reproduce on a fresh dev start of main (isolated DB copy, per the CDP recipe memory).
- If it reproduces: find the rejected key, fix its source.
- Error message names the rejected key(s).
- IPC regression test.

Out:
- Graph layout or drag UX changes.
- Changing `boardWrites` / `changedFields` semantics beyond what the root cause needs.

## Implementation plan
1. Repro: kill all dev processes, `bun run dev` on this branch (= main), drag a normal lane node and the No status node, then restart and confirm the position stuck.
2. Error detail (do this first; it's the diagnostic): change `isPatchOf` to report the first bad key instead of a bare boolean. Keep it small, e.g. a `rejectedPatchKey(allowedKeys, value): string | undefined` helper that returns the offending key (or `'<not an object>'`), with `isPatchOf` = `rejectedPatchKey(...) === undefined`. In `lane:update` throw `Invalid lane update payload: rejected key "<key>".` Apply the same helper to `ticket:update` since it shares `isPatchOf` (one change, both callers).
3. If step 1 reproduced: use the new message to name the key, fix where that key comes from (whitelist entry if it's a real lane field, or the renderer diff if it's junk). If it didn't reproduce: record "stale main process" as the cause in the PR; no further code change.
4. Regression test in `electron/web/server.test.ts` `describe('lanes')`:
   - `lane:update` `{ graphPosition: { x: 310, y: 140 } }` on a normal lane → returned lane has it; `project-state:get` shows it.
   - `{ graphPosition: null }` clears it (`undefined` on read).
   - Same two on `UNASSIGNED_LANE_ID` with no prior row.
   - `{ graphPosition: { x: 'a', y: 1 } }` and `{ bogus: 1 }` reject with a message containing the key name.
5. Verify "fails before fix": the rejected-key assertions fail on main as-is (message has no key). The graphPosition-accept cases pass on main by design if hypothesis 1 holds; note that in the PR.

## Acceptance criteria
- [ ] Dragging a lane node saves its position with no error toast.
- [ ] Position survives an app restart.
- [ ] Dragging the No status node saves the same way.
- [ ] Invalid lane patches report which key was rejected (ticket patches too, shared helper).
- [ ] New `server.test.ts` cases pass; the rejected-key case fails on unmodified main.
- [ ] `bun run test` + typecheck clean.
- [ ] App launched and drag exercised on an isolated DB copy before merge.

## Files
- `electron/ipcHandlers.ts` — rejected-key helper, error messages
- `electron/web/server.test.ts` — regression tests
- Possibly `src/shared/projectTypes.ts` or `LANE_PATCH_FIELDS`, only if step 1 reproduces

## Branch / worktree
- Branch: `t139-bug-graph-view`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t139`

## Open questions
None.
