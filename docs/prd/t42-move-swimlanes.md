# PRD — Ticket #42: Move swimlanes

## Problem
Lane order is frozen at creation. New lanes append; the only reorder path is delete + recreate, which dumps that lane's tickets into No status. Boards drift from the real workflow (GitHub Issues prepended on first import, custom lanes like "Value" land after In Production).

## Goal
Drag a lane by its header to a new horizontal slot. The order is board data: saved to `swim_lanes.position`, survives restart, same for every user of the board.

## Non-goals
- Moving No status (`UNASSIGNED_LANE_ID`, stored at position -1).
- Vertical / multi-row layouts.
- Per-user lane order.
- Reordering tickets inside a lane.
- Animating sibling lanes aside. A static insertion line is enough.
- Auto-scrolling the board while dragging near an edge (follow-up if boards outgrow the window).

## Decisions on the ticket's open questions
- **Handle = whole `.lane-heading`**, with a 4px move threshold before a drag starts. A double-click never crosses the threshold, so `@dblclick="startTicketDraft"` keeps working. After a real drag, swallow the trailing `click`/`dblclick` so a drop never opens a ticket draft.
- **Keyboard reorder ships in v1**: `Alt+←` / `Alt+→` on a focused header (`tabindex="0"`) moves the lane one slot and saves. It reuses the same helper, so it's a few lines, and it gives the feature a non-pointer path.

## Existing code this builds on
| Concern | Where | Notes |
|---|---|---|
| Lane order persistence | `electron/storage/stateRepository.ts` `positionedLanes()` / `writeBoardChanges()` | Array index → `position`. Only lanes whose row changed get upserted. No schema change. |
| Board mutation | `src/stores/projects.ts` `updateBoard()` | New `moveLane` action routes through it like `updateLane` / `removeLane`. |
| Pure board helpers | `src/shared/projectTypes.ts` `updateLaneInBoard` / `removeLaneFromBoard` | New helper sits next to them. |
| Render order | `src/views/BoardView.vue` `laneColumns` → `visibleLanes` | No status prepended at render time; hidden lanes and `filterLaneId` filtered out. |
| Pointer-drag pattern | `BoardView.vue` `startLaneResize` / `trackLaneResize` / `endLaneResize` | One state object in a ref, `setPointerCapture`, save once on release. Copy this shape. |
| Esc handling | `BoardView.vue` `handleBoardKeydown` | Escape currently closes modals, else leaves the board (`router.push('/')`). A lane drag must claim Escape first. |

## Requirements

### R1. Pure helper — `moveLaneInBoard`
`moveLaneInBoard(board, laneId, beforeLaneId | null): ProjectBoard` in `src/shared/projectTypes.ts`.

- Removes `laneId` from `board.lanes` and reinserts it immediately before `beforeLaneId`, or at the end when `null`.
- **Anchor by lane id, not visible index.** The UI only sees `visibleLanes`; `board.lanes` may contain hidden lanes (e.g. a hidden GitHub Issues lane). Converting a visible index to an array index is where order corruption would come from. An anchor id lands in the right place in `board.lanes` no matter what is hidden, and hidden lanes keep their relative position.
- Returns the same `board` object (no-op) when: `laneId` is `UNASSIGNED_LANE_ID`, `laneId` is unknown, `beforeLaneId === laneId`, or the resulting order equals the current order. Returning the original reference lets the caller skip the save.
- `beforeLaneId === UNASSIGNED_LANE_ID` is treated as "before the first lane" — nothing can land ahead of No status since it isn't in `board.lanes`.

### R2. Store action
`moveLane(projectPath, laneId, beforeLaneId)` in `src/stores/projects.ts`, calling `updateBoard(projectPath, (board) => moveLaneInBoard(...))`.

### R3. Pointer drag on the header
State: one ref, e.g. `laneDrag = { laneId, pointerId, startX, dx, active, beforeLaneId }`, mirroring `laneResize`.

- `pointerdown` on `.lane-heading`: ignore if the target is inside a `button` (Auto Run ▶, ⚙) or the lane is No status. Ignore non-primary buttons. Record `startX`.
- `pointermove`: once `|dx| ≥ 4`, set `active`, call `setPointerCapture`. While active:
  - Apply `transform: translateX(${dx}px)` to the dragged `.lane` only. Y is never touched, so there is no vertical drift wherever the pointer goes.
  - Compute `beforeLaneId` from the midpoints of sibling `.lane` elements in `visibleLanes` (excluding the dragged lane and No status): first sibling whose midpoint is right of the pointer X; `null` past the last.
