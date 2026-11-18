# PRD — Ticket #91: Dragging multiple tickets should have a stack animation

## Context
Checking several cards and dragging one moves every checked visible ticket, but the drag looks like a single-card drag. Goal: while the drag is live, show that N tickets are going with it.

## Code today (verified 2026-11-17 on `e33a8e6`)
- `ticketIdsToMove` (`src/shared/projectTypes.ts:1764`): carry rule = dragged is selected → every selected visible ticket; else just the dragged one. Then drops tickets already in `targetLaneId`. Tests: `describe('ticketIdsToMove')` in `src/shared/projectTypes.test.ts:903`
- `draggedTicketId` ref (`src/views/BoardView.vue:106`), `selectedTicketIds` ref Set (`:374`)
- `dropOnLane` (`BoardView.vue:829`): builds `visibleTickets = visibleLanes.flatMap(ticketsInLane)`, clears `draggedTicketId`, calls `ticketIdsToMove`
- Card (`BoardView.vue:1392-1399`): `<article class="ticket" draggable="true" @dragstart="draggedTicketId = ticket.id" @dragend="draggedTicketId = null">`. No `setDragImage` anywhere in `src/`
- `.ticket` CSS (`src/styles.css:1247`): `transition: border-color 120ms ease`, tokens `--color-surface`, `--color-border`, `--color-accent`, `--color-text-on-accent`. Reduced-motion blocks follow `@media (prefers-reduced-motion: reduce) { … }` (e.g. `:1339`)
- Image drop on the ticket modal reads `event.dataTransfer` files (`BoardView.vue:789`); lane reorder uses pointer events (`laneDrag`), not HTML5 DnD → neither touches the card dragstart path

## Acceptance criteria
- A1. Dragging a checked card while 2+ checked tickets are visible → custom ghost: dragged card in front, 1–2 offset card edges behind (3 layers max, even for 10 tickets), count badge with the carried count
- A2. Other carried cards get `.ticket-carried` at dragstart: ~180ms fade + slight shrink, stay dimmed for the whole drag
- A3. `dragend` (drop or cancel) → all cards back to normal; cancel moves nothing (already true today)
- A4. Unchecked card drag, or the only checked card → today's behavior exactly (browser default ghost, no class)
- A5. Count = visible checked tickets (filters/hidden lanes excluded). Tickets already in the eventual target lane are still counted
- A6. `prefers-reduced-motion: reduce` → no transition; ghost + dim still show
- A7. Light + dark themes, existing tokens only
- A8. Lane drag-reorder + ticket-modal image drop unaffected

## Decisions
- D1. Split the carry rule out of `ticketIdsToMove` so both callers share it:
	```ts
	export const carriedTicketIds = (draggedTicketId: string, selectedTicketIds: ReadonlySet<string>, visibleTickets: Ticket[]): string[]
	```
	- Same rule as today's `isCarried`; `ticketIdsToMove` becomes `carried` filtered by `laneId !== targetLaneId`. Zero behavior change for the move
	- Existing `ticketIdsToMove` tests stay green unchanged → proves the refactor
- D2. `BoardView.vue`: `visibleTickets` computed (lift the `flatMap` out of `dropOnLane`, reuse there) + `carriedIds = computed(() => draggedTicketId.value ? new Set(carriedTicketIds(...)) : new Set())`
	- Card gets `:class="{ 'ticket-carried': carriedIds.has(ticket.id) && ticket.id !== draggedTicketId }"`
	- Stack applies only when `carriedIds.size >= 2` (A4: single checked card → size 1 → nothing)
- D3. `startTicketDrag(event, ticket)` replaces the inline `@dragstart`:
	- set `draggedTicketId`; if carried count < 2 → return (browser default ghost)
	- ghost = `div.ticket-drag-stack` with `cloneNode(true)` of `event.currentTarget` in front, `min(count, 3) - 1` empty `.ticket-drag-layer` divs behind (offset 4px/8px down-right), plus `span.ticket-drag-count`
	- Fix ghost width to the source card's `offsetWidth` (clone loses lane width)
	- Append to `document.body` at `position: fixed; top: -1000px; left: -1000px` (in DOM + painted, not `display:none` — Chromium snapshots at call time)
	- `event.dataTransfer.setDragImage(ghost, offsetX, offsetY)` with offsets = pointer position inside the card (`event.offsetX/Y` relative to card via `getBoundingClientRect`) so the ghost doesn't jump
	- `requestAnimationFrame(() => ghost.remove())`
- D4. Collapse animation = in-place fade + shrink (`opacity: 0.4; transform: scale(0.96)`, 180ms ease), not a translate toward the dragged card. Carried cards can sit in other lanes / scrolled out of view; per-card translate math buys little. Worth a glance in review
- D5. `.ticket` transition becomes `border-color 120ms ease, opacity 180ms ease, transform 180ms ease`. Reduced motion: `.ticket { transition: border-color 120ms ease; }` inside the media block (keep the hover border fade, drop the collapse)
- D6. Badge: `background: var(--color-accent); color: var(--color-text-on-accent)`, pill, top-right of the front card. Layers: `--color-surface` + `--color-border`. Both themes come from tokens
- D7. Clear on `dragend` only via `draggedTicketId = null` (computed empties → class drops). `dropOnLane` already nulls it first; no extra state

## Checklist
- [ ] `carriedTicketIds` in `projectTypes.ts`; `ticketIdsToMove` uses it
- [ ] Unit tests next to `describe('ticketIdsToMove')`: unchecked drag → `[dragged]`; checked drag → all selected visible; selected-but-hidden excluded; same-lane tickets kept (unlike `ticketIdsToMove`)
- [ ] `visibleTickets` + `carriedIds` computeds; `dropOnLane` reuses `visibleTickets`
- [ ] `startTicketDrag` builds ghost (≤3 layers + badge), `setDragImage`, removes next frame
- [ ] `.ticket-carried`, `.ticket-drag-stack`, `.ticket-drag-layer`, `.ticket-drag-count` CSS + reduced-motion rule
- [ ] Single / unchecked drag unchanged
- [ ] Running app on isolated DB (run-app-before-merge flow): 5 checked → badge `5`, 3 layers; filter hiding 2 → badge `3`; Esc cancel → nothing moved, styling cleared; light + dark; lane reorder + modal image drop still work
- [ ] `bun run` typecheck + tests green

## Out of scope
- Which tickets a multi-drag moves
- Drop animation (cards flying into the target lane)
- Touch / pointer-event drag

## Risks
- Ghost appearance can't be unit-tested (static browser snapshot) → manual check in Electron is the gate
- `cloneNode` copies the checkbox + any `id` attrs; cards have no ids today, so no duplicate-id issue. Recheck if one is added

## Open questions
None. D4 (fade-in-place vs translate-toward) is the call most worth a second look in review.

## Branch / worktree
- Branch: `t91-dragging-multiple-tickets`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t91`
- PRD file: `docs/prd/t91-multi-drag-stack.md`
