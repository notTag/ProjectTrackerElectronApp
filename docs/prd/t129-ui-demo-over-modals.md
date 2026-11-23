# PRD — Ticket #129: Allow the 'UI Demo' to be modified while a modal is open

## Context
- #126 added the floating 🎚 UI Demo panel (`src/components/UiDemoPanel.vue`, `src/uiDemo.ts`). It has an "Opacity — modals" and "Radius — modals" knob, but you can't use them while looking at a modal.
- Root cause: `.ui-demo-panel` is `z-index: 150` (`src/styles.css`), below `.modal-backdrop` at `z-index: 200`. Any open modal's full-screen backdrop paints over the panel and takes its clicks. A click on the panel area lands on the backdrop and closes the modal through `@click.self`.
- Layers today: titlebar 100 · UI Demo 150 · modal backdrop 200 · message toasts 300 · page find 1000.

## Goal
With the UI Demo panel open, opening any board modal (ticket, new ticket, lane settings, ⚙ Display, delete confirms, Auto Run confirm, new lane) leaves the panel visible on top and fully usable: sliders, number boxes, selects, Reset, ✕ and title-bar drag. Changes show live on the modal under it.

## Requirements
- R1: Raise `.ui-demo-panel` z-index from 150 to 250, above modal backdrops (200) and below message toasts (300) and page find (1000). Update its CSS comment to match the new order.
- R2: Clicking or dragging on the panel never closes or changes the modal under it. The panel is a sibling of the backdrops, not a child, so a higher z-index is enough. Verify it, don't add handlers.
- R3: Escape order stays the same: open modals and menus close first, then the panel (`handleBoardKeydown` in `src/views/BoardView.vue`).
- R4: With no modal open, the panel behaves as before.

## Implementation notes
- One CSS line plus its comment in `src/styles.css`. No TS or Vue changes expected.
- Update `feature-map.md` §UI Demo panel: the panel stays on top of open modals, so modal knobs can be tuned live.
- #130 (Save button) edits `UiDemoPanel.vue`, and this ticket edits only `styles.css`, so a conflict is unlikely.

## Acceptance criteria
- [ ] Open UI Demo, then open a ticket: the panel shows above the backdrop. Dragging "Opacity — modals" fades the ticket modal live, and the modal stays open.
- [ ] Same check for the lane settings and ⚙ Display modals and the delete confirm.
- [ ] Dragging the panel by its title bar over a modal works, and the modal stays open.
- [ ] Message toasts still paint above the panel.
- [ ] Escape with a modal and the panel both open closes the modal first. A second Escape closes the panel.
- [ ] `bun run test` and `bun run build` pass.

## Out of scope
- Opening the panel while a modal is already open. The 🎚 button sits under the backdrop. Open the panel first, then the modal. A follow-up ticket can add a keyboard shortcut if needed.
- Dashboard view modals. The panel only mounts on the board.

## Open questions
None.