- `pointerup`: if active and the pointer is inside the `.board` rect, call `store.moveLane(...)` once. Outside the rect → cancel. Then clear state.
- `pointercancel` → cancel.
- Dragged lane gets a class (raised z-index, slight opacity/shadow) so it reads as lifted; `user-select: none` on the board while active.

### R4. Drop indicator
A vertical insertion line rendered at the gap before `beforeLaneId` (or after the last visible lane). Position it from the target lane's left edge; no layout shift of siblings. Hidden when the drop would be a no-op (the lane's current slot).

### R5. Cancel
- **Esc** while a drag is active: reset transform, clear state, `preventDefault`, and return before `handleBoardKeydown` reaches its `router.push('/')` branch. Simplest: check `laneDrag.active` at the top of the Escape path.
- Drop outside the board, `pointercancel`, or a no-op drop: nothing saved.

### R6. Filters and hidden lanes
- Hidden lanes (`preferences.hiddenLaneIds`) are never rendered, so never anchors; R1's id anchoring keeps them in place.
- When `filterLaneId` is set only one lane is visible: lane drag is disabled (no siblings to reorder against, and dropping "before nothing" would wrongly send the lane to the end).

### R7. Keyboard reorder
`.lane-heading` gets `tabindex="0"` (not on No status). `Alt+ArrowLeft` → anchor = previous visible sibling; `Alt+ArrowRight` → anchor = the visible sibling two to the right (or `null`). Saves immediately. Focus stays on the moved header.

### R8. Nothing else regresses
- Ticket card HTML5 drag between lanes (`draggable="true"`, `@drop="dropOnLane"`): unaffected — lane drag listens on the header only and uses pointer events, not `dragstart`.
- Lane resize (`.lane-resize-handle`): separate element, separate state.
- Double-click header / empty lane body creates a ticket draft: preserved by the threshold + post-drag click suppression.
- Header buttons click normally.

## Acceptance criteria
- [ ] Drag a lane by its header; it follows the pointer on X only.
- [ ] Insertion line shows the landing gap.
- [ ] Drop saves; order survives restart (check `swim_lanes.position` in the DB).
- [ ] No status can't be dragged and nothing can land before it.
- [ ] With GitHub Issues hidden, moving a visible lane leaves GitHub Issues at its same relative slot in `board.lanes`.
- [ ] Lane filter active → lane drag disabled.
- [ ] Esc mid-drag cancels and does NOT navigate away from the board.
- [ ] Drop outside the board cancels; nothing written.
- [ ] Alt+←/→ on a focused header moves the lane one slot and saves.
- [ ] Ticket drag, lane resize, double-click-to-create, header buttons all still work.
- [ ] `bun run test` (vitest) and `bun run typecheck` pass, including new `moveLaneInBoard` tests.

## Tests (`src/shared/projectTypes.test.ts`)
`moveLaneInBoard`:
1. Moves a lane left (before an earlier lane) and right (before a later lane).
2. `beforeLaneId = null` moves to the end.
3. Hidden-lane case: board `[gh, a, b, c]`, UI sees `[a, b, c]`; move `c` before `a` → `[gh, c, a, b]` (gh keeps its slot).
4. No-op returns the same reference: dropped before itself, dropped before its current right-hand neighbour, unknown id, `UNASSIGNED_LANE_ID`.
5. `beforeLaneId = UNASSIGNED_LANE_ID` → lane becomes first of `board.lanes`.
6. Tickets are untouched (same `laneId`s).

Optional: one `stateRepository.test.ts` case — save a reordered board, reload, assert lane order.

## Risks
- **Index vs id**: mitigated by anchoring on lane id (R1).
- **Escape leaks to navigation**: mitigated by R5 ordering in `handleBoardKeydown`.
- **Click after drag**: a pointerup on the header can fire `click`; suppress once after an active drag.
- **Concurrent edits**: lane moves rewrite `position` for every lane between old and new slot. Another user's simultaneous move → last writer wins, same as any board edit today.

## Files expected to change
- `src/shared/projectTypes.ts` — `moveLaneInBoard`
- `src/shared/projectTypes.test.ts` — tests
- `src/stores/projects.ts` — `moveLane`
- `src/views/BoardView.vue` — header pointer/keyboard handlers, drag state, indicator, Escape guard
- `src/styles.css` — dragging lane + insertion line styles
