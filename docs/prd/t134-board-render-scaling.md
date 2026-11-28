# PRD — #134 Ticket retrieval + creation speed (board render scaling)

Branch `t134-ticket-retrieval-and` · worktree `.worktrees/t134`

## Problem
#118 scale run (`docs/reports/t118-scaling-report.pdf`, `t118-scaling-raw.csv`, harness `scripts/scale-test.mjs`) stopped at 18,300 tickets on one board:
- Ticket Creation Time 5.29 s (median of 3), Ticket Access Time 1.60 s, fill + reload (fresh board draw) 5.8 s
- Creation ≈ 3× access at every size; both grow with board size
- DB is not the bottleneck. Cost = renderer re-render, all in `BoardView.vue`

## Current state (verified at `39c3f2c`)
- `src/views/BoardView.vue` = 2,876 lines; cards are inline `<article class="ticket">` (l.1786-~1840). `src/components/` has no card component
- `openTicketId` (l.141) is template-read → card click re-renders the whole view and re-diffs all N cards
- `ticketsInLane()` (l.529) is a plain fn: filters all of `board.tickets` (lane + `matchesQuery` + `matchesAssignee`) per call. Called from:
	- `visibleTicketCount` (l.545), `visibleTickets` (l.1115), `unseenAgentResultCount` (l.1565)
	- template: graph `:tickets` (l.1708, inline `flatMap`), lane count badge (l.1755), card `v-for` (l.1787), l.1459
	- → several full-array passes per lane per render
- Store (`src/stores/projects.ts`):
	- `boardUpdate` (l.224) rebuilds `state.boards[path]` per edit
	- `updateTicket` (l.443) maps the whole tickets array to patch one ticket
	- `addTicket` (l.424) → `updateBoard` → optimistic board, then `dispatchBoardWrites` (l.727) → `withWrittenEntity` (l.265) + `replaceById` (l.258) copy the full array again to swap in the saved row (repo-assigned number) → ~3 full re-renders per create vs 1 per access → the 3×
- No virtualization: every card is in the DOM → 5.8 s fresh draw
- PageFind (`src/components/PageFind.vue`) = Electron native `webContents.findInPage` (`electron/main.ts:183`) → only finds text that is in the DOM. Matters for fix 4
- Board keyboard handling (`handleBoardKeydown`, l.722) = filter shortcut + Escape chain; no card-to-card arrow nav. Lane reorder via keyboard on lane header (l.1752). Card keyboard reach = Tab order only
- `package.json` has no `lint` script → "lint" in AC = `bun run typecheck` + `bun run test`

## Plan — 4 fixes, cheapest first, one commit each
Re-run a quick `scale-test` (or a smaller size) after each so each commit's effect is measurable on its own; full run after fix 4.

### 1. Group tickets by lane once
- One `computed` `ticketsByLane: Map<laneId, Ticket[]>`: single pass over `board.tickets`, lane + query + assignee filters applied once
- Every `ticketsInLane()` call site reads `ticketsByLane.get(lane.id) ?? []`; plain fn deleted
- `visibleTicketCount`, `visibleTickets`, `unseenAgentResultCount`, lane count badge, graph `:tickets` derive from it (graph prop → `visibleTickets`, not inline `flatMap`)
- Pure grouping fn lives where it can be unit-tested (e.g. `src/shared/` beside existing board helpers) → one small vitest check: lanes, filter, empty lane, order preserved

### 2. Extract `src/components/TicketCard.vue`
- Move card markup (l.1786-~1840) + card-local helpers into it
- Props = per-ticket stable primitives/objects: `ticket`, `selected`, `carried`, visible card fields, unseen flag, users/labels it needs. No whole-board or `openTicketId` prop
- Emits: `open`, `toggle-select`, `dragstart`, `dragend`, context menu / any other card action present today
- Parent stays owner of state (`openTicketId`, `selectedTicketIds`, `draggedTicketId`)
- Verify: dev-only render counter (or Vue devtools) → open/close ticket modal re-renders 0 unchanged cards. Counter not shipped
- No visual/behavior change: drag/drop, multi-select checkbox, carried-behind style, glow/unseen dot, all card fields, context menu

