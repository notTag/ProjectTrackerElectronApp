# PRD — Ticket #98: Expand mode for the swim lane ⚙ settings modal

## Context
The lane ⚙ modal holds long monospace content (Agent prompt, Orchestrator prompt, paths, auto-run settings). It is stuck at the default `.modal` width (560px). The ticket modals already have an Expand/Collapse button (t83) that widens them to `min(85vw, 100%)`. The lane modal should get the same button.

## Code today (verified 2026-11-17 on `8cf8fa8`)
- `src/ticketModalWidth.ts` — `export const ticketModalExpanded = ref(false)`. Module scope, so it survives BoardView remounts (Board ↔ Dashboard) and resets on app restart.
- `src/views/BoardView.vue`
	- `:1653` new-ticket modal: `<section class="modal ticket-modal" :class="{ expanded: ticketModalExpanded }">`, then `<div class="ticket-modal-header">` with the eyebrow and the `.icon-button` (title / aria-label / aria-pressed + two inline SVGs, `v-if` / `v-else`) at `:1654-1670`
	- `:1749-1753` open-ticket modal: same button, class gated by `boardView !== 'graph'`
	- `:2149-2151` lane settings modal: `<div v-if="openLane" class="modal-backdrop">` → `<section class="modal lane-modal">` → bare `<p class="eyebrow">Swim lane</p>`. No expand state
	- `:1620` and `:1735` are other `lane-modal` sections (new-lane name modal, auto-run confirm). Out of scope, leave them alone
- `src/styles.css`
	- `:1454` `.ticket-modal, .lane-modal` flex column, gap 12px
	- `:1466` `.ticket-modal.expanded { width: min(85vw, 100%); }`
	- `:1470-1486` `.ticket-modal-header` flex row, eyebrow `margin: 0`, `.icon-button { padding: 0 }`. These are header-scoped, not modal-scoped, so they apply inside the lane modal as-is
- `defineModel` is already used in `src/components/ProjectToolbar.vue` (Vue 3.5)

## Decisions
- State: add `export const laneModalExpanded = ref(false)` to `src/ticketModalWidth.ts`. Separate ref, so expanding one modal type never resizes the other. Session-only, same as the ticket modal
- Button: extract `src/components/ExpandToggle.vue` (`const expanded = defineModel<boolean>({ required: true })`, renders the existing button + both SVGs unchanged). Use it in all three headers (`v-model="ticketModalExpanded"` ×2, `v-model="laneModalExpanded"` ×1). The third copy would be ~15 duplicated lines; the component is about the same size and removes two copies. If the extraction causes any trouble, copying the markup is an acceptable fallback
- Lane modal markup at `:2150`:
	- `<section class="modal lane-modal" :class="{ expanded: laneModalExpanded }">`
	- `<div class="ticket-modal-header"><p class="eyebrow">Swim lane</p><ExpandToggle v-model="laneModalExpanded" /></div>`
- CSS: change the selector to `.ticket-modal.expanded, .lane-modal.expanded { width: min(85vw, 100%); }`. Nothing else. The `.ticket-modal-header` rules already cover the lane modal's header
- No graph-view gate: the lane modal never renders inside `.graph-ticket-panel`

## Acceptance criteria
- [ ] The lane ⚙ modal header shows the Expand icon button top-right, same look as the ticket modal
- [ ] Clicking it widens the section to `min(85vw, 100%)` and switches the icon + tooltip to Collapse. Clicking again restores the default width
- [ ] `aria-pressed`, `title` and `aria-label` follow the state
- [ ] Close and reopen (same lane or another lane) → last state kept for the app session. Board ↔ Dashboard keeps it too
- [ ] App restart → collapsed
- [ ] Lane expand doesn't change the ticket modal width, and the reverse
- [ ] Ticket modals behave exactly as before after the `ExpandToggle` swap (both new and open, including the graph-panel gate)
- [ ] Long content still scrolls inside the modal (`max-height: 100%` + `overflow-y: auto` kept). Textareas widen with the modal
- [ ] Light + dark themes look right; button padding matches the ticket modal

## Verification
- `bun run typecheck` + `bun run test`
- Real app on an isolated userData copy + throwaway project (CDP recipe):
	- Open lane ⚙ → click Expand → `section.lane-modal` `getBoundingClientRect().width` ≈ 0.85 × `innerWidth`
	- Close, reopen another lane → still expanded
	- Open a ticket → its width is unchanged (default 760px if the ticket toggle wasn't touched)
	- Toggle the ticket modal → lane modal width unchanged on next open

## Out of scope
- New-swim-lane name modal, auto-run confirm modal, board settings modal
- Persisting the state across restarts
- Graph-view side panel

## Files
- `src/ticketModalWidth.ts` — `laneModalExpanded`
- `src/components/ExpandToggle.vue` — new, button + SVGs
- `src/views/BoardView.vue` — three headers use `ExpandToggle`; lane section gets the `expanded` class
- `src/styles.css` — `.lane-modal.expanded` joins the width rule

## Work location
- Branch: `t98-create-a-full`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t98`
