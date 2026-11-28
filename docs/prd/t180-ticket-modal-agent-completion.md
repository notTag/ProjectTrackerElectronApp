# PRD — Ticket #180: Ticket Modal's Agent Completion section rework

## Work location
- Branch: `t180-ticket-modal-s`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t180`
- PRD file: `docs/prd/t180-ticket-modal-agent-completion.md`

## Goal
Make "Agent completion" fit the 760px modal: short controls side by side, all next-lane settings in one place, reference text in tooltips, no empty boxes. Layout and text only.

## Code today (verified on `5d99574`)
All in `src/components/board/TicketModal.vue` and `src/styles.css`.

| Lines | Element | Visibility |
|---|---|---|
| 591-592 | `<section class="ticket-agent">` + `.eyebrow` "Agent completion" | always |
| 593-601 | Agent `<select>` | `!hidesModalField('agent')` |
| 602-610 | Model `<ModelField>` | `!hidesModalField('model')` |
| 611-620 | Full auto checkbox (`aria-labelledby="ticket-full-auto-label"`) + `InfoTip` | `!hidesModalField('fullAuto')` |
| 621-623 | Separate `.field-hint` "In every lane: …" | `!hidesModalField('fullAuto')` |
| 624-637 | Next Lane `<select>` + `.field-hint` "Where this ticket goes …" | `!hidesModalField('nextLane')` |
| 638-643 | 4-line `<p class="agent-hint">` | always |
| 644 | `<pre class="agent-command">` | always |
| 645-670 | `.agent-actions`: ▶ Run / ⏯ Resume (`ticketCanResume`) / ⌁ Run in … | always / conditional |
| 671 | **end of section** | |
| 673-678 | `<section class="ticket-agent-run">` Last agent run, `<pre>` | `ticket.agentRun && !hidesModalField('lastAgentRun')` |
| 680-682 | `<a class="ticket-external">` View on GitHub | `ticket.externalUrl` |
| 684-691 | Move to Next Lane checkbox (`moveOnComplete`) | `openTicketNextLaneId && !hidesModalField('nextLane')` |
| 693-700 | Move rules `<textarea>` | `openTicketNextLaneId \|\| ticket.moveRules` |
| 702-713 | Move rules pass checkbox | `moveRulesList(ticket).length` |

- External Links section: lines 521-542, `v-if="!hidesModalField('externalLinks')"`, class `ticket-checklist ticket-links`.
- CSS: `.ticket-agent-run pre` (`styles.css:2060`), `.ticket-agent` flex column `align-items: flex-start` (`:2074`), `.agent-hint` (`:2081`), `.agent-command` (`:2087`), `.auto-run-pickers` (`:2101-2116`, label rule scoped to `.lane-modal`), `.agent-actions` (`:2118`).
- Screenshot problems confirmed: right half empty, three hint lines, empty bordered box under "Last agent run" when output is blank, GitHub link + move controls outside the section.

## Target layout
One `<section class="ticket-agent">`, header "Agent completion", three groups:

```
AGENT COMPLETION
Who runs it
  [Agent ▾]          [Model ▾]          [☐ Full auto ⓘ]
When it's done
  Next Lane ⓘ [Lane default: … ▾]       [☑ Move to Next Lane: X]
  Move rules [textarea, full width]
  [☐ Move rules pass]
Run ⓘ
  [command pre, full width]
  [▶ Run] [⏯ Resume] [⌁ Run in VSCode]
  LAST AGENT RUN · PRD · date
  [output pre]  — or muted "No output"
```

### Group 1 — Who runs it
- One row: Agent | Model | Full auto
- Full auto InfoTip text merges both strings: "Same as a lane's Full auto, but for this ticket in every lane it enters: when an agent moves this ticket on, the next lane's agent starts on it."
- Delete the separate `.field-hint` (621-623)

### Group 2 — When it's done
- Row: Next Lane select | Move to Next Lane checkbox
- Next Lane `.field-hint` → `InfoTip` beside the "Next Lane" caption, same text
- Below the row: Move rules textarea, then Move rules pass checkbox
- Conditions unchanged: Move to Next Lane = `openTicketNextLaneId && !hidesModalField('nextLane')`; Move rules = `openTicketNextLaneId || ticket.moveRules`; Move rules pass = `moveRulesList(ticket).length`

### Group 3 — Run
- `InfoTip` on the "Run" caption carries the full `.agent-hint` text; delete the `<p class="agent-hint">` and its CSS rule
- Command `<pre>`, then `.agent-actions`
- Last agent run moves inside the section, right after `.agent-actions`. Keep class `ticket-agent-run` (a `<div>` now, not a `<section>`) and its `v-if`
- Blank output (`!ticket.agentRun.output.trim()`) → `<p class="field-hint">No output</p>` instead of the `<pre>`

### Group captions
- Plain muted caption, smaller than `.eyebrow` (e.g. new `.field-group-caption`: `font-size: 0.78rem; color: var(--color-text-muted); font-weight: 600`)
- Caption renders only if at least one control in its group is visible:
  - Who runs it: `!hidesModalField('agent') || !hidesModalField('model') || !hidesModalField('fullAuto')`
  - When it's done: Next Lane, Move to Next Lane or Move rules visible
  - Run: always (command + Run are never hidden)
- Put the conditions in small computed refs, not inline triple-`||` in the template

### View on GitHub
- Move `<a class="ticket-external">` into the External Links section, above the list
- When External Links is hidden (`hidesModalField('externalLinks')`), render it directly above the Agent completion section instead — still only when `ticket.externalUrl`

## CSS
- Generalize `.auto-run-pickers` into a shared `.field-row` (flex, wrap, 8px gap; children `flex: 1 1 0; min-width: 140px`; selects `width: 100%`). Apply to both `.lane-modal` and `.ticket-modal`. Keep `.auto-run-pickers` as an alias or rename it in BoardView/LaneModal in the same diff — check #179 first; if #179 already landed a shared class, reuse it
- Specificity: `.lane-modal label` / `.ticket-modal label` rules exist — scope the child rule so it outranks them (`.ticket-modal .field-row > label`), same reason as the existing `.lane-modal` comment
- Checkbox labels in a row: `align-self: flex-end`, min-height = select height, so the box lines up with inputs not captions
- `.ticket-agent { align-items: stretch }`; `.agent-actions` keeps its own flex (buttons not stretched: `align-self: flex-start` or `justify-content: flex-start`)
- Rows wrap when narrow; no horizontal scroll at any width

## Constraints
- Same ids, aria labels, handlers, `v-if` conditions per control; hiding one control keeps the rest of its row
- No store, type, IPC or `TICKET_MODAL_FIELDS` changes
- Works in: normal modal, expanded (`.ticket-modal.expanded`), edge-resized modal, graph side panel (`.graph-ticket-panel .ticket-modal`)

## Test plan
- `bun run typecheck` / lint / existing tests green (no new logic worth a unit test; the caption-visibility computeds are trivial)
- Manual, isolated DB copy (see memory: drive app via CDP):
  - Ticket with agentRun output, with blank agentRun output, without agentRun
  - With / without moveRules, with / without next lane (lane default "none")
  - With externalUrl, External Links shown and hidden
  - Hide Agent + Model + Full auto via field visibility → "Who runs it" caption gone; hide only Model → Agent and Full auto stay in row
  - Narrow width, expanded, graph panel: rows wrap, no overflow
- PR screenshots before/after to `docs/pr-screenshots/`

## Out of scope
- New `TICKET_MODAL_FIELDS` toggles
- Run / Resume / Run in behaviour or command text
- Collapsible sections
- Other ticket modal sections

## Open questions
- None
