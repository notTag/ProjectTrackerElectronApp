# PRD — Ticket #170: Drag-reorder agent rules in the graph view

## Work location
- Branch: `t170-in-the-graph`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t170`

## Problem
Graph view side panel (lane selected) shows each lane prompt as a list of rules under "Agent prompt" and "Orchestrator prompt". Rules can be edited, deleted (×) or appended (+ Add rule), but not reordered — the only way to change order is delete + re-add. Rule order matters: it is the order the agent reads them.

## Context (verified against code)
- Rule list markup: `src/components/TicketGraph.vue:367-375` (`v-for` over `laneRules(selectedLane, section.field)`, row class `graph-rule`, textarea + delete button).
- Save path: `saveRules(lane, field, rules)` → `rulesToPrompt()` → `emit('editLane', …)` (`TicketGraph.vue:274-277`). Array order = stored prompt order, so reorder = reorder array + `saveRules`.
- Parsing helpers: `promptRules` / `rulesToPrompt` in `src/shared/projectTypes.ts:746-760`, tested in `src/shared/projectTypes.test.ts:2332`.
- Numbered rules (`1. …`) keep their number as text (`projectTypes.ts:741`) — prompts refer back to "steps 1-5".
- Board already uses native HTML5 drag (`TicketCard.vue:55`, `draggable="true"`). No drag library installed → use native DnD, add no dependency.

## Requirements
- R1. Each rule row shows a drag handle (hamburger/grip icon, `☰` or `⠿`) on the LEFT of its textarea, in both sections.
- R2. Dragging a rule by its handle and dropping it on another rule row in the same section moves it to that slot; new order saves immediately through `saveRules`.
- R3. Drag stays inside its section: a drop on the other section (Agent ↔ Orchestrator) does nothing.
- R4. Only the handle starts a drag; text selection and editing in the textarea work as today.
- R5. Keyboard alternative: the handle is a focusable `button` (`aria-label="Reorder rule N"`); ArrowUp / ArrowDown moves the rule one slot and keeps focus on the moved rule's handle.
- R6. Visual feedback: `grab` / `grabbing` cursor on the handle; drop indicator (border-top or border-bottom) on the hovered row.

## Implementation sketch
1. `projectTypes.ts`: pure `moveRule(rules: string[], fromIndex: number, toIndex: number): string[]` — returns a new array, same-index / out-of-range = unchanged copy. Tests in `projectTypes.test.ts`: first→last, last→first, middle move, same index no-op.
2. `TicketGraph.vue`:
   - `draggingRule = ref<{ field: PromptField; index: number } | null>(null)`.
   - Handle `<button class="graph-rule-handle" draggable="true" @dragstart @dragend @keydown>` before the textarea.
   - Row `@dragover.prevent` (only when `draggingRule.field === section.field`) + `@drop` → `saveRules(lane, field, moveRule(laneRules(lane, field), from, to))`.
   - ArrowUp/ArrowDown on handle → same `moveRule` call with `index ∓ 1`, then refocus handle after rerender (`nextTick`).
3. Styles: handle column in `.graph-rule` row, drop indicator class.
- `:key` stays `${index}:${rule}` — rows rerender after save.

## Decisions (defaults taken, no blocker)
- Numbered rules are NOT renumbered on reorder — the number is part of the rule text by design (`projectTypes.ts:741`). Users edit numbers by hand.
- Drop target = the hovered row's index (insert before when dragging up, after when dragging down); no between-row gaps.

## Acceptance criteria
- Every rule in both sections shows a handle left of its textarea.
- Drag rule 2 onto rule 1 → order swaps in the panel and persists after reselecting the lane and after app reload (stored prompt text reordered).
- Dropping onto the other section changes nothing in either prompt.
- Editing, deleting, adding rules unchanged.
- Focus handle + ArrowUp/ArrowDown reorders; focus follows the moved rule.
- `moveRule` unit tests pass; `bun run test` + typecheck green.

## Out of scope
- Reordering in `LaneSettingsModal.vue` (plain prompt textarea there).
- Moving rules between Agent and Orchestrator prompts.
- Renumbering numbered rules.
