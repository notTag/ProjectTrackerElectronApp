# PRD — #182 `{{next_lane}}` token in agent + orchestrator prompts

Branch: `t182-add-next-lane` · Worktree: `.worktrees/t182`

## Problem
- Lane prompts hard-code their target lane ("update the ticket status to 'PRD'"). Rename/rewire a lane's Next Lane → prompt silently points at the old target.
- Ticket agent prompt: no tokens at all. `lane.agentPrompt` sent verbatim (`ticketAgentPrompt`, `src/shared/projectTypes.ts:687`).
- Orchestrator prompt: token system exists (`ORCHESTRATOR_PROMPT_TOKENS`, `projectTypes.ts:1183`) but has no next-lane token.

## Goal
- Lane prompt can say "move the ticket to {{next_lane}} ({{next_lane_id}})" and get the right lane, in both the ticket agent prompt and the orchestrator prompt.

## Tokens
| Token | Value |
|---|---|
| `{{next_lane}}` | Next Lane display name |
| `{{next_lane_id}}` | Next Lane id (agents need it for `UPDATE tickets SET lane_id = …`) |

- Matching is case-insensitive: `{{Next_Lane}}`, `{{NEXT_LANE}}`, `{{next_lane}}` all fill.
- No Next Lane → both render `none`.
- Next Lane = `unassigned` → name `No status` (`UNASSIGNED_LANE_NAME`, `projectTypes.ts:1639`), id `unassigned`.
- Next Lane id naming a deleted lane → name falls back to the id (no crash, still readable).

## Design

### Shared resolver (new, `projectTypes.ts`)
- `nextLaneTokenValues(nextLaneId: string | undefined, lanes: SwimLane[] | undefined): { nextLane: string; nextLaneId: string }`
  - `!nextLaneId` → `{ nextLane: 'none', nextLaneId: 'none' }`
  - lane found in `lanes` → its `name` / `id`
  - not found → `{ nextLane: nextLaneId, nextLaneId }`
- Callers pass a `lanes` list that already includes the unassigned lane (same shape `orchestratorContextFor` builds today, `boardContext.ts:89`), so `unassigned` resolves to `No status` without a special case.

### Ticket agent prompt
- `TicketPromptContext` (`projectTypes.ts:573`) gains `lanes?: SwimLane[]`.
- In `ticketAgentPrompt`, fill tokens in `lanePrompt` only, before it joins `sections`:
  - next lane id = `effectiveNextLaneId(ticket, lane)` (`projectTypes.ts:1420`) — ticket override wins, override equal to own lane falls through.
- Ticket title, description, metadata, links: never templated (they're separate sections, filled after).
- Unknown `{{…}}` left as typed.
- Fill helper: one regex pass, case-insensitive lookup — same rule as orchestrator (below). Reuse one `fillTokens(template, valueByLowercaseToken)` for both if it falls out naturally; don't force it.
- Context builders to update (add `lanes: [...board.lanes, getUnassignedLane(board)]`):
  - `promptContext` — `src/components/board/boardContext.ts:80` (TicketModal preview/copy/launch, BoardView Auto Run)
  - `promptContextFor` — `src/stores/projects.ts:806` (full-auto handoff launches); resolve the board for `projectPath` from store state
- Context without `lanes` (evals, old callers): name falls back to id per resolver rule. Eval snapshots unchanged (no shipped lane prompt uses the token).

### Orchestrator prompt
- Add to `ORCHESTRATOR_PROMPT_TOKENS`: `nextLane: '{{next_lane}}'`, `nextLaneId: '{{next_lane_id}}'`.
- Add to `ORCHESTRATOR_TOKEN_MEANINGS` (typecheck forces it): `"this lane's Next Lane name (none if unset)"`, `"this lane's Next Lane id (none if unset)"`.
- `orchestratorPromptParts` (~`projectTypes.ts:1310`): values from `nextLaneTokenValues(lane.nextLaneId, context.lanes)`. Per-lane only — per-ticket overrides don't apply.
- Not required tokens (`REQUIRED_ORCHESTRATOR_TOKENS` unchanged).
- `fillOrchestratorTokens` (`projectTypes.ts:1329`): make lookup case-insensitive — key map by lowercase token, look up `token.toLowerCase()`. Still single pass, so a ticket title containing `{{next_lane}}` inside `{{tickets}}` is not re-expanded.
- Generated default template (`renderOrchestratorPrompt`) — no change required.
- ⓘ tip picks up both tokens automatically via `orchestratorPromptTokenHelp()`.

### UI copy — `src/components/board/LaneSettingsModal.vue:55-57`
- Replace `"No {{variables}}: tokens aren't filled in here; ticket details are added automatically."` with:
  ```
  Variables:
  {{next_lane}}: the ticket's Next Lane name (none if unset)
  {{next_lane_id}}: the ticket's Next Lane id (none if unset)
  Ticket details are added automatically.
  ```
- Build it from an exported helper in `projectTypes.ts` (e.g. `agentPromptTokenHelp()`) so tip and fill share one token list.

### Unchanged
- Markdown file sync: files store the raw template; tokens filled only at launch.
- Existing lane prompts not rewritten (user edits their own).

## Out of scope
- Other agent-prompt tokens (ticket number/title etc. already come as metadata lines).
- Required-token check case-insensitivity (`orchestratorPromptMissingTokens` stays exact-match; only the two required tokens use it).

## Acceptance criteria
- AC1: Idea lane (Next Lane = PRD) prompt `move to {{next_lane}} ({{next_lane_id}})` → launched prompt contains `move to PRD (prd)`.
- AC2: Ticket with `moveToLaneId` override → tokens show the override lane.
- AC3: Override equal to ticket's own lane → lane's Next Lane used.
- AC4: Lane with no Next Lane → `none` for both tokens.
- AC5: Next Lane `unassigned` → `No status` / `unassigned`.
- AC6: `{{Next_Lane}}` and `{{next_lane}}` both filled (agent + orchestrator).
- AC7: Ticket title/description containing `{{next_lane}}` NOT expanded in agent prompt; ticket title inside `{{tickets}}` NOT expanded in orchestrator prompt.
- AC8: Orchestrator saved prompt with `{{next_lane}}` → lane's Next Lane name; `orchestratorPromptTokenHelp()` lists both new tokens (existing every-token test covers it).
- AC9: Unknown `{{foo}}` left as typed in both.
- AC10: Agent prompt ⓘ tip lists `{{next_lane}}` and `{{next_lane_id}}`; "No {{variables}}" sentence gone.
- AC11: Both context builders pass `lanes`; Auto Run, full-auto handoff, and TicketModal launch all fill the token.
- AC12: `bun run test`, typecheck, build pass. New cases in `src/shared/projectTypes.test.ts` for AC1–AC9.

## Files
- `src/shared/projectTypes.ts` — resolver, `TicketPromptContext.lanes`, `ticketAgentPrompt` fill, orchestrator tokens/meanings/parts, case-insensitive fill, agent tip helper
- `src/shared/projectTypes.test.ts` — tests
- `src/components/board/boardContext.ts` — `promptContext` adds `lanes`
- `src/stores/projects.ts` — `promptContextFor` adds `lanes`
- `src/components/board/LaneSettingsModal.vue` — tip copy

## Open questions
None
