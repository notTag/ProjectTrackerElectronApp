# PRD — Ticket #67: Next Lane field (New Ticket, Ticket, Swimlane settings)

## Summary
Rename the Ticket modal's "Move to" field to "Next Lane", move it under the ticket's Full auto checkbox, and add a lane-level Next Lane in Swimlane settings. A ticket with no Next Lane of its own falls back to its lane's. The New Ticket modal gets the field too, pre-filled from the chosen Status lane. One helper resolves the value, and both the UI and the auto-move on completion use it.

## Why a PRD
The change touches persistence (new column), shared move logic (`completionMoves`, lane delete) and three modals. It also adds an inheritance rule that the UI and the behavior must agree on. That is enough to need a short PRD.

## Current state (verified in code)
- `Ticket.moveToLaneId` + `moveOnComplete` — `src/shared/projectTypes.ts:315-316`. `moveOnComplete` is the "armed" flag.
- `completionMoves` — `src/shared/projectTypes.ts:~860-885`. It reads `ticket.moveToLaneId` directly at L875 and disarms after it moves a ticket. The target is kept so the checkbox can be ticked again.
- Lane delete cleanup for tickets: `withoutLane` / `removeLaneFromBoard`, `src/shared/projectTypes.ts:~1028-1040`.
- `SwimLane`, `src/shared/projectTypes.ts:213`: no next-lane field yet. Lane settings save through `store.updateLane` → `updateLaneInBoard` → `upsertSwimLane` (`electron/storage/stateRepository.ts:400`). Rows are read back at `stateRepository.ts:~541`.
- Schema: `swim_lanes` CREATE in `electron/storage/schema.ts:~51-70`. The add-column migration list is at `schema.ts:~150-158`, and `agent_sets_version` is the most recent example.
- BoardView (`src/views/BoardView.vue`):
	- `startTicketDraft` L560 builds `{ title, description, laneId }`. `saveTicketDraft` L563 calls `store.addTicket(path, laneId, title, description)` (`src/stores/projects.ts:247`), which calls `addTicketToBoard` (`projectTypes.ts:~1013`).
	- New Ticket modal L1136: Title, Status, Description.
	- Ticket modal "Move to" select L1201. `setMoveToLane` L722 arms when a lane is picked and clears both fields on None.
	- Ticket Full auto checkbox L1374. Footer "Move to <lane> swimlane" checkbox L1421 (`v-if="openTicket.moveToLaneId"`).
	- Lane settings Full auto checkbox L1587.

## Decisions (defaults, non-blocking)
- D1 — Resolution. `effectiveNextLaneId(ticket, lane) = ticket.moveToLaneId ?? lane?.nextLaneId`. Lives in `projectTypes.ts`. Used by the Ticket modal select, the footer checkbox and `completionMoves`. `lane` is the ticket's current lane, or the unassigned lane.
- D2 — Arming stays per ticket. Inheritance gives the target. It does not arm the ticket. Existing tickets keep `moveOnComplete` as stored, so nothing on an older board starts moving by surprise. This matches "no bulk-apply" in Out of scope. New tickets start armed when they have a resolved Next Lane (D5).
- D3 — Ticket modal select options:
	- First option, value `''`: "Lane default: <name>" when the lane has a Next Lane, otherwise "None". It means "inherit".
	- Then No status, then every lane.
	- Picking a lane sets `moveToLaneId` and arms the ticket (as today).
	- Picking `''` clears `moveToLaneId` and sets `moveOnComplete = Boolean(lane.nextLaneId)`.
	- With inheritance there is no explicit "none" on a ticket whose lane has a default. Unticking the footer checkbox covers that case.
- D4 — Swimlane settings select: None (`undefined`), No status, every lane except the lane being edited (a lane pointing at itself is a no-op). Stored as `SwimLane.nextLaneId?: string`.
- D5 — New Ticket modal:
	- The draft gains `nextLaneId` plus a "touched" flag.
	- The select is pre-filled from the Status lane's `nextLaneId` and re-filled when Status changes, until the user picks a value.
	- On save, `moveToLaneId` is stored only when the user picked a value that differs from the lane default, so the ticket keeps inheriting otherwise.
	- `moveOnComplete = Boolean(resolved next lane)`.
	- `addTicketToBoard` / `store.addTicket` take optional `moveToLaneId`, `moveOnComplete`.
- D6 — After a completion move, `completionMoves` clears the ticket's `moveToLaneId` along with disarming. The ticket then inherits the destination lane's Next Lane instead of pointing at the lane it is already in. This changes `src/stores/projects.test.ts:276` (it currently expects `moveToLaneId: 'dev'` to remain). Revert to keeping the target if review prefers the old behavior.
- D7 — Footer checkbox: `v-if` on `effectiveNextLaneId(...)`. Label "Move to Next Lane: <lane>". It still toggles `moveOnComplete`.
- D8 — Field hint stays: "Where this ticket goes when its checklist is done or ▶ Run succeeds." Append "Defaults to the lane's Next Lane." on the ticket field.

