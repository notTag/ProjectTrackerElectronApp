# PRD — #184 Ticket modal: accordion sections

Branch `t184-ticket-modals-should` · Worktree `.worktrees/t184`

## Problem
The ticket modal (click a ticket; also the graph view side panel) is one long column: title, ~16 fields and 5 blocks stacked. Reaching Checklist or Agent completion means scrolling past everything else. The Lane settings modal solved the same problem in #136 with collapsable sections (`docs/prd/t136-lane-settings-collapsable-sections.md`). Do the same here, same look and behavior.

## Decisions
- Native `<details>/<summary>`, exactly the #136 pattern. No new component. One `@toggle` handler. Enter/Space, focus and expanded state for screen readers come with the element.
- Field → section mapping lives on `TICKET_MODAL_FIELDS` (a `section` key per entry), mirroring `LANE_MODAL_FIELDS`. `TicketModalSection` is derived from it. Ids and order don't change, so saved `BoardPreferences.hiddenModalFields` keep working and the closed-eye list order is unchanged.
- Open/closed state: module-scope `reactive` `ticketModalSectionsOpen` in `src/modalWidth.ts`, next to `laneModalSectionsOpen`. Shared by every ticket, lasts until app restart, never saved.
- All sections start open, so nothing changes for anyone who never collapses one.
- Rename the section styles `.lane-settings-section` / `.lane-settings-section-body` → `.modal-section` / `.modal-section-body`. They're only used in `styles.css` and `LaneSettingsModal.vue`, so the rename is cheap and a shared name is clearer than a ticket modal borrowing a lane class.
- The New ticket modal is out of scope (only title, description, images).

## Layout

Always visible, never in a section:
- Header row (`#N · Created · Updated`, Ticket fields closed-eye button, Expand)
- Title input
- `.modal-actions` (trash / Cancel / Done)

Sections, in order:

| Section id | Summary | Holds (field ids) | Shown when |
|---|---|---|---|
| `details` | Details | Status, Assignee, Description, Labels, Version (`status`, `assignee`, `description`, `labels`, `version`) | any of its fields shown |
| `git` | Git | Branch, Worktree, Merge Request block (`branch`, `worktree`, `pullRequest`) | any of its fields shown |
| `links` | Links & Images | View on GitHub (#N), External Links, Images (`externalLinks`, `images`) | any of its fields shown, **or** `ticket.externalUrl` set, **or** `imageError` set |
| `checklist` | Checklist `done/total` | Checklist (`checklist`) | field shown |
| `agent` | Agent completion | Who runs it / When it's done / Run / Last agent run, unchanged (`agent`, `model`, `fullAuto`, `nextLane`, `lastAgentRun`) | always (the Run block can't be hidden today, so the section never empties) |

Notes on the `links` rule: today "View on GitHub" shows even when External Links is hidden (a standalone duplicate link at `TicketModal.vue:600-608`), and Images shows while `imageError` is set even if hidden (`:554`). Keeping both behaviors means the section stays when either applies. Simplification: move the View on GitHub link to the top of the `links` section body, shown whenever `ticket.externalUrl` is set, and delete the standalone duplicate.

