# PRD — #117 Resizable settings modals

## Why a PRD
- Small diff, but two traps: the native resize handle writes an inline `style.width` that silently beats `.modal.expanded` (Expand toggle stops working after a drag), and `.lane-modal` is shared by three modals, only one of which is in scope.

## Problem
- Ticket + per-lane settings modals have fixed widths, plus a two-state Expand toggle (#83, #98) jumping to 85vw. Users want any width in between. Today's width = floor.

## Today (verified 2026-11-20)
- `.modal-backdrop` `src/styles.css:975` — `position: fixed; inset: 0; display: grid; place-items: center; padding: 24px`
- `.modal` `src/styles.css:~988` — `width: min(560px, 100%); max-height: 100%; overflow-y: auto`
- `.ticket-modal` `src/styles.css:1557` — `width: min(760px, 100%)`
- `.modal.expanded` `src/styles.css:1561` — `width: min(85vw, 100%)`
- `.graph-ticket-panel .ticket-modal` `src/styles.css:2022` — `width: 100%` (panel owns width)
- Expand state: `ticketModalExpanded` / `laneModalExpanded` in `src/modalWidth.ts`; toggled by `src/components/ExpandToggle.vue` (`defineModel<boolean>`, flips on click)
- `src/views/BoardView.vue` modals:
	- 1832 board settings `.modal.lane-modal` — OUT of scope
	- 1880 new ticket `.modal.ticket-modal` + ExpandToggle — IN
	- 1948 new swim lane `.modal.lane-modal` — OUT
	- 1961 open ticket `.modal.ticket-modal`; ExpandToggle only when `boardView !== 'graph'` — IN (board view only)
	- 2398 per-lane settings (`openLane`) `.modal.lane-modal` + ExpandToggle — IN

## Requirements
1. New ticket, open ticket (board view), and per-lane settings modals are horizontally resizable.
2. Min width = current default: 560px lane, 760px ticket; still `min(…, 100%)` on narrow windows.
3. Max width = backdrop content box (window minus 24px padding each side). Shrinking the window after a drag clamps the modal.
4. Expand toggle keeps working after a drag: click → 85vw (or back to default), dragged width dropped.
5. Unchanged: graph side-panel ticket modal, board settings, new lane, delete/auto-run confirms, dashboard modals.
6. Height not resizable (already `max-height: 100%` + scroll).

## Design
- Opt-in class, not selector exclusions: add `resizable` to the three in-scope `<section>`s.
	- 1961: `:class="{ expanded: …, resizable: boardView !== 'graph' }"` → graph panel excluded without a `:not()` rule
- CSS (next to `.modal.expanded`):
	- `.modal.resizable { resize: horizontal; min-width: min(560px, 100%); max-width: 100%; }`
	- `.ticket-modal.resizable { min-width: min(760px, 100%); }`
	- `overflow-y: auto` on `.modal` already satisfies `resize`'s non-visible-overflow requirement
- Expand reset — one line in shared `ExpandToggle.vue` click handler, covers all three modals:
	- `(event.currentTarget as HTMLElement).closest<HTMLElement>('.modal')?.style.removeProperty('width')` then flip `expanded`
	- Why there, not a watch per ref: the toggle is the only path that changes expand state, and both ticket modals share one ref
- Not persisted: inline width dies with the `v-if` section on close → each open starts at default/expanded width. Nothing to add.

## Risk to check in app
- Centred grid item grows on both sides → native bottom-right handle's edge moves at ~half cursor speed.
	- Acceptable → ship CSS only
	- Feels bad → replace with a right-edge pointer-drag handle applying 2× pointer delta (pointer capture, clamp via the same min/max CSS). Only build if needed.
- Native handle sits at scrollport's bottom-right corner; confirm visible on a tall, scrolling ticket modal and not covered by `.modal-actions`.

## Verification (no unit tests — pure CSS + one DOM line)
- Run app on isolated DB copy (memory: run-app-before-merge, drive-app-via-cdp)
- Wide window: drag each in-scope modal wider → grows; can't go below 760/560 or past backdrop padding
- Narrow window (< 808px): modal fills width, drag has no effect, no horizontal overflow
- Drag → click Expand → 85vw; click again → default width
- Expanded → drag → collapse → default width
- Graph view: open ticket panel has no handle, width unchanged
- Board settings / new lane / confirm dialogs: no handle

## Out of scope
- Height resize; persisting width (add to `src/modalWidth.ts` later); graph side-panel resize; other modals

## Decisions (defaulted)
- "Each swimlane settings modal" = per-lane `openLane` modal only
- Expand toggle stays
- Dragged width not persisted

## Branch / worktree
- Branch `t117-resizable-settings-modals`
- Worktree `~/Code/Projects/ProjectTracker/electron-app/.worktrees/t117`
