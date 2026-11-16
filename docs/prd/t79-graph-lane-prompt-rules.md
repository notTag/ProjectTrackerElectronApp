# PRD — Ticket #79: Project Graph view — lane prompts as editable rules

## Summary
In the Project Graph view of the project, instead of clicking on a lane and seeing the list of tickets associated with it, there should be two sections. An Agent Prompt Section and an Orchestrator prompt section. The user should be able to click a lane and see the agent prompt and Orchestrator prompt broken down into a list of editable rules.

## Context
Graph view (`src/components/TicketGraph.vue`, mounted at `src/views/BoardView.vue:1052`) shows lanes as DFA states (#71). Clicking a lane fills the `.graph-details` sidebar with: ticket count, Next Lane, Incoming, Ticket overrides, then a "Tickets" list. Lane prompts today are only editable as two free-text textareas in Swimlane settings (`BoardView.vue:1685` agent prompt, `:1731` orchestrator prompt), each saved on `change` via `editLane(lane, patch)` → `store.updateLane`. Existing prompts on this board are already written as `- ` bullet lists, so a bullet = a rule.

## Acceptance criteria
- AC1: Clicking a lane in Graph view shows two sections in the sidebar, "Agent prompt" and "Orchestrator prompt", in place of the "Tickets" list.
- AC2: Each section lists the lane's prompt split into rules, one editable field per rule.
- AC3: Editing a rule and leaving the field (blur / Enter) saves the lane prompt; Swimlane settings shows the same text afterwards, and the next agent / orchestrator run gets it.
- AC4: Each section has "+ Add rule" and a delete (×) per rule. Deleting the last rule leaves an empty prompt.
- AC5: Empty prompt → section shows "No rules yet" plus "+ Add rule".
- AC6: When the lane has an agent file (`agentFilePath`), the Agent section shows "Also follows: <file name>" read-only.
- AC7: Ticket nodes on the canvas still open the Ticket panel; Next Lane / Incoming / overrides lines stay.
- AC8: Works for the unassigned lane when it's visible.
- AC9: `bun run test`, typecheck and build clean.

## Decisions (defaults, no blockers)
- D1 — Rule parsing: a line starting with `- ` (or `* `) starts a rule; following non-bullet lines join that rule. Text before the first bullet is its own rule. Blank lines dropped. Pure helpers `promptRules(text): string[]` and `rulesToPrompt(rules): string` (`rules.map(r => '- ' + r).join('\n')`) in `src/shared/projectTypes.ts`, unit tested (round-trip on this board's real prompts).
- D2 — Saving rewrites the prompt in normalized `- rule` form (trailing spaces / blank lines lost). Acceptable: prompts here are already bullets.
- D3 — Saves go through the existing `editLane` → `store.updateLane` path. `TicketGraph` emits `editLane(laneId, patch)`; BoardView wires it. No new IPC, no schema change.
- D4 — Agent file markdown is not touched. Same as the settings textarea `change`: DB only; writing the .md file stays on the settings "Save markdown" button.
- D5 — Rule field = auto-growing `<textarea rows=1>`, save on `change`. Empty rule on blur = deleted.
- D6 — Ticket list removed from the lane sidebar only (per ticket). Project-level sidebar (lane list + Transitions) unchanged.
- D7 — No drag reorder in v1.

## Implementation
1. `projectTypes.ts`: add `promptRules`, `rulesToPrompt` + tests in `projectTypes.test.ts`.
2. `TicketGraph.vue`: replace the "Tickets" block with two `<section>`s rendering rules; add/delete/edit build the new rule list and `emit('editLane', lane.id, { agentPrompt | orchestratorPrompt: rulesToPrompt(rules) })`.
3. `BoardView.vue:1052`: `@edit-lane="(id, patch) => editLane(laneById(id), patch)"` (or call `store.updateLane` directly).
4. No feature map doc on this branch (`docs/` has only `prd/`, `packaged-smoke-test.md`, `storage-seam.md`); skip docs update.
5. Run app on an isolated DB copy, edit a rule in graph view, confirm in Swimlane settings.

## Out of scope
- Editing the agent .md file contents from the graph.
- Reordering rules, rule enable/disable toggles.
- Per-ticket prompt overrides.

## Effort
Small: ~1 component edit, 2 helpers + tests, 1 wire-up.

## Branch / worktree
- Branch: `t79-project-graph-view`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t79`
- PRD file: `docs/prd/t79-graph-lane-prompt-rules.md` (on this branch)

## Open questions
None — defaults above. Override D1/D2/D6 if the rule split or ticket-list removal should differ.
