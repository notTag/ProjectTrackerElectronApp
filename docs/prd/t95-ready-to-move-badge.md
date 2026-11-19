# PRD — Ticket #95: Move rules + "ready to move" label

## Context
A ticket can finish its current lane's work and still sit there, and the board doesn't show which tickets are in that state. On top of that, the only gate on an auto-move today is the checklist. Goal:
- The user writes **Move rules** for a ticket in an input box. A ticket counts as complete only when its rules pass AND every checklist item is done. Only then does the move happen.
- When a ticket meets those conditions but nothing moved it, the card shows a label naming the lane it's ready to go to.

## Code today (verified 2026-11-17 on `917d257`)
- Auto-move: `completionMoves` (`src/shared/projectTypes.ts:1236`) moves a ticket only when it is armed (`moveOnComplete`) AND just completed: its checklist turned all-done (`isChecklistComplete`, `:1221`, which needs a non-empty list) or a ▶ Run succeeded (`alsoCompletedIds`, from `updateTicket(..., completesTicket)` at `src/stores/projects.ts:382`). If the ticket is unarmed, the completion is dropped and nothing records it.
- Target lane: `effectiveNextLaneId(ticket, lane)` (`projectTypes.ts:1194`) = ticket override, else the lane's `nextLaneId`.
- The checklist is per ticket, not per lane. A ticket that moved keeps its all-done checklist.
- Agent run badge: `agentRunBadge` (`projectTypes.ts:313`) is lane-scoped (`lastRun.laneId !== ticket.laneId` → null). Pattern to copy.
- Rule parsing already exists: `promptRules(text)` (`projectTypes.ts:694`) splits bullet, numbered, or plain lines into rules, and `rulesToPrompt` (`:707`) joins them back.
- Agent prompt: `ticketAgentPrompt` (`projectTypes.ts:641`) joins sections (lane prompt, metadata, description, version, full auto, output).
- Real usage (live DB, 2026-11-17): every agent run is `mode: 'terminal'`. Those runs never reach `succeeded`, and the agents move tickets themselves with `sqlite3`. Writes from outside the app refresh via the `data_version` poll and don't go through `completionMoves`.
- Ticket modal: the "Move to Next Lane: <lane>" checkbox at `src/views/BoardView.vue:1926-1934` (`v-if="openTicketNextLaneId"`).
- Card template: `BoardView.vue:1416-1431`. The `h3` already carries an inline `auto` badge (`.full-auto-badge`, `src/styles.css:1063`).
- Column pattern: `electron/storage/schema.ts:108` + the `:180` add-column list, plus row mapping in `electron/storage/stateRepository.ts:153-157` and the insert/update statements at `:936` / `:949`. The IPC allow-list is in `electron/ipcHandlers.ts:233`.

## Decisions
- D1. Data, on the ticket:
	- `moveRules?: string`: free text from the input box, parsed with `promptRules` (one rule per line or bullet). Empty means no rules.
	- `moveRulesPassedLaneId?: string`: the lane the rules were confirmed in. The rules count as passing only while this equals `laneId`. Moving lanes resets them without any clearing code, the same way `agentRunBadge` is scoped.
	- `readyLaneId?: string`: the lane where a completion happened that did NOT move the ticket (unarmed). Used for the label on tickets without rules.
- D2. The gate: `moveGatePasses(ticket)` = checklist passes AND rules pass.
	- Checklist passes = every item done. An empty checklist passes only when the ticket has rules, so a ticket with no checklist and no rules keeps today's behavior (only a ▶ Run success completes it).
	- Rules pass = no rules, OR `moveRulesPassedLaneId === laneId`.
- D3. `completionMoves`: a ticket is "just completed" when `moveGatePasses` goes from false to true between the previous board and the next, or when a ▶ Run succeeds while the gate passes. Armed → move (as today), and the move clears `moveRulesPassedLaneId`. Unarmed → stamp `readyLaneId = laneId`. When the gate goes back to failing, clear `readyLaneId`.
- D4. Who confirms the rules:
	- The user: a "Move rules pass" checkbox under the input box (sets or clears `moveRulesPassedLaneId = laneId`). Ticking it can be the edit that completes the ticket (D3).
	- Agents: when `moveRules` is set, `ticketAgentPrompt` adds a section that lists the rules, says "Move this ticket only when every rule below and every checklist item pass", and gives the confirm write `UPDATE tickets SET move_rules_passed_lane_id = lane_id WHERE id = '<id>'`.
