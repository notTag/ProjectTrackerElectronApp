# PRD — Ticket #75: Orchestrator agent prompt

Branch: `t75-orchestrator-agent-prompt`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t75`

## Summary
Show the Auto Run orchestrator prompt the app generates, read-only, in each lane's cog modal. Today the "Orchestrator prompt" section only holds the user's extras textarea (empty by default), so it looks blank and the user can't see what the orchestrator is told.

## PRD needed?
Yes. Small UI change, but it touches the launch-time prompt builder, which must stay byte-for-byte identical for real launches. The PRD pins down how to render placeholders without a second prompt code path.

## Context (verified 2026-11-14 on `4d800ca`)
- Generated prompt: `orchestratorPrompt(lane, entries, context)` in `src/shared/projectTypes.ts:811`
  - `entries` is only used for two things: `ticketLines` (`- #N title — tab "…" — branch …`) and `ticketNumbers` (the `IN (…)` list in the read-only SQL)
  - `AutoRunLaunchEntry` (`:686`) = `{ ticket: Ticket, launch: AutoRunTicketLaunch }`, `launch.number` is a `number`
  - Context: `OrchestratorPromptContext` (`:769`) = `projectPath`, `lanes`, `terminalId`, `terminalLabel`
  - Lane extras appended by `laneInstructionsSection` (`:803`) under `Lane instructions`, omitted when empty
- Launch call: `confirmAutoRunLane` in `src/views/BoardView.vue` (~`:884`) builds the context inline (`board.value.lanes` + `getUnassignedLane(board.value)`, chosen terminal `id`/`label`) and calls `buildOrchestratorLaunch`
- Lane terminal: `autoRunTerminal(lane)` (`BoardView.vue:835`) → `resolveAutoRunTerminal(lane.autoRunTerminalId, openInStore.selectedId)` returns an `OpenInTarget` (`id`, `label`)
- Cog modal section: `BoardView.vue` ~`:1699-1708`, `<label>` "Orchestrator prompt" + textarea `@change` → `editLane(openLane, { orchestratorPrompt })` + hint
- Tests: `describe('orchestratorPrompt')` at `src/shared/projectTypes.test.ts:1099`

## Decisions
- D1. Display, not edit. The base prompt stays generated; extras stay append-only (#50 D2), so the report-only safety rules can't be removed by the user. [~80% confidence this matches intent — would need user to confirm they don't want the base prompt editable]
- D2. Placeholders, not the lane's current tickets. The real list only exists at launch (selected/filtered tickets), and the lane may be empty
- D3. Layout: native `<details>` labelled "Generated prompt (sent to the orchestrator)", collapsed by default, containing a `<pre>` (read-only by construction), placed above the extras textarea. Keeps the modal from growing ~40 lines
- D4. One prompt code path. The preview calls the same builder as launch; only the ticket-specific strings differ
- D5. Placeholder mechanism: split, don't cast. Extract the body of `orchestratorPrompt` into an internal `renderOrchestratorPrompt(lane, ticketLines, ticketNumbers, context)` that takes the two already-rendered strings. `orchestratorPrompt` computes them from `entries` exactly as today; `orchestratorPromptPreview` passes placeholders. No sentinel numbers, no `as unknown as number`, no string replace

## Requirements
- R1. `src/shared/projectTypes.ts`
  - Extract `renderOrchestratorPrompt(lane, ticketLines: string[], ticketNumbers: string, context)` from `orchestratorPrompt` (not exported)
  - `orchestratorPrompt(lane, entries, context)` keeps its signature and output; builds `ticketLines`/`ticketNumbers` from entries as today, then delegates
  - Export `orchestratorPromptPreview(lane, context)`:
    - ticket line: `- #<N> <ticket title> — tab "<tab title>" — branch <branch>`
    - ticket numbers: `<N>` (SQL reads `number IN (<N>)`)
- R2. `src/views/BoardView.vue`
  - Extract `orchestratorContextFor(terminal: OpenInTarget): OrchestratorPromptContext` (project path, `board.value.lanes` + `getUnassignedLane(board.value)`, terminal id/label); use it in `confirmAutoRunLane` instead of the inline object
  - Computed `openLaneOrchestratorPreview` = `openLane ? orchestratorPromptPreview(openLane, orchestratorContextFor(autoRunTerminal(openLane))) : ''`
  - In the Orchestrator prompt section, above the textarea: `<details><summary>Generated prompt (sent to the orchestrator)</summary><pre>{{ openLaneOrchestratorPreview }}</pre></details>`
  - `<pre>` needs `white-space: pre-wrap`, scrollable max-height, monospace, existing theme tokens. Keep `<details>` outside the `<label>` (or restructure) so clicking the summary doesn't focus the textarea
  - Textarea, placeholder, `@change` save and hint unchanged
- R3. `src/shared/projectTypes.test.ts`, new `describe('orchestratorPromptPreview')`:
  - contains lane name and lane id (the `still in the <id> lane` line)
  - contains `#<N> <ticket title>`, `tab "<tab title>"`, `branch <branch>`, `number IN (<N>)`
  - contains the terminal's `listTabs` recipe for a scriptable terminal, and the "cannot be queried" text for an unscriptable one
  - contains `Lane instructions` + the extras when `orchestratorPrompt` is set; no `Lane instructions` when empty/whitespace
  - existing `orchestratorPrompt` tests untouched and passing

## Acceptance criteria
- [ ] Every lane's cog modal (unassigned included) shows the generated orchestrator prompt, read-only, collapsed, above the extras textarea
- [ ] Preview comes from the same builder as launch (D4/D5), so it can't drift
- [ ] Preview uses the lane's real name/id, the board's lanes (unassigned included), the project path, and `autoRunTerminal(lane)`
- [ ] Ticket-specific parts show placeholders, not real tickets
- [ ] Editing extras updates the preview's `Lane instructions` once the `@change` save lands
- [ ] Changing the lane's Auto Run terminal updates the terminal section of the preview
- [ ] Preview can't be edited; extras textarea behaves as before
- [ ] Launch-time prompt byte-for-byte unchanged (existing tests pass unmodified)
- [ ] `bun run test` and typecheck pass

## Out of scope
- Editing/replacing the base prompt
- Previewing the per-ticket agent prompt
- Previewing with the actually selected tickets
- Orchestrator behavior, agent/model pickers (#47, #72)

## Open questions
None. Defaults above.
