# PRD — Ticket #183: Remember a modal's dragged width

## Context
`vEdgeResize` (#117) lets the user drag the left/right edge of the New ticket, Open ticket (board view) and Lane settings modals. The width is an inline `style.width` on the `<section>`, so it dies with the component. Every reopen falls back to the default (760px ticket, 560px lane) and the user drags again.

## Code today (verified 2026-11-28 on `005909c`)
- `src/modalWidth.ts`
	- `ticketModalExpanded` / `laneModalExpanded` module-scope refs (session only)
	- `vEdgeResize: Directive<HTMLElement>` — `mounted(modal)` only. Listens on `modal.parentElement` (backdrop, capture phase). `edgeUnderPointer` returns `null` unless the modal has class `resizable`
	- Drag writes `modal.style.width = ${nextWidth}px`. `stopResizing()` runs on `lostpointercapture` or on a move with `buttons === 0`; it only removes listeners today
- `src/components/ExpandToggle.vue` — `toggle()` does `button.closest('.modal')?.style.removeProperty('width')` then flips the model. Knows nothing about which modal it lives in
- Call sites (all `v-edge-resize` with no value today)
	- `src/components/board/NewTicketModal.vue:101` — `class="modal ticket-modal resizable"`
	- `src/components/board/TicketModal.vue:373` — `resizable` only when `boardView !== 'graph'`
	- `src/components/board/LaneSettingsModal.vue:332` — `class="modal lane-modal resizable"`
- Mounting: `BoardView.vue:498/511/541` — each modal is `v-if` → `mounted` runs on every open. Switching ticket A → B while open does not remount (width kept, fine)
- `src/styles.css:1698-1705` — `.modal.resizable { min-width: min(560px, 100vw - 48px); max-width: calc(100vw - 48px); }`, `.ticket-modal.resizable { min-width: min(760px, 100vw - 48px); }`. CSS clamps any inline width
- localStorage precedent: `src/uiDemo.ts:110` `STORAGE_KEY = 'project-tracker-ui-demo'`, `readStored()` = `JSON.parse(... ?? '{}')` in try/catch, non-object → `{}`
- Tests: vitest, colocated `src/*.test.ts` (`src/uiDemo.test.ts`)
- `feature-map.md:376` (3.8 "Drag to resize") ends with "Not remembered after the modal closes."

## Decisions
- Kinds: `type ModalWidthKind = 'ticket' | 'lane'`. New + Open ticket share `ticket` (same pairing as `ticketModalExpanded`); lane settings = `lane`
- Storage: localStorage key `project-tracker-modal-widths`, JSON `{ ticket?: number, lane?: number }`. Per machine, not DB
- Helpers in `src/modalWidth.ts` (exported for the unit test):
	- `loadModalWidth(kind): number | undefined` — try/catch parse; returns value only if `typeof === 'number' && Number.isFinite && > 0`, else `undefined`
	- `saveModalWidth(kind, width: number | undefined)` — read-modify-write the object; `undefined` deletes the key. Write wrapped in try/catch (quota / disabled storage → ignore)
- Directive takes kind via binding value: `v-edge-resize="'ticket'"` / `v-edge-resize="'lane'"` → `Directive<HTMLElement, ModalWidthKind>`
	- `mounted(modal, binding)`:
		- `modal.dataset.widthKind = binding.value` (lets ExpandToggle find the kind without a prop)
		- if `modal.classList.contains('resizable')` and `loadModalWidth(kind)` is a number → `modal.style.width = ${width}px`. The `resizable` guard keeps the graph side panel untouched (AC6)
	- `stopResizing()` → also `saveModalWidth(kind, Math.round(modal.getBoundingClientRect().width))`. Save the rendered width (post-CSS-clamp), so what's stored = what the user saw
- ExpandToggle: after `removeProperty('width')`, read `modal.dataset.widthKind`; if it's `'ticket'` or `'lane'` → `saveModalWidth(kind, undefined)`. Matches today: toggle drops the dragged width, now for future opens too
- No new reactive state, no store, no settings UI (YAGNI)

## Acceptance criteria
- [ ] AC1 Drag ticket modal wider, close, reopen via New ticket or an existing ticket (board view) → same width
- [ ] AC2 Lane modal width is independent of ticket modal width, both directions
- [ ] AC3 Stored width survives app restart
- [ ] AC4 Expand/Collapse click → stored width for that kind cleared; next open uses default / expanded width
- [ ] AC5 Stored width larger than the window (e.g. window shrunk) → clamped by `.modal.resizable` `max-width`, no horizontal overflow
- [ ] AC6 Graph side panel ticket modal width unchanged (no inline width applied)
- [ ] Corrupt `project-tracker-modal-widths` value (non-JSON, string, negative, NaN) → ignored, default width, no console error thrown

## Verification
- Unit test `src/modalWidth.test.ts`: save/load round-trip per kind; kinds don't collide; `saveModalWidth(kind, undefined)` clears; corrupt JSON / non-number values → `undefined`. Stub `localStorage` if the vitest env lacks it
- `bun run typecheck` + `bun run test`
- Real app on isolated DB copy + throwaway project (CDP recipe), AC1–AC6:
	- Drag ticket modal → close → reopen New and Open → `getBoundingClientRect().width` matches
	- Lane modal opens at 560px after ticket drag
	- Relaunch → widths kept; check `localStorage['project-tracker-modal-widths']`
	- Click Expand → key for that kind gone
	- Set `{ticket: 5000}` → width = `innerWidth - 48`
	- Graph view open ticket → no inline `style.width`

## Out of scope
- Height resize, graph side-panel resize
- Per-board or per-ticket widths
- Persisting Expand/Collapse state across restart
- Pre-existing: a dragged width on an open ticket modal staying inline if the user flips board → graph view while it's open

## Files
- `src/modalWidth.ts` — kind type, load/save helpers, directive binding + save on release
- `src/modalWidth.test.ts` — new
- `src/components/ExpandToggle.vue` — clear stored width
- `src/components/board/NewTicketModal.vue`, `TicketModal.vue`, `LaneSettingsModal.vue` — pass kind
- `feature-map.md` 3.8 — replace "Not remembered after the modal closes." with "Remembered per modal type (ticket / lane) on this machine, `localStorage` key `project-tracker-modal-widths`; Expand / Collapse clears it."

## Work location
- Branch: `t183-store-the-width`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t183`
