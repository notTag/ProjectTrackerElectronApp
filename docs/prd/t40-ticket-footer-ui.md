# PRD — Ticket #40: Ticket footer UI updates

Branch: `t40-ticket-footer-ui` · Worktree: `.worktrees/t40`

## Problem
The ticket modal footer (`src/views/BoardView.vue` ~L896-901) has three issues:
- **Assign to me / Unassign me** duplicates the Assignee `<select>` a few rows up.
- **Delete** removes the ticket on one click, with no confirmation and no undo.
- There is no way to back out of edits. Every field saves on `@change`, so **Done** is the only exit and it keeps everything.

## Goal
Footer reads: 🗑 (left) · **Cancel** · **Done** (right). Cancel undoes this session's edits; the trash icon asks before deleting.

## Non-goals
- Undo / soft-delete for tickets
- A full draft/Save model for the ticket modal
- Changing the lane, board settings or New ticket modal footers
- Changing the Assignee select or the "Mine" filter
- Confirm dialogs for other deletes (e.g. Delete lane)

## Requirements

### R1 — Remove Assign to me
- Remove the button from `.modal-actions`.
- Delete `assignToMe` (~L198). It has no other callers (verified: only the template uses it).

### R2 — Cancel discards this session's edits
- On open, snapshot the ticket: `ticketSnapshot = structuredClone(toRaw(openTicket))` (or a spread with a copied `checklist`/`labels`). Take it when `openTicketId` goes from null to an id. A `watch(openTicketId)` covers every entry point: card click, graph view `@ticket`, and anything added later.
- Track which fields this session edited: `editTicket` adds each key in `patch` to a `Set<keyof Ticket>` while the modal is open. `editTicketLabels` and the checklist helpers already go through `editTicket`.
- **Cancel** = build a patch of `{ [key]: ticketSnapshot[key] }` for the touched keys only. If the set is non-empty, call `store.updateTicket` once with it. Then close the modal without running the Done path.
  - Restore only touched keys, not the whole snapshot. Otherwise Cancel would also undo writes that happened while the modal was open but came from somewhere else: a background `▶ Run` writing `agentRun`, an agent editing the DB through the poll, or a drag in another view.
  - Optional fields that were unset at snapshot time (`assigneeId`, `branchName`, `worktreePath`, `pullRequestUrl`, `agentId`) must go into the patch as an explicit `undefined` so they clear. Check that the repository writes NULL for an `undefined` key (`updateTicketRow`, `electron/storage/stateRepository.ts` ~L600).
- No edits → Cancel writes nothing.
- Blur ordering: clicking Cancel blurs a focused input first, and that fires `@change` → `editTicket` before the click handler runs. The key is then in the touched set and gets restored. Both calls go through `updateBoard` in order. Test this path specifically (type in Title, click Cancel straight away).
- Known side effect: the restore bumps `updatedAt`, because `store.updateTicket` always stamps it. Accepted.
- **Done**, backdrop click and Escape keep today's behaviour: close and keep edits. They also clear the snapshot and the touched set.

### R3 — Trash icon button
- Replaces the "Delete" text button, first in `.modal-actions`. It is the leftmost item; the existing footer layout puts Cancel and Done on the right (check the `.modal-actions` CSS and add a `margin-right: auto` on the trash button if needed).
- Inline `<svg>` with `stroke="currentColor"`, following the toolbar icon buttons (~L509). Classes `secondary danger` stay.
- `title="Delete ticket"` and `aria-label="Delete ticket"`.
- Click → opens R4. It no longer calls `deleteTicket` directly.

### R4 — Delete confirmation dialog
- State: `ticketPendingDeletion = ref<Ticket | null>(null)`. Store the ticket rather than the id, so the dialog still shows the right number even if the ticket changes underneath it.
- Markup follows the `autoRunConfirmLane` modal: `.modal-backdrop` > `section.modal[role="alertdialog"][aria-labelledby]`, rendered **after** the ticket modal so it stacks on top.
- Eyebrow: "Delete ticket". Question: "Are you sure you want to delete ticket #<number>?"
- Buttons in `.modal-actions`: **Cancel** (`secondary`) closes the dialog only. **Delete** (`secondary danger`, same as Dashboard's `directoryPendingRemoval`) calls `deleteTicket`, which already clears `openTicketId`; also clear `ticketPendingDeletion`, the snapshot and the touched set.
- Backdrop `@click.self` closes the dialog only.
- Escape: `handleBoardKeydown` today calls `closeModals()` for any open modal, which would close both. Add a first branch, as DashboardView `handleEscapeKey` does: if `ticketPendingDeletion` is set, clear it, `preventDefault`, return. Add it to `anyModalOpen` too, and clear it in `closeModals`.
- Move focus to the dialog's Cancel button on open (`ref` + `nextTick(focus)`), so Enter can't delete by accident and keyboard users land in the dialog.

### R5 — Docs
`feature-map.md` §3.8 **Actions** (~L355-359) becomes:
- **Trash icon** asks "Are you sure you want to delete ticket #N?". Delete removes it, and Cancel, Escape or a backdrop click keep it.
- **Cancel** undoes the edits made since the modal opened, then closes it.
- **Done** closes the modal and keeps edits. So do clicking the backdrop and Escape.

## Tests
- A pure helper would make the restore logic testable without mounting the view. For example, `restorePatch(snapshot, touchedKeys)` in `src/shared/` next to the other ticket helpers, covering: no touched keys → `{}`; touched optional field that was unset → explicit `undefined`; untouched fields left out; checklist restored as a copy.
- No component test harness? Then check the UI by hand in `bun run dev`:
  1. Edit the title and click Cancel → title reverts.
  2. Toggle a checklist item and change the lane, then Cancel → both revert.
  3. Edit, then Done / Escape / backdrop → edits kept.
  4. Trash → Cancel / Escape / backdrop → ticket still there, ticket modal still open.
  5. Trash → Delete → ticket gone, both modals closed.
- `bun run` typecheck, lint and test all pass.

## Files
- `src/views/BoardView.vue`: footer, `assignToMe` removal, snapshot/touched state, Cancel, confirm dialog, Escape branch
- `src/shared/…`: `restorePatch` helper and its test, if extracted
- `feature-map.md` §3.8

## Open questions
None. Decisions taken by default:
- Cancel restores only the fields the user touched, not a blind full-snapshot overwrite (see R2).
- The confirm dialog's Delete uses `secondary danger`, matching DashboardView.
