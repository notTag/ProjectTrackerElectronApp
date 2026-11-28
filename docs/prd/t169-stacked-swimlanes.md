# PRD — Ticket #169: Allow for multiple swimlanes to exist within the same column

## Work location
- Branch: `t169-allow-for-multiple`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t169`

## PRD needed?
Yes. Touches schema, the board diff/save path, lane drag (1D → 2D), keyboard shortcuts, layout and docs.

## Context (verified in code, 2026-11-28)
- Lanes are one flat ordered list: `swim_lanes.position` (`electron/storage/schema.ts:72`), rendered as one row of `<section class="lane">` in `src/components/board/BoardLanes.vue:~370`.
- Lane drag is X-only: `startLaneDrag` / `trackLaneDrag` / `endLaneDrag` (`BoardLanes.vue:119-197`). `laneAnchorAt(pointerX, draggedLaneId)` (`:135`) picks the anchor; `laneDragStyle` (`:199`) writes only `translateX`.
- Drop → `store.moveLane(projectPath, laneId, beforeLaneId)` (`src/stores/projects.ts:416`) → `moveLaneInBoard` (`src/shared/projectTypes.ts:1681`). Optimistic, re-applied on the persist queue, undo anchored on the old next neighbour.
- Save path is a diff: `writeBoard` → board diff in `projectTypes.ts:~2300-2370` emits `lane:update` for every changed lane field (`changedFields`) and one `lane:reorder` when order changes. **So a new lane field + a pure placement helper needs no new IPC channel** — the diff writes flags and order together.
- Add-only migrations: column list in `electron/storage/schema.ts:~205-230` (`{ table, column, definition }`).
- Lane row ↔ `SwimLane`: mapper `stateRepository.ts:~205-225` (e.g. `closesTicket: asBool(row.closes_ticket)`), upsert `stateRepository.ts:~955-975` (column list + `ON CONFLICT ... excluded.*`).
- Workflow snapshots: `laneRowsJson` = `SELECT * FROM swim_lanes` (`stateRepository.ts:761`); restore via `insertLaneRow`, which keeps only real `swim_lanes` columns (`:781`). A new column rides along automatically; old snapshots lacking the key fall back to the DB default 0.
- Swimlane Store save strips `project_path`, `position`, `graph_position_json` (`stateRepository.ts:809`).
- Keyboard: Alt+← / Alt+→ on a focused header (`moveLaneByKeyboard`, `BoardLanes.vue:215`); `aria-keyshortcuts` at `:387`.
- Lane width: `preferences.laneWidths[laneId]` via `setLaneWidth` (`projectTypes.ts:2192`), not a DB column.
- No status lives outside `board.lanes`, always first, can't move.
- Graph view (`src/components/TicketGraph.vue`) places lanes by `graph_position_json`, independent of board order.
- Docs: `feature-map.md:294` ("Reordering" bullet).

## Goal
A board column can hold 2+ lanes stacked vertically. Users build stacks by dragging a lane header above or below another lane.

## Requirements

### R1 Data model
- Keep the flat ordered list. Add `swim_lanes.stacks_below_previous INTEGER NOT NULL DEFAULT 0` to the schema `CREATE TABLE` and the add-only migration list. Existing boards: every lane its own column.
- `SwimLane.stacksBelowPrevious?: boolean` in `projectTypes.ts`. A lane with `true` shares the column of the lane before it in `board.lanes` order.
- Mapper (`asBool`), upsert column list + `excluded.` assignment, and `lane:update` patch → column mapping carry it. Workflow snapshots carry it with no code change (verify by test).
- First lane in `board.lanes` is always a column start: `laneColumns` ignores its flag; the placement helper clears it.
- Swimlane Store save also strips `stacks_below_previous` (an added store lane lands in its own column at the end).
- One pure helper derives columns: `laneColumns(lanes: SwimLane[]): SwimLane[][]` in `projectTypes.ts`. Used by board render, drag hit-testing and keyboard moves.

### R2 Render
- `BoardLanes.vue` renders one `.lane-column` (flex column, 12px gap = board gap) per column; lanes stack inside it.
- Column width = top lane's saved width. Resizing any lane in a stack writes the top lane's width (`setLaneWidth(prefs, topLaneId, w)`).
- Stacked lanes split column height equally (`flex: 1 1 0; min-height: 0`); each lane's card list scrolls on its own. `LaneCardList.vue` virtualization keeps working per lane (its scroll container must get a bounded height).
- Single-lane columns look exactly like today (no visual diff).

### R3 Drag to stack
- Drop target chosen in 2D while dragging a lane header:
  - Pointer over the top / bottom third of another lane → stack above / below it. Horizontal drop indicator across that lane's top / bottom edge.
  - Pointer over a column gap or a lane's middle third → today's behaviour: own column before that column. Vertical indicator.
- Drag transform becomes `translate(x, y)` (drop the X-only lock).
- Dropping a stacked lane on a column gap un-stacks it into its own column.
- Dropping into the lane's own slot → no-op, no save (helper returns the same board object, as `moveLaneInBoard` does).
- Escape still cancels.
- Target type, e.g.:
  ```ts
  type LanePlacement =
    | { kind: 'column'; beforeLaneId: string | null }      // own column before that column's top lane; null = end
    | { kind: 'stack'; anchorLaneId: string; side: 'above' | 'below' }
  ```

### R4 Save
- New pure `placeLaneInBoard(board, laneId, placement): ProjectBoard` in `projectTypes.ts` returns new order + flags together; returns `board` unchanged when nothing moves. `moveLaneInBoard` stays (or becomes `placeLaneInBoard(..., { kind: 'column', beforeLaneId })`).
- Flag rules inside the helper:
  - `column` → moved lane flag `false`; it must not land inside another stack, so `beforeLaneId` is always a column-start lane.
  - `stack above X` → moved lane takes X's flag, X gets `true`.
  - `stack below X` → insert after X (after X, not after X's whole stack), moved lane `true`.
  - Lane leaving a stack as its top → the next lane in that stack gets `false` (becomes column start).
  - First lane of result → `false`.
- Store: `moveLane` → `placeLane(projectPath, laneId, placement)`. Same optimistic pattern: apply now, re-apply on the persist queue. Undo = `placeLaneInBoard` with the lane's original placement (derived from its original neighbour + flag before the move), so concurrent edits survive. `writeBoard`'s diff then emits `lane:update` (flags) + `lane:reorder` (order) in one `updateBoard`. No new IPC.

### R5 Keyboard
- Alt+↑ / Alt+↓ on a focused header: move lane up / down within its stack. No-op on a stack's top (↑) / bottom (↓) and on single-lane columns.
- Alt+← / Alt+→: move the lane one column left / right as its own column (unchanged semantics; un-stacks a stacked lane).
- `aria-keyshortcuts` → `'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown'`.

### R6 Guards
- No status stays its own first column; nothing stacks with it (no stack targets on it; dropping before it = first column).
- Lanes can't move while a lane filter is set (unchanged).

### R7 Filters / hidden lanes
- Derive columns from full `board.lanes`, then drop hidden lanes. Hidden lane in a stack → not rendered; rest of the stack still renders as one column. Column with every lane hidden → not rendered.

### R8 Order readers untouched
- First lane for + Ticket, next-lane defaults, lane pickers, Auto Run, graph view keep using flat `board.lanes` order. Stacking is layout only.

### R9 Docs
- `feature-map.md:294` "Reordering" bullet: stacking via drag top/bottom third, un-stack via column gap, Alt+↑/↓. Lane width note: stacked column width follows its top lane.

## Acceptance criteria
- [ ] Dragging a lane header onto the top / bottom part of another lane stacks it above / below that lane; board shows both lanes in one column.
- [ ] Dragging a stacked lane to a column gap puts it back in its own column.
- [ ] Stacking survives app restart, workflow switch (both directions) and a second window / refresh.
- [ ] Existing boards render unchanged after migration.
- [ ] Alt+↑/↓ reorders within a stack; Alt+←/→ still moves between columns.
- [ ] Ticket card drag-and-drop into a stacked lane moves the ticket to that lane.
- [ ] Unit tests: `laneColumns` (incl. first-lane flag ignored, hidden lanes), `placeLaneInBoard` (stack above/below, unstack, top-of-stack leaving, no-op returns same board), migration default 0, workflow snapshot round-trip keeps the flag, store save strips it. Existing lane drag tests pass.
- [ ] `bun run test` + typecheck pass. App run on an isolated DB copy before merge.

## Out of scope
- Semantic meaning of stacking (parallel branches, fan-out/fan-in). Flow still follows Next Lane / move rules.
- Graph view changes.
- Per-lane heights / resizable split inside a stack.
- Collapsing lanes within a stack.
- Lane Store remembering stack placement.

## Decisions (defaults, full auto)
- Flat list + `stacks_below_previous` flag over a column table: `position`, `lane:reorder`, snapshots and all order readers keep working.
- No IPC change: existing board diff already emits `lane:update` + `lane:reorder` from one board update.
- Column width follows top lane; equal vertical split.
- Stacking is purely visual.

## Open questions
- None.