Version moves out of its current spot between Worktree and Merge Request into Details. Field order inside a section follows `TICKET_MODAL_FIELDS`, so move the `version` entry to after `labels` to keep the closed-eye list, the Display list and the modal in the same order (as #136 did for orchestrator fields).

## Change (5 files)

### 1. `src/shared/projectTypes.ts` (`TICKET_MODAL_FIELDS`, ~l.1951)
- Add `section` to every entry (values above). Move `version` after `labels`.
- `export type TicketModalSection = (typeof TICKET_MODAL_FIELDS)[number]['section']`

### 2. `src/modalWidth.ts`
```ts
// Shared by every ticket's modal: collapsing a section on one ticket collapses it on all.
export const ticketModalSectionsOpen = reactive<Record<TicketModalSection, boolean>>({
  details: true,
  git: true,
  links: true,
  checklist: true,
  agent: true
})
```

### 3. `src/components/board/TicketModal.vue`
- Helpers, same shape as `LaneSettingsModal.vue:66-75`:
  - `showsTicketSection(section)` = `TICKET_MODAL_FIELDS.some(field => field.section === section && !hidesModalField(field.id))`
  - `rememberTicketSectionOpen(section, event)` writes `(event.target as HTMLDetailsElement).open` into `ticketModalSectionsOpen`.
- Wrap each group:
  ```html
  <details v-if="…" class="modal-section" :open="ticketModalSectionsOpen.git"
           @toggle="rememberTicketSectionOpen('git', $event)">
    <summary class="eyebrow">Git</summary>
    <div class="modal-section-body">…existing markup…</div>
  </details>
  ```
- Checklist summary: `Checklist` plus the existing `done/total` span (shown when the ticket has items). Drop the inner `<p class="eyebrow">Checklist…</p>`, since the summary replaces it and stays visible when collapsed.
- Agent completion: drop the inner `<p class="eyebrow">Agent completion</p>`; the summary replaces it. Keep `.ticket-agent` on the body div so its 8px gap holds (same as Auto Run in #136).
- Keep the inner "Merge Request", "External Links" and "Images" eyebrows. They're sub-headings inside multi-block sections.
- Existing per-field `v-if="!hidesModalField(…)"` stay as they are.

### 4. `src/styles.css` (~l.1643-1683)
- Rename the 6 `.lane-settings-section*` selectors to `.modal-section*`. No rule changes. The ticket modal gets the same chevron (›, rotates 90° open), focus ring and reduced-motion rule.
- `LaneSettingsModal.vue`: rename the 3 `class="lane-settings-section"` and 3 `lane-settings-section-body` usages.
- Check spacing: the ticket modal's existing column gap should apply between sections. Adjust only if the sections look cramped or loose next to the lane modal.

### 5. `feature-map.md` §3.8
- After the Ticket fields paragraph, add **Sections**: the 5 names + contents, all open by default, open/closed shared by every ticket until restart (`ticketModalSectionsOpen` in `src/modalWidth.ts`), a section disappears when every field in it is hidden (Links & Images stays while the ticket has a GitHub link), Checklist header shows done/total when collapsed, same in the graph side panel.
- §3.9: update any class name mention if it names `.lane-settings-section` (currently none).

### Test (`src/shared/projectTypes.test.ts`)
Mirror the #136 test at ~l.796: pin each ticket field's section and order, and assert every `TICKET_MODAL_FIELDS` entry is in one of the 5 sections.

## Behavior details (verified against code)
- **Collapsing keeps values**: clicking a summary moves focus to it. The focused input fires `change` and saves, same as clicking any other field. `@focusin="store.refresh()"` on the modal also fires on summary focus, same as focusing any field today. Nothing new.
- **Paste**: `@paste` sits on the modal `<section>` (`:377`), not on the Images block, so it works with Images collapsed. `pasteTicketImages` skips pastes into text fields (`isTextFieldPaste`), so AC7 is tested with focus on a non-text element, e.g. a section summary.
- **Drag-and-drop** onto the dropzone needs Images open, since the dropzone is inside it. Accepted: the dropzone is visibly hidden when collapsed.
- **Find bar (PageFind)**: uses Electron `webContents.findInPage` (`electron/main.ts:183`). Electron 35 = Chromium 134, and Chromium has auto-expanded a closed `<details>` on a find-in-page match since v97, firing `toggle`. So the section opens and `ticketModalSectionsOpen` records it. No code needed. [~85% confidence, verify in the running app: Cmd+F a word that's only in a collapsed section's text.] If it doesn't expand, ship anyway and file a follow-up. Don't add JS for it here.
- Graph side panel: same component (`TicketModal.vue`), so it gets the sections automatically.

## Acceptance
- AC1 Open a ticket → 5 sections, all open, in the order above.
- AC2 Collapse Git, close, open another ticket → Git still collapsed.
- AC3 Restart app → all sections open.
- AC4 Hide Branch, Worktree, Merge Request via closed-eye → Git section gone. Unhide one → it's back.
- AC5 Type in Description, click the Details header → edit saved (check `updatedAt` / reopen).
- AC6 Checklist collapsed → header still shows done/total.
- AC7 Images collapsed, focus a section header, Cmd+V an image → attached.
- AC8 Graph side panel shows the same sections and shares open/closed state.
- AC9 Tab to a section header, Enter and Space each toggle it; chevron rotates.
- AC10 Lane settings modal sections look and behave as before (class rename regression).
- AC11 (soft) Cmd+F a term inside a collapsed section → section opens.

Verify AC1-AC11 in the running app on an isolated DB copy before merge.

## Out of scope
- New ticket modal.
- Persisting open/closed across restarts.
- Per-board or per-ticket section state.

## Open questions
None. Defaults (grouping, names, session-only state, New ticket modal excluded) come from the ticket and can be revisited in review.
