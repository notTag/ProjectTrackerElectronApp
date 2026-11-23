# PRD — #120 Remove the swimlane helper text

## Problem
The lane settings panel shows grey `field-hint` captions that repeat what the ⓘ tips (#112) already say. They add clutter.

## Scope (all in `src/views/BoardView.vue`)

1. **Agent markdown file caption.** Delete the final `<span v-else class="field-hint">` ("The prompt above autosaves here… pointed at this file instead.", ~L2471-2474). Keep both status spans above it (`laneMarkdownStatus.agent.error` and `.savedMessage`).
2. **Orchestrator prompt caption.** Delete `<span v-pre class="field-hint">` ("Sent to the Auto Run orchestrator… filled in at launch.", ~L2501-2504). Keep the `openLaneMissingOrchestratorTokens` "Missing {{…}}" error span right after the `</label>`.
3. **`agentPromptTip` (~L97).** Add the one fact that only lived in caption 1. Target text:
   ```
   Instructions sent to the agent when a ticket enters this lane. Autosaves as markdown to the Agent markdown file below (default SwimlaneAgentPrompt/<lane>/). With no prompt typed, the agent is pointed at that file instead.

   No {{variables}}: tokens aren't filled in here; ticket details are added automatically.
   ```
4. **`orchestratorPromptTip`.** No change needed. It already appends `orchestratorPromptTokenHelp()` (`src/shared/projectTypes.ts:1146`), which lists `{{tickets}}`, `{{ticket_numbers}}`, `{{lanes}}`, `{{terminal}}`.

## Acceptance criteria
- Neither caption renders. The status captions (agent file error/saved, missing-token error) still render when their conditions hold.
- The Agent prompt ⓘ includes the "no prompt typed → pointed at the file" sentence.
- The Orchestrator prompt ⓘ still lists all four tokens.
- No leftover gap: the label's flex/gap layout just ends at the input/textarea. Check light and dark themes.
- `bun run test` passes and typecheck is clean.

## Testing notes
- No test or snapshot asserts the removed strings (searched outside `docs/`). `projectTypes.test.ts` covers `orchestratorPromptTokenHelp()` and is unaffected.
- Do a visual check in the running app (memory: run the app before merge, on an isolated DB copy). Open lane settings with the Agent prompt, Agent markdown file, and Orchestrator prompt fields visible.
- Also check `feature-map.md`. If it describes these captions, update it in the same PR. (Current search found no direct mention.)

## Known minor loss
Caption 2 also said "(runs on every Auto Run)". The orchestrator tip already says it is "this lane's orchestrator session, which dispatches and monitors ticket agents", which is close enough. Accepted per the ticket, no change.

## Out of scope
- The Agent Orchestrator markdown file default caption (~L2534). Possible follow-up ticket.
- The Output field caption.
- InfoTip component changes.
- Ticket modal lane fields (#115).

## Branch / worktree
- Branch: `t120-remove-the-swimlane`
- Worktree: `~/Code/Projects/ProjectTracker/electron-app/.worktrees/t120`
