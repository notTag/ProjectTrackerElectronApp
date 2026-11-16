# PRD — Ticket #74: Bulk drag of checked tickets across swimlanes

## Goal
Dragging a checked card moves every checked, visible ticket to the drop lane in one store edit. Dragging an unchecked card behaves as today (moves only that card).

## Context (verified in worktree)
- Selection: `selectedTicketIds` (in-memory `ref(Set)`) + `toggleTicketSelected` — `src/views/BoardView.vue:362-368`. Cleared on project change (`:363`). Today it only feeds `ticketsToRun` (`src/shared/projectTypes.ts:1634`).
- Drag: card `@dragstart="draggedTicketId = ticket.id"` / `@dragend` — `BoardView.vue:1133-1134`. Drop → `dropOnLane(laneId)` — `BoardView.vue:742-749` → `store.updateTicket(projectPath, id, { laneId })`.
- `store.updateTicket` — `src/stores/projects.ts:366-384`: one `updateBoard` with a `tickets.map` patch and a single `updatedAt`.
- `updateBoard` → `writeBoard` (`projects.ts:650`) runs in one `saveQueue` link: optimistic state, `withCompletionMoves`, `boardWrites` diff, then `dispatchBoardWrites` (`projects.ts`), which sends **one `ticket:update` IPC per changed ticket, sequentially**. There is no batch/transaction IPC.
- Visibility: `ticketsInLane(laneId)` filters by `matchesQuery` + `matchesAssignee` (`BoardView.vue:355`); `visibleLanes` drops hidden lanes and applies the lane filter (`BoardView.vue:156`).
- UI lane moves do not trigger full-auto handoffs (only external DB refreshes do — `docs/prd/t60-github-issue-sync.md`). Unchanged by this ticket.

## Behavior
1. Drag starts on card X.
2. On drop on lane L:
   - X unchecked → move only X (current path, unchanged).
   - X checked → move set = checked ∩ visible tickets (visible = `visibleLanes.flatMap(lane => ticketsInLane(lane.id))`), minus tickets already in L.
   - Move set empty → no-op (covers drop on the source lane when every checked ticket is already there).
3. All moved tickets get the same `updatedAt`, applied in one `updateBoard` call.
4. Moved tickets stay checked.
5. Checked tickets hidden by search, assignee filter, hidden lane or lane filter never move (same rule as Auto Run: never act on what the user can't see).

## Design
### `src/shared/projectTypes.ts` — pure helper beside `ticketsToRun`
```ts
export const ticketIdsToMove = (
  draggedTicketId: string,
  selectedTicketIds: ReadonlySet<string>,
  visibleTickets: Ticket[],
  targetLaneId: string
): string[]
```
- Dragged id not selected → `[draggedTicketId]` if it isn't already in `targetLaneId`, else `[]`.
- Dragged id selected → ids of `visibleTickets` that are selected and not in `targetLaneId`.
- Returns ids (the store only needs ids; avoids passing stale ticket objects).

### `src/stores/projects.ts` — `moveTickets(projectPath, ticketIds, laneId)`
- Same shape as `updateTicket`: one `updatedAt`, one `updateBoard`, `tickets.map(t => idSet.has(t.id) ? { ...t, laneId, updatedAt } : t)`.
- Empty `ticketIds` → return early, no write.
- `updateTicket`'s single-ticket drag path may stay as is; `dropOnLane` can call `moveTickets` for both cases (one id or many) — simpler, one code path. Implementer's choice; prefer one path.

### `src/views/BoardView.vue`
- `dropOnLane`: build `visibleTickets`, call `ticketIdsToMove`, then `store.moveTickets`.
- Checkbox: `title="Select (run / move)"`, `aria-label="Select #N (run / move)"`.
- Optional polish (skip unless trivial): count badge during multi-drag via `dataTransfer.setDragImage`. Not required for acceptance.

## Non-goal / known limit
- One `updateBoard` = one queue link + one optimistic update, but N sequential row writes over IPC, not one SQL transaction. A failure mid-batch triggers `reloadAfterFailedWrite`, which reloads DB truth (tickets written before the failure stay moved). Acceptable: same failure model every multi-row board edit already has. A batch IPC is out of scope.
- `closed_at` comes from the `tickets_closed_at_on_move` DB trigger per row, so each moved row gets it set/cleared — no app code needed. Verify only.

## Acceptance criteria
- [ ] 3 cards checked across 2 lanes; drag one to lane X → all 3 in X, one `updateBoard` call, shared `updatedAt`.
- [ ] Drag an unchecked card while others are checked → only that card moves.
- [ ] A checked ticket hidden by search / assignee filter / hidden lane does not move.
- [ ] A checked ticket already in the drop lane is unchanged, `updatedAt` included.
- [ ] Moved tickets stay checked.
- [ ] Bulk drop into a closing lane sets `closed_at` on every moved row (trigger); dropping out clears it.
- [ ] Checkbox `title` / `aria-label` mention run and move.
- [ ] Unit tests for `ticketIdsToMove` in `projectTypes.test.ts` next to `describe('ticketsToRun')`: unchecked drag, checked drag, hidden selected ticket skipped, already-in-target skipped, empty result.
- [ ] Store test in `src/stores/projects.test.ts`: `moveTickets` with 3 ids → one `updateBoard`/queue link, 3 `ticket:update` writes with identical `updatedAt` and `laneId`; empty ids → no write.
- [ ] Manual check on an isolated DB copy (run the app, check 3 cards, drag, confirm DB rows).

## Out of scope
- Shift-click range select, select-all per lane, keyboard multi-select.
- Bulk edit of other fields (assignee, labels).
- Within-lane reordering (no manual order exists).
- Batch/transactional IPC for board writes.

## Open questions
None.

## Branch / worktree
- Branch: `t74-selecting-multiple-tickets`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t74`
- PRD file: `docs/prd/t74-bulk-drag-checked-tickets.md`