- D5. Ticket modal UI: under the "Move to Next Lane" checkbox, with the same `v-if`, a `Move rules` textarea (placeholder "One rule per line, e.g. PR merged; no open questions") that autosaves like the other modal fields, plus the D4 checkbox. The checkbox shows only when the rules aren't empty.
- D6. The label: `isReadyToMove(ticket, board): string | undefined` returns the target lane id when:
	- the target resolves to another lane still on the board (same check as `willMove`, `TicketGraph.vue:34`), AND
	- with rules: `moveGatePasses(ticket)`. The rule pass is lane-scoped, so it can't go stale after a move, and agent writes from outside the app show up after the poll.
	- without rules: `readyLaneId === laneId`. The checklist alone would go stale after a move.
- D7. Card UI: an inline badge after the `auto` badge, reading `ready → <Next lane name>`. It reuses the `.full-auto-badge` shape in a success color. Title: "Move rules and checklist pass; ready to move to <lane>". It always shows, with no Display toggle.
- D8. Scope: per-ticket rules only. A lane-level default (inherited like `nextLaneId`) is a follow-up.

## Requirements
- R1. `projectTypes.ts`: the three `Ticket` fields (D1), plus `moveGatePasses`, `isReadyToMove`, and `moveRulesList = promptRules(ticket.moveRules ?? '')`.
- R2. `completionMoves`: D3.
- R3. `ticketAgentPrompt`: the move rules section (D4), included only when there are rules.
- R4. Persistence: the `move_rules TEXT`, `move_rules_passed_lane_id TEXT` and `ready_lane_id TEXT` columns + add-column entries, row mapping, the update statement, and the IPC allow-list.
- R5. Ticket modal: D5. Card: D7 (`BoardView.vue` + `styles.css`).
- R6. Tests (`projectTypes.test.ts`):
	- Gate: the checklist is done but the rules haven't passed, so the ticket doesn't move. Ticking the rules then moves it.
	- The rules passed in an earlier lane don't count after a move.
	- An empty checklist with passing rules → completes.
	- No rules → today's behavior is unchanged (the existing tests still pass).
	- Unarmed → `readyLaneId` is stamped and `isReadyToMove` returns the target. No target → undefined.
	- The prompt includes the rules section only when there are rules.
	- Plus a `stateRepository` round-trip + migration of an older DB without the columns.
- R7. `feature-map.md`: the "Ticket card" section (`:291`) gets the badge, and the Ticket modal section (`:340`) gets the Move rules box + checkbox.

## Acceptance criteria
- The ticket modal shows a Move rules box under "Move to Next Lane"
- An armed ticket with rules and a completed checklist does NOT move until "Move rules pass" is ticked. Then it moves to its Next Lane
- An armed ticket without rules auto-moves exactly as today
- An unarmed ticket whose gate passes shows `ready → <Next lane>`
- A terminal agent's `sqlite3` rules-confirm write shows the label after the poll refreshes (unarmed, or armed but not moved by the app)
- Moving the ticket to another lane removes the label and resets the rules confirmation
- No label when there's no resolvable next lane
- A lane agent's prompt lists the ticket's move rules
- `bun run typecheck` + `bun run test` are green, and a real-app check passes on an isolated DB copy

## Out of scope
- Lane-level default move rules (D8)
- The app checking rules itself (e.g. reading PR state). Rules are confirmed by a person or an agent
- Clicking the badge to move the ticket, ready counts per lane, filters
- Moves triggered by writes from outside the app (`completionMoves` only runs on the app's own saves; terminal agents move tickets themselves as their prompt says)

## Branch / worktree
- Branch: `t95-when-a-ticket`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t95` (off `917d257`; PRD doc uncommitted there)
