# PRD — Ticket #55: List every swimlane in the Display settings modal

## Context
The ⚙ Display modal's **Columns** section only offers No status and GitHub Issues. Every other lane is stuck on screen. The hide/show plumbing is already lane-agnostic; only the list the modal loops over is narrow.

## Acceptance criteria
- Columns lists every swimlane with a checkbox: No status first, then each lane in board order (GitHub Issues included where it exists)
- Added lane appears immediately; deleted lane drops out; renamed/reordered lane shows current name + position (no reopen/reload)
- Shown lane = checked, hidden lane = unchecked
- Toggling hides/shows the column immediately and saves to `hiddenLaneIds` (per user, per board, survives restart)
- New lanes start shown
- Header quick-toggle chips (No status, GitHub Issues) keep working and stay in sync with the checkboxes
- `feature-map.md` §3.5 says Columns lists all lanes
- Unit test: list = No status + all board lanes; a lane added to the board appears in it

## Code today (verified 2026-11-13 on `3a794ca`)
- `src/views/BoardView.vue`
  - `:113` `unassignedLane` = `getUnassignedLane(board)`
  - `:115` `laneColumns = [unassignedLane, ...board.lanes]` — already exactly the list this ticket wants, in render order
  - `:124-126` `hiddenLaneIds` / `laneIsHidden` / `toggleLaneVisibility` → `toggleHiddenLane` + `store.saveBoardPreferences`
  - `:139` `toggleableLanes` = No status + GitHub Issues lane (if present) — used by BOTH the header chips (`:904`) and the modal Columns list (`:1118`)
  - `:143` `visibleLanes` filters `laneColumns` by `hiddenLaneIds`
- `src/shared/projectTypes.ts:930` `getUnassignedLane`, `:1228` `toggleHiddenLane` (tested in `projectTypes.test.ts:384`)
- No Vue component test setup in the repo (no `@vue/test-utils`) → testable logic must live in `projectTypes.ts`

## Decisions (defaults, no blockers)
- D1. Modal iterates the same list the board renders. One source of truth = order and names can't drift from the board
- D2. Extract that list to a pure helper so it's unit-testable without a component harness:
  `export const boardLaneColumns = (board: ProjectBoard): SwimLane[] => [getUnassignedLane(board), ...board.lanes]`
  `laneColumns` in BoardView becomes `computed(() => boardLaneColumns(board.value))`
- D3. Header chips keep `toggleableLanes` unchanged. Sync with the modal is free: both read `laneIsHidden` off the same `preferences`
- D4. "New lanes start shown" needs no code: `hiddenLaneIds` is an opt-out list, a new id is never in it
- D5. Reactivity needs no code: `computed` over `board.lanes` re-evaluates on add/delete/rename/reorder

## Requirements
- R1. `src/shared/projectTypes.ts`: add `boardLaneColumns` (D2) next to `getUnassignedLane`
- R2. `src/views/BoardView.vue`:
  - `laneColumns` uses `boardLaneColumns` (import it)
  - Modal Columns `v-for` (`:1118`): `toggleableLanes` → `laneColumns`
  - Comment above `githubImportLane`/`toggleableLanes` updated to say it's the header chips only
- R3. `feature-map.md` §3.5: "**Columns**: a checkbox per column (No status first, then every lane in board order) to show or hide it. New lanes start shown."
- R4. `src/shared/projectTypes.test.ts`:
  - `boardLaneColumns` returns No status first, then `board.lanes` in order (ids compared)
  - Board with a lane pushed onto `lanes` → that lane is in the result, last
  - Board with no `unassignedLane` → still starts with `UNASSIGNED_LANE_ID`

## Verification
- `bun run test` (or project test script) green; `bun run typecheck`/build clean
- Manual: open ⚙ Display → all lanes listed; uncheck a middle lane → column disappears, header chips unaffected; add a lane with modal open → appears; toggle No status chip in header → modal checkbox follows; restart app → hidden state kept

## Out of scope
- Header chips for every lane
- Reordering lanes from the modal (t42)
- Pruning deleted lane ids from `hiddenLaneIds`
- Guard against hiding every column
- Show all / hide all controls

## Open questions
- None. Defaults above are low-risk; D1 (modal reuses `laneColumns`) is the only real call.

## Branch / worktree
- Branch: `t55-add-the-swimlane`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t55`
- PRD file: `docs/prd/t55-display-modal-all-lanes.md` (uncommitted in worktree)
