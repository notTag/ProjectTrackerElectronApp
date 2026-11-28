# PRD — Ticket #177: Resizable graph view side panel

## Problem
- Graph view's right side panel has a fixed width. Long lane names, prompt rules and ticket fields wrap or scroll. Users want to drag it wider (or narrower).

## Code today (verified 2026-11-27 on `5d99574`)
- Two things occupy the graph view's right side, never both at once:
	- `.graph-details` aside — `src/components/TicketGraph.vue:355`, `v-if="!ticketOpen"`. Project lane list / selected lane details. CSS `src/styles.css:2218`: `width: 340px; flex-shrink: 0; border-left …`
	- Docked ticket panel — `TicketModal.vue:364` backdrop gets `graph-ticket-panel` when `boardView === 'graph'`. CSS `src/styles.css:2225`: fixed, `top: 150px; right: 0; bottom: 0; width: min(440px, 45vw)`. Inner `.ticket-modal` `width: 100%` (`:2226`)
	- `.graph-ticket-space` — `TicketGraph.vue:354`, `src/styles.css:2229`: spacer `width: min(440px, 45vw)` so the canvas doesn't sit under the fixed ticket panel. Must match the panel width
- Existing resize patterns:
	- `vEdgeResize` in `src/modalWidth.ts:45` — modal edge drag. Assumes a centred modal (2x delta) and needs `.resizable`. The graph-panel ticket modal is deliberately not `.resizable` (`TicketModal.vue:368`). Don't reuse it here: the panel is right-docked, so the math is 1x and the left edge only
	- `.lane-resize-handle` (`BoardLanes.vue:451`, `src/styles.css:1593`) — explicit 12px `role="separator"` handle, pointer events, accent stripe while active. Copy this look
	- `src/modalWidth.ts` — module-scope refs for session-only widths (survive Board ↔ Dashboard remounts)

## Decisions
- Scope: both panels (details aside + docked ticket panel) share one width. Opening/closing a ticket in the graph doesn't make the side panel jump
- State: `export const graphPanelWidth = ref<number | null>(null)` in `src/modalWidth.ts`. `null` = today's CSS defaults (340px aside, `min(440px, 45vw)` ticket panel). Session-only, same as the other modal widths
- Handle: one left-edge `<div class="graph-panel-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize side panel" tabindex="0">`, rendered inside both `.graph-details` and the `graph-ticket-panel` backdrop (only when `boardView === 'graph'`). Tiny shared component or composable, whichever is the smaller diff
	- Pointer: `setPointerCapture`, `nextWidth = startWidth - (clientX - startX)` (1x, panel is right-docked), `stopPropagation` so the backdrop click-to-close guard never sees a resize press
	- Keyboard: ArrowLeft / ArrowRight = ±16px
	- Look: copy `.lane-resize-handle` (12px hit area, `cursor: col-resize`, accent stripe on `:active`), positioned on the left edge
- Apply: bind `:style="{ width: … }"` from `graphPanelWidth` on `.graph-details`, `.graph-ticket-space` and the `graph-ticket-panel` backdrop. Nothing bound when `null`
- Clamp in one helper used by drag + keys: min 280px, max `innerWidth - 320px` (canvas keeps some room). Re-clamp on window `resize` so shrinking the window can't push the panel past the canvas
- `.graph-details` `max-height: calc(100vh - 210px)` and the ticket panel's scroll stay as-is (height not resizable)

## Acceptance criteria
- [ ] Graph view, no ticket open: dragging the details panel's left edge resizes it; canvas area shrinks/grows to match
- [ ] Graph view, ticket open: dragging the docked ticket panel's left edge resizes it; `.graph-ticket-space` tracks the same width (canvas never hidden under the panel)
- [ ] Width carries between the two: resize details → open ticket → ticket panel uses that width, and back
- [ ] Clamped to 280px min and `innerWidth - 320px` max, also after a window resize
- [ ] Releasing a drag over the canvas or backdrop doesn't close the ticket panel or select/deselect a lane
- [ ] Handle is keyboard-focusable; ArrowLeft/Right resize
- [ ] Board ↔ Dashboard switch keeps the width; app restart → default widths
- [ ] Board-view ticket modal (centred, `vEdgeResize`, Expand toggle) unchanged
- [ ] Light + dark themes: handle stripe visible, no layout shift at default width

## Verification
- `bun run typecheck` + `bun run test`
- Real app on an isolated userData copy + throwaway project (CDP recipe):
	- Graph view → drag `.graph-panel-resize-handle` left 200px → `.graph-details` width ≈ 540
	- Open a ticket → `.modal-backdrop.graph-ticket-panel` and `.graph-ticket-space` width ≈ 540
	- Drag past limits → clamped; shrink window → re-clamped
	- Release drag over backdrop → panel still open

## Out of scope
- Persisting the width across restarts (move `graphPanelWidth` to settings if wanted later)
- Resizing height, or resizing from other edges
- Double-click-to-reset
- Board-view modals

## Files
- `src/modalWidth.ts` — `graphPanelWidth` + clamp helper
- `src/components/TicketGraph.vue` — handle in `.graph-details`, width bindings on aside + spacer
- `src/components/board/TicketModal.vue` — handle + width binding on the graph-panel backdrop
- `src/styles.css` — `.graph-panel-resize-handle`; panels need `position: relative` (aside) for the handle
- Possibly `src/components/GraphPanelResizeHandle.vue` — shared handle, if it's smaller than duplicating

## Work location
- Branch: `t177-the-graph-view`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t177`
