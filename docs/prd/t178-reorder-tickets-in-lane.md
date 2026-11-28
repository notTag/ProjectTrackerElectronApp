# PRD — #178 Allow tickets to be reordered in a swimlane

## Why a PRD
- It touches storage (new columns, migration, a trigger), the shared ordering helper, the store's move path, drag UI and keyboard. And every non-drag lane writer, including agents using the sqlite3 CLI while the app is closed, must agree on what "bottom of the lane" means. One wrong path and cards jump around on reload.

## Today (verified 2026-11-28)
- Load order: `SELECT * FROM tickets … ORDER BY number` (`electron/storage/stateRepository.ts:1101`)
- `groupTicketsByLane` (`src/shared/projectTypes.ts`) keeps input order. `BoardView.vue` computes `ticketsByLane` and `ticketsInLane` from it.
- Card drag: `TicketCard.vue` (`src/components/TicketCard.vue`, `draggable="true"`) emits `drag-start`. Then `BoardLanes.vue` runs `startTicketDrag` and, on drop, `dropOnLane(laneId)` (line 319) → `ticketIdsToMove` → `store.moveTickets` (`src/stores/projects.ts:554`).
	- `ticketIdsToMove` drops tickets already in the target lane, so a same-lane drop is a no-op today
	- Drop target = the whole lane (`@drop.prevent` on the lane `section`). Where in the lane you drop is ignored.
- Multi-select carry rule: `carriedTickets` / `carriedTicketIds` (`projectTypes.ts`), plus the stacked ghost in `buildStackGhost`
- Lane reorder already has the patterns to copy:
	- Pointer anchor: `laneAnchorAt(pointerX, draggedLaneId)`, which finds the first sibling midpoint and returns `beforeLaneId` and an indicator position
	- Indicator: `.lane-drop-indicator`
	- Keyboard: `moveLaneByKeyboard` (Alt+Arrow, `event.target === event.currentTarget` guard, `nextTick` refocus)
- Save path: `writeBoardChanges` → `writeTicketRow` diffs against the baseline with `changedFields` and lays only the edited fields over the current row. So writing positions touches only the rows whose position changed.
- Migration: `ADDED_COLUMNS` (`electron/storage/schema.ts:189`) + `addMissingColumns`
- Trigger precedent: `CLOSED_AT_TRIGGERS_SQL` (`schema.ts`) exists because agents write `lane_id` with sqlite3 while the app may be closed. The same reason applies here.
- `LaneCardList.vue` (`src/components/LaneCardList.vue`) virtualizes lanes over 50 cards, but the cards under the pointer are always mounted

## Decisions
- D1 — Storage: two new nullable `tickets` columns, both added through `ADDED_COLUMNS`:
	- `lane_position INTEGER` → `Ticket.lanePosition?: number`
	- `lane_position_lane_id TEXT` → `Ticket.lanePositionLaneId?: string`, the lane the position was given in
	- A position counts only when `lanePositionLaneId === laneId`. Anything else (null, or set in another lane) is "unplaced".
	- No backfill. Every existing ticket starts unplaced, and unplaced sorts by `number` (D2), so the first load after upgrade shows today's order unchanged.
- D2 — Lane order rule, one comparator `compareLaneOrder(a, b)` in `projectTypes.ts`:
	- Placed tickets come first, ascending `lanePosition`
	- Unplaced tickets come after them, ascending `number`
	- That makes "goes to the bottom" automatic for every non-drag writer: new tickets, GitHub import, modal lane picker, Next Lane / move rules, and agents writing `lane_id`. None of them sets a position for the new lane.
	- `groupTicketsByLane` sorts each lane bucket with it. The SQL `ORDER BY number` stays as a stable input order.
- D3 — Trigger so that a ticket moving back to a lane where it had a position doesn't jump back to its old slot (A→B→A). Add it to the triggers SQL next to the closed_at triggers:
	```sql
	CREATE TRIGGER IF NOT EXISTS tickets_lane_position_on_move
	AFTER UPDATE OF lane_id ON tickets
	WHEN NEW.lane_id IS NOT OLD.lane_id AND NEW.lane_position_lane_id IS NOT NEW.lane_id
	BEGIN
	  UPDATE tickets SET lane_position = NULL, lane_position_lane_id = NULL WHERE id = NEW.id;
	END;
	```
	- A drag writes `lane_position_lane_id = NEW.lane_id`, so the trigger skips it. Any other lane move clears the position. There is no collision case, because the check is on the lane id, not on the position value.
	- In the renderer, the same rule applies to the in-memory board. Every non-drag lane change in the store goes through one helper, `withLane(ticket, laneId)`, which sets `laneId` and clears both position fields. Grep every `laneId` write in `stores/projects.ts` (at least `updateTicket` patches that carry `laneId`, `moveTickets`, the move-rule placement near line 1189, and the handoff path) and route it through the helper.
- D4 — Writing a drop: renumber the whole target lane, dense `1..n`
	- Pure helper `placeTicketsInLane(tickets, carriedIds, targetLaneId, anchor)` → returns a new `tickets` array
	- Steps:
		1. Get the target lane's full order (D2) and remove the carried tickets from it
		2. Insert the carried block at the anchor (D5)
		3. Give every ticket in the lane `lanePosition = index + 1` and `lanePositionLaneId = targetLaneId`
	- Carried block order = the board order the user sees: visible lane order first, then lane order (D2) inside each lane. Same input as `carriedTickets(…, visibleTickets)`, which is already in that order.
	- `ponytail:` renumbering the lane writes up to N rows per drop (the first drop in a legacy lane writes all of them). Lanes hold tens of tickets, so that's fine. If it ever matters, switch to fractional midpoints.