## Requirements
### Data / persistence
- R1: `SwimLane.nextLaneId?: string` with a comment (absent = None).
- R2: `swim_lanes.next_lane_id TEXT` (nullable) in the CREATE statement, plus a migration entry `{ table: 'swim_lanes', column: 'next_lane_id', definition: 'TEXT' }`.
- R3: `upsertSwimLane` writes `lane.nextLaneId ?? null`. The lane read path sets `nextLaneId: asText(row.next_lane_id)`.
- R4: Older DBs without the column load. Lanes come back with `nextLaneId` undefined.

### Shared logic
- R5: Add `effectiveNextLaneId` (D1).
- R6: `completionMoves` resolves its target through `effectiveNextLaneId`, using the ticket's lane in `nextBoard` (lanes + unassigned lane), and applies D6.
- R7: `removeLaneFromBoard` also clears `nextLaneId === deletedId` on every lane, including `board.unassignedLane`.
- R8: `addTicketToBoard` accepts optional `moveToLaneId` / `moveOnComplete` (D5).

### UI (`src/views/BoardView.vue`)
- R9: Lane settings: "Next Lane" select right under the Full auto checkbox (D4). Saved via `editLane(openLane, { nextLaneId: value || undefined })`.
- R10: Ticket modal: remove the "Move to" block near Status. Add a "Next Lane" select right under the ticket's Full auto checkbox and its hint (D3, D8). `setMoveToLane` implements D3.
- R11: Ticket footer checkbox per D7.
- R12: New Ticket modal: "Next Lane" select under Status (this modal has no Full auto checkbox), per D5.

### Docs
- R13: `feature-map.md` §3.6 New ticket modal, §3.8 Ticket modal, §3.9 Lane settings modal. Describe the field, the inheritance and the arming.

## Acceptance criteria
- AC1: The Ticket modal field is labeled "Next Lane" (not "Move to") and sits below the ticket's Full auto checkbox.
- AC2: Every Next Lane dropdown lists No status plus every swimlane. Lane settings leaves out the lane itself.
- AC3: The Swimlane settings Next Lane dropdown (None, No status, lanes) sits below Full auto, is saved per lane, and survives restart.
- AC4: The New Ticket Next Lane is pre-filled from the Status lane's Next Lane and follows Status changes until the user picks a value. A ticket saved with a resolved Next Lane starts armed.
- AC5: A ticket with no Next Lane of its own shows its lane's ("Lane default: X") and moves there on completion when armed. A ticket's own value overrides the lane's.
- AC6: `completionMoves` and the modal resolve through the same `effectiveNextLaneId`.
- AC7: Deleting a lane clears any lane's `nextLaneId` that points at it, and still clears ticket targets as today.
- AC8: Older boards/lanes without the field load unchanged, and no existing ticket changes its armed state.
- AC9: `bun run test` (or the project test script) passes, and typecheck/build is clean.

## Tests
- `electron/storage/stateRepository.test.ts`:
	- A lane's `nextLaneId` round-trips through save → reopen.
	- An older DB without `next_lane_id` loads with it undefined. Follow the `agent_sets_version` DROP COLUMN pattern at L193.
- `src/shared/projectTypes.test.ts`:
	- `effectiveNextLaneId` covers: ticket override wins, falls back to the lane, neither gives undefined, unassigned lane.
	- `completionMoves`: an armed ticket with no override moves to its lane's Next Lane, an unarmed one does not, and an override beats the lane. D6 clears the override after a move.
	- `removeLaneFromBoard` clears lane `nextLaneId` pointers, including the unassigned lane's.
	- `addTicketToBoard` with `moveToLaneId` / `moveOnComplete`.
- `src/stores/projects.test.ts:276`: update for D6.

## Out of scope
- The agent full-auto prompt reading Next Lane (agents still follow lane prompts).
- Bulk-applying a lane's Next Lane to existing tickets.
- Next Lane on board cards or graph view edges.
- Lane reordering or any other Swimlane settings changes.

## Risks
- D6 changes current behavior: the kept target used to let users re-tick the checkbox for the same lane. With inheritance, re-ticking now offers the destination lane's Next Lane, which fits a pipeline better. It is a one-line revert if review disagrees.
- Agents write the DB directly. A `next_lane_id` pointing at a missing lane resolves to undefined in `boardLaneById`, so nothing moves. Same as tickets today.

## Open questions
None blocking. D2 (inheritance does not arm existing tickets) and D6 (clear the override after a move) are the main calls, and both are easy to flip in review.

## Effort
About half a day. Mostly UI wiring plus one column and one helper.

## Branch / worktree
- Branch: `t67-add-a-field`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t67`
