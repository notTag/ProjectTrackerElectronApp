# PRD — #108 Confirm before deleting a swimlane

## Why a PRD
- Small UI change, but the ticket delete confirm is wired into 5 places (ref, watch, `anyModalOpen`, `closeModals`, Escape handler). Missing one = Escape closes the lane modal too, or a stale confirm lingers. This doc lists every touchpoint.

## Problem
- Lane settings modal "Delete lane" deletes on one click. No undo.
- Lost on misclick: lane name, prompt, Next Lane config. All its tickets → No status, Next Lane pointers to it cleared, affected tickets disarmed (`removeLaneFromBoard`).

## Today (verified 2026-11-18)
- Button: `src/views/BoardView.vue:2448-2456` → `@click="deleteLane(openLane)"`; hidden for `UNASSIGNED_LANE_ID`
- `deleteLane` `src/views/BoardView.vue:730` → `openLaneId = null`, `store.removeLane(...)`
- `removeLane` `src/stores/projects.ts:361` → `removeLaneFromBoard` `src/shared/projectTypes.ts:1450`
- Pattern to copy, ticket delete confirm:
	- `ticketPendingDeletion` + `deleteConfirmCancelButton` refs `:452-453`
	- stale watch on `openTicket` `:456`
	- `askToDeleteTicket` focuses Cancel after `nextTick` `:461`
	- `confirmDeleteTicket` `:467`
	- listed in `anyModalOpen` `:153`, cleared in `closeModals` `:559`
	- Escape backs out of confirm only `:596`
	- alertdialog markup `:2128-2139`

## Change (all in `src/views/BoardView.vue`)
- State
	- `lanePendingDeletion = ref<SwimLane | null>(null)`
	- `laneDeleteConfirmCancelButton = ref<HTMLButtonElement | null>(null)`
	- `lanePendingDeletionTicketCount` computed: `board.value.tickets.filter(t => t.laneId === lane.id).length`
- Stale guard: `watch(openLane, lane => { if (!lane) lanePendingDeletion.value = null })` — lane removed by poll / other window → drop the question
- `askToDeleteLane(lane)`: set pending, `await nextTick()`, focus Cancel
- `confirmDeleteLane`: read pending, clear it, `await deleteLane(lane)` (unchanged)
- Button `@click` → `askToDeleteLane(openLane)`
- Wire-up, same as ticket confirm
	- add `lanePendingDeletion.value` to `anyModalOpen`
	- clear in `closeModals`
	- Escape handler: next to the ticket branch, `if (lanePendingDeletion.value) { clear; preventDefault; return }` — Escape closes confirm only, lane modal stays
- Markup: new block after ticket confirm
	- `role="alertdialog"`, `aria-labelledby="delete-lane-question"`
	- eyebrow `Delete lane`
	- question: `Are you sure you want to delete the <lane name> lane?`
	- consequence line, only when count > 0: `Its N ticket(s) will move to No status.` (use `UNASSIGNED_LANE_NAME`, singular/plural `ticket`/`tickets`)
	- buttons: Cancel (`secondary`, ref, focused) · Delete (`secondary danger`)
	- backdrop `@click.self` / Cancel → clear pending; lane modal untouched

## Acceptance
- Click "Delete lane" → confirm opens; lane still on board
- Cancel / backdrop / Escape → confirm closes, lane modal still open, lane + tickets untouched
- Delete → same as today: lane gone, its tickets in No status, Next Lane pointers cleared, lane modal closed
- Cancel focused on open; Enter right after open does not delete
- Count matches tickets in lane; line hidden for empty lane
- Unassigned lane: still no delete button
- Lane deleted from elsewhere while confirm open → confirm disappears

## Tests
- No component test setup in repo (no `@vue/test-utils`, no `BoardView` tests) → don't add a dep for this
- `removeLaneFromBoard` tests unchanged (behavior unchanged)
- Verify in app via CDP on isolated DB copy before merge: open lane modal → Delete lane → Escape / Cancel / Enter / Delete paths; lane with and without tickets
- `bun run test` + `vue-tsc` typecheck green

## Out of scope
- Undo / soft delete
- Confirms for other destructive actions

## Defaults chosen
- Confirm always shown, even for empty lanes (consistent, cheap)
- Custom modal, not `window.confirm` (matches ticket delete; native dialogs block CDP)
- No shared confirm component extraction — 2 call sites, copy is smaller

## Work tracking
- Branch: `t108-feature-need-confirmation`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t108`
- PRD: `docs/prd/t108-lane-delete-confirm.md`

## Open questions
None.
