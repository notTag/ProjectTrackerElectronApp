# PRD — #106 Finished agents marked ⏸ Interrupted

## Why a PRD
- Two prompt builders (ticket full-auto suffix, orchestrator) must agree on one handoff order. User lane text can currently override the close rule, so the fix needs a precedence change, not only text.

## Problem
- Tickets show ⏸ ("The agent session ended before the run finished…") after full auto moves them, even though the agent finished.
- ⏸ = `reconcileAgentRuns` (`src/stores/projects.ts:1179`) → `runsToInterrupt` (`src/shared/projectTypes.ts:900`): a terminal run still `running` in the ticket's current lane with its tab gone.
- A terminal run never records success. It leaves `running` only by the ticket changing lane (badge is lane-scoped via `runningAgentRuns`) or by its tab vanishing (→ interrupted).

## Root causes (verified against main @ 8fecf19, 2026-11-19)
1. Duplicate tab titles → wrong tab closed. **Already fixed by #99** (PR #136, merged 2026-11-19).
	- `ticketTabTitle(ticket, lane)` (`projectTypes.ts:939`) now prefixes the lane via `ticketSessionName`; every launch stores it in `agentRun.tabTitle` (`projects.ts:983`, `:1235`); liveness uses the stored title (`projects.ts:1160`).
	- Orchestrator ticket lines list the exact tab plus handoff tabs (`orchestratorPromptParts`, `projectTypes.ts:1177`).
	- Remaining work: tests only (see below). No code change.
2. Orchestrator closes the tab between the agent's "done" message and its lane move. **Still open.**
	- Idea/PRD lane orchestrator text (DB `swim_lanes.orchestrator_prompt`) says: on an agent's done message with no open questions, close its session and tab.
	- `LANE_INSTRUCTIONS_PRECEDENCE` (`projectTypes.ts:1110`) lets lane text override the Loop, "e.g. closing tabs". So any built-in close rule loses to that text.
	- `FULL_AUTO_INSTRUCTION` (`projectTypes.ts:620`) sets no order between move, footer, and message. Lane prompts like this one say "as soon as you are done, send a message" → message can precede the move.
	- Result: tab closed, ticket still in lane, run `running` → next reconcile marks it interrupted.

## Changes
1. `FULL_AUTO_INSTRUCTION` (`projectTypes.ts:620`) — add the finish order:
	- "Finish in this order: move the ticket (when allowed), print your final footer, then message the orchestrator as your very last action. Nothing comes after that message."
2. Orchestrator Loop step 4 (`renderOrchestratorPrompt`, `projectTypes.ts:1168`) — replace the close clause:
	- Close a ticket's tab only after the ticket query shows it has left the `<lane.id>` lane. Never close when more than one open tab matches the title.
	- A done message alone is not enough: re-run the ticket query first.
3. Make rule 2 non-overridable — `LANE_INSTRUCTIONS_PRECEDENCE`:
	- From: "…override the Loop above (e.g. closing tabs), but never the report-only rule."
	- To: "…override the Loop above (e.g. which tabs to close), but never the report-only rule or the rule to close a tab only after its ticket has left this lane."
4. Tab section (`tabSection`, `projectTypes.ts:1089`) — "Close a done ticket's tab…" line: add "(only once it has left this lane; skip if more than one tab matches)".
	- This is the only place a custom orchestrator override (`projectTypes.ts:1234` → `fillOrchestratorTokens`, no Loop, no precedence line) gets the guard, via its `{{terminal}}` token. An override without `{{terminal}}` has no close recipe at all, so nothing to guard.

## Decisions
- "Agent session is idle" from the ticket's AC is dropped as a close condition: the orchestrator can't verify idleness from a tab listing. "Ticket left the lane" is checkable through the existing read-only query and covers the race.
- No app-side hardening (marking a run `succeeded` on lane change). The lane-scoped badge already hides the old run once the ticket moves; YAGNI until a case shows otherwise.
- No migration. Existing ⏸ on moved tickets clears on open (`seenAt`).
- User lane text on Idea/PRD stays as is; change 3 neutralises it. Optional board tidy-up: reword to "after the ticket has moved". Not required.

## Unchanged behaviour (must hold)
- Ticket still in its lane when the tab dies (open questions, real crash, user closed tab) → ⏸ / Resume as today.
- In Development / Merge Request `kill $PPID` self-exit: unchanged (closes own tab after final summary; the move happens first).
- Headless runs: out of scope.

## Acceptance criteria
- Full-auto prompt text contains the order move → footer → message, message last.
- Orchestrator prompt (default and with lane text) contains the close-only-after-left-lane rule, and the precedence line names it as non-overridable.
- Orchestrator prompt contains the "more than one tab matches → don't close" rule.
- Agent finishes, moves ticket, messages orchestrator → orchestrator closes old tab → no ⏸ in either lane.

## Tests (`src/shared/projectTypes.test.ts`)
- Prompt builder: full-auto suffix includes the finish order; message step is last.
- Orchestrator prompt: Loop step 4 + precedence text, with and without `lane.orchestratorPrompt`; custom override with `{{terminal}}` carries the tab-section guard.
- Tab titles (regression for #99): two lanes of one ticket → different `ticketTabTitle`; `orchestratorPromptParts` handoff titles exclude the run's own title.
- `runsToInterrupt`: run in a lane the ticket has left is never returned (lane-scoped); run in current lane with tab gone and stale → returned.

## Out of scope
- Headless runs; `kill $PPID` pattern; editing user lane text in the DB.

## Open questions
None

## Work location
- Branch: `t106-bug-tickets-may` (fast-forwarded to main @ 8fecf19, includes #99)
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t106`