- D5 — Anchor = `{ beforeTicketId: string | null, afterTicketId: string | null }`, taken from the visible cards only:
	- Pointer → the first visible, non-carried card whose vertical midpoint is below the pointer → `beforeTicketId`. Mirror `laneAnchorAt` with Y and `[data-ticket-id]` cards.
	- Past the last midpoint → `afterTicketId` = the last visible, non-carried card
	- Placement: right before `beforeTicketId` in the full order; otherwise right after `afterTicketId`; otherwise (visibly empty lane) at the bottom
	- Hidden tickets (search, "only mine") keep their relative order, and the block lands next to the neighbour the user saw
- D6 — Store: `store.dropTickets(projectPath, carriedIds, laneId, anchor)` replaces the `moveTickets` call in `dropOnLane`
	- One `updateBoard`. The callback runs `placeTicketsInLane` on the board the save queue hands over (not the view's copy), the same rule `moveTickets` follows today.
	- `updatedAt` is stamped only on tickets whose `laneId` changed. A pure reorder writes positions without stamping it.
	- `dropOnLane` now uses `carriedTicketIds` (it keeps same-lane tickets) instead of `ticketIdsToMove`. `ticketIdsToMove` stays only if another caller still needs it. Otherwise delete it with its tests.
	- A drop that changes nothing (lands where it started) is skipped: no save.
- D7 — Drop indicator: a horizontal line between cards, shown on `dragover` of the lane body, at the D5 anchor. Hidden on `dragleave` of the lane, on `drop`, and on `dragend`. Styled like `.lane-drop-indicator`, but horizontal.
- D8 — Keyboard: make the ticket `article` focusable (`tabindex="0"`) and add `aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"`
	- Alt+ArrowUp/Down moves the focused card one slot among the visible cards of its lane (anchor = the visible neighbour above or below). It's a no-op at either edge.
	- Same guards as `moveLaneByKeyboard`: only when the event comes from the card itself (not the checkbox), `preventDefault`, and refocus after `nextTick` by `data-ticket-id`
	- Enter/Space on a focused card opens it (as a click does), so adding the tabindex doesn't leave a focusable element that does nothing
	- Moves only the focused card, even when other cards are checked

## Requirements
- R1: Schema: both columns in the `tickets` CREATE and in `ADDED_COLUMNS`. Add the D3 trigger to the triggers SQL.
- R2: Repository: add both fields to `ticketFromRow`, `ticketValues`, `insertTicketRow` and `updateTicketRow`. Check any ticket normalizer/sanitizer on the IPC or board-load path so the fields survive the round trip.
- R3: `Ticket` type: both optional fields, with a comment that a position counts only in its own lane
- R4: `compareLaneOrder` + `groupTicketsByLane` sorting (D2)
- R5: `placeTicketsInLane` (D4/D5) and `withLane` (D3) in `projectTypes.ts`
- R6: `store.dropTickets` (D6). Route every non-drag lane write in the store through `withLane`.
- R7: `BoardLanes.vue`: drop anchor from the pointer, drop indicator, `dropOnLane` calls `dropTickets`. Keep the multi-drag ghost.
- R8: `TicketCard.vue`: tabindex, keyboard emits (`move-up` / `move-down`, or one `move` event with a direction), Enter/Space open. `BoardLanes.vue` handles them.
- R9: Tests
	- `projectTypes.test.ts`:
		- `compareLaneOrder`: placed before unplaced; unplaced by number; a position from another lane counts as unplaced
		- `placeTicketsInLane`: insert at an index within the same lane; a move from another lane lands at the anchor; a block keeps its relative order; a block taken from two lanes; filtered neighbours (anchor before / after a visible card with hidden tickets in between); an empty lane goes to the bottom; positions dense `1..n`
		- `withLane` clears both fields
	- Store test: `dropTickets` stamps `updatedAt` only on lane changes; a pure reorder leaves `updatedAt` alone; a no-op drop doesn't save
	- Repository test: the trigger clears the position on a raw `UPDATE tickets SET lane_id` and keeps it when `lane_position_lane_id` matches the new lane. Old DB without the columns → migrated, and the order is unchanged.

## Acceptance
- [ ] Drag within a lane → the card stays where it was dropped, after reload and after an app restart
- [ ] Drag into another lane → it lands at the drop spot
- [ ] A line between cards shows where the card will land while dragging
- [ ] Multi-select drag → the carried tickets land together in their current relative order
- [ ] Filtered lane → the drop is placed relative to the visible neighbours, and hidden tickets keep their order
- [ ] Focused card + Alt+ArrowUp/Down → it moves one slot
- [ ] Modal lane picker, Next Lane / move rules, an agent's sqlite3 `lane_id` write, GitHub import, new ticket → bottom of the lane
- [ ] Upgraded board shows the same order as before
- [ ] A reorder doesn't change `updatedAt`. A lane change does.
- [ ] Before merge: run the app on an isolated DB copy and exercise drag, keyboard, filter and an agent CLI move

## Known ceilings
- Several unplaced tickets at the bottom sort by number, not by when they arrived. Two agent moves in a row can show the older-numbered one above the newer arrival. Add an arrival timestamp if anyone notices.

## Out of scope
- Auto Run / orchestrator processing tickets in lane order
- Sort-by options per lane
- Reordering across projects or boards
- Touch / pointer-event drag rewrite (stays on HTML5 drag)

## Branch / worktree
- Branch: `t178-allow-tickets-to`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t178`

## Open questions
- None
