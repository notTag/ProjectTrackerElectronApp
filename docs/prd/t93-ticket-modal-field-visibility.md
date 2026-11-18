# PRD: Ticket #93, settings cog to show/hide ticket modal fields

## Context
The open-ticket modal (`src/views/BoardView.vue`, `<div class="ticket-modal-header">` at ~1627) shows every field every time. Most tickets use only a few, so the modal is long and noisy. The user wants to hide the fields they don't use without changing what the agent receives.

## Goal
- A cog `icon-button` in the open-ticket `.ticket-modal-header`, next to Expand/Collapse.
- Clicking it opens a popover with one checkbox per field. Unchecked means hidden.
- Display-only. The agent prompt stays the same: a hidden field that has a value is still sent, and an empty field is never sent, whether hidden or not.

## Code today (verified 2026-11-17 on `917d257`)
- Prompt: `ticketMetadataLines` (`src/shared/projectTypes.ts:567`) builds each line as `value ? line : ''` and then runs `filter(Boolean)`. `ticketAgentPrompt` (`:641`) adds the description only when it is non-empty after trim. So "no value → not passed" already holds.
  - The prompt takes `(ticket, lane, context)` and never reads `BoardPreferences`, so "hidden → still passed" holds as long as hiding stays in the view.
  - No prompt change is needed. A regression test locks the behavior in.
- Prior art: card field show/hide.
  - `TICKET_CARD_FIELDS` (`:1576`), `BoardPreferences` (`:1682`), `getBoardPreferences` (`:1714`), `toggleInList` (`:1730`), `toggleCardField` (`:1738`).
  - BoardView: `toggleField` → `savePreferences` (`:153`), checkbox UI `.card-field-list` (`:1521`).
  - Stored per project in `state.boardPreferences[projectPath]`, a per-viewer setting, not ticket data.
- `getBoardPreferences` spreads saved prefs over `createDefaultBoardPreferences()`. Adding `hiddenModalFields: []` to the defaults is enough for old saved prefs to read back `[]`. No migration needed.

## Implementation
- `src/shared/projectTypes.ts`
  - `TICKET_MODAL_FIELDS` (`{ id, label }[] as const`), shaped like `TICKET_CARD_FIELDS`, plus `type TicketModalField`.
  - `BoardPreferences.hiddenModalFields: TicketModalField[]`, defaulting to `[]` in `createDefaultBoardPreferences`.
    - Stores the hidden list, not the shown list. Fields added in later releases then show by default, so this needs no `knownCardFields`-style tracking.
  - `toggleModalField(preferences, field)` built on `toggleInList`.
- `src/views/BoardView.vue`
  - `hidesModalField(id)` reads `preferences.value.hiddenModalFields`. Toggling goes through the existing `savePreferences`.
  - Cog button in the open-ticket header: `aria-label="Ticket fields"`, `aria-expanded`, `aria-haspopup="true"`, inline SVG like the Expand button.
  - Popover: checkbox list that reuses the `.card-field-list` styling. Closes on outside click and Esc. Esc closes only the popover, not the modal (stop propagation).
  - Wrap each field/section in `v-if="!hidesModalField('<id>')"`. Where a `v-if` already exists (Last agent run, Next Lane), combine the conditions with `&&`.

## Fields
- Hideable: Status, Assignee, Description, Labels, Branch, Worktree, Version, Merge Request, External Links, Images, Checklist, Agent, Model, Full auto, Next Lane, Last agent run.
- Always shown: Title, ▶ Run / Run in terminal, Save/Delete actions, header eyebrow (#, created/updated).

## Decisions (defaulted, full auto)
- One setting per board (project), applied to every ticket's modal. Not per ticket. This matches the card display prefs.
- Only the edit-ticket modal gets the cog. The New-ticket modal stays unchanged: it has few fields and nothing is filled in yet.
- Hidden fields keep their values. Nothing is cleared, and un-hiding shows the value again.
- Pasting or dropping an image into the modal still attaches it while Images is hidden. The paste handler is on the modal section, not the Images block. Acceptable.
- No "N hidden fields" hint in v1.

## Acceptance criteria
- The cog shows at the top right of every open ticket modal, beside Expand.
- A toggle hides or shows the field immediately.
- The choice persists across modal close, app restart, and other tickets on the same board. Other boards are not affected.
- `ticketAgentPrompt` output does not depend on preferences: a hidden field with a value is present, and an empty field is absent.
- Saved prefs without `hiddenModalFields` read back as `[]`, so every field shows.
- The cog is focusable, the checkboxes are labelled, and Esc closes the popover.
- Typecheck and `bun run test` pass. Checked in the real app on an isolated DB copy before merge.

## Tests (`src/shared/projectTypes.test.ts`)
- `toggleModalField`: hide, then show again, returns the original list.
- `getBoardPreferences`: old saved prefs (no `hiddenModalFields`) → `[]`.
- `ticketAgentPrompt`: a ticket with labels/branch/description and an empty version gives the same prompt whatever is hidden. Labels/branch are present, and no `Version:` line appears.

## Branch / worktree
- Branch: `t93-add-a-settings` (off `main` @ `917d257`)
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t93`
- PRD file: `docs/prd/t93-ticket-modal-field-visibility.md`
- PR: none yet

## Open questions
None.