### 3. Update a single ticket in place
- `updateTicket`, `moveTickets`, create, and `withWrittenEntity` for tickets: mutate the one ticket reactively (`Object.assign` on the reactive row / `push` one row) instead of new board + new array
- Lanes + other tickets keep identity → with fix 2, only the touched card re-renders
- Keep current undo/reload semantics: `reloadAfterFailedWrite(undo)` must still restore pre-edit state → undo captures the patched ticket's prior fields (or the inserted id to remove), not a whole-board snapshot
- Created ticket still takes the repository's number from the saved row (in-place patch of the optimistic row)
- Keep `boardUpdate` for lane edits / bulk ops that genuinely touch many entities — scope is ticket create/update/move
- Target: create = one effective re-render

### 4. Virtualize long lanes
- Per lane, only cards in/near the lane viewport are mounted: top + bottom spacers, overscan ~1 screen each way
- Only kicks in above a threshold (e.g. > 50 cards in the lane); short lanes render as today
- Card height varies (labels, fields) → estimated height + measured cache (`ResizeObserver` on mounted cards) for spacer math
- No new dependency (a scroll listener + a slice is a few dozen lines). If one gets added, call it out in the PR
- Must still work:
	- scroll (no jump/blank flashes at normal speed)
	- drag/drop into a virtualized lane (drop target = lane, `dropOnLane(lane.id)` → unaffected; dragged card unmounting mid-drag must not cancel the drag → keep the dragged card mounted)
	- multi-select (`selectedTicketIds` is id-based → off-screen selections survive)
	- Tab reach through rendered cards; scrolling extends the window
	- PageFind: native find can't see unmounted cards → while PageFind has a non-empty query, lanes render all cards (fallback). `ponytail:` comment names the ceiling: Cmd+F on a huge board pays the old draw cost
	- open ticket via modal/links for an off-screen card (modal reads `openTicket` from board data, not DOM)

## Measurement + report
- After fix 4: `bun run scale-test` full run
- New report beside the old: `docs/reports/t134-scaling-report.pdf` + `t134-scaling-raw.csv`
- Report charts before (#118 CSV) vs after on the same axes: creation, access, fresh draw vs board size
- Targets:
	- access time ~flat vs board size
	- creation ≤ ~1.5× access
	- fresh-board draw well under 5.8 s at 18,300

## Acceptance criteria
- 4 commits, in order above, each independently measurable
- `ticketsInLane` fn gone; all listed call sites read the lane map
- `TicketCard.vue` exists; opening/closing the ticket modal re-renders no unchanged cards (verified)
- Ticket create/update/move don't copy the tickets array or rebuild the board; created ticket shows its repo number
- Long lanes mount only near-viewport cards; scroll, drag/drop, multi-select, Tab, PageFind, context menu still work
- t134 report + CSV committed, before/after on one chart, targets met (or misses explained in the report)
- `bun run test` + `bun run typecheck` pass; new lane-grouping unit test
- App exercised on an isolated DB copy before merge (drag, select, modal, Cmd+F on a large board)

## Decisions (defaults taken)
- PageFind vs virtualization → render-all fallback while a find query is active (native find has no hook into unmounted content)
- Virtualization threshold + measured-height cache instead of fixed-height rows (cards vary in height)
- Lint = typecheck + test (no lint script in repo)
- Fix 3 limited to ticket writes; lane writes keep `boardUpdate`

## Out of scope
- BoardView.vue decomposition beyond the card → #135
- Main-process `spliceBaselineTicket` array copy
- DB schema / index changes
- Remote-storage / retrieval-heavy workload → #128
