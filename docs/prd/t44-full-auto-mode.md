# PRD: Full auto mode (#44)

## Problem
Getting one ticket from PRD to Merge Request takes an Auto Run click per lane, and you have to watch the board to know when each lane's agent is done. The lane prompts already describe the whole chain (each one tells its agent to move the ticket on). The only missing piece is starting the next agent.

## Decisions
- D1. Effective full auto = `lane.fullAuto || ticket.fullAuto`. The lane toggle covers every ticket that runs in that lane. The ticket toggle covers this ticket in every lane
- D2. The handoff checks the lane the ticket just LEFT, because that lane's agent did the work and moved it. A lane toggle means "when my agent finishes, hand off to the next lane's agent". The prompt check uses the same lane: the lane the agent runs in is the one it will leave
- D3. Two parts:
  - Prompt context (per AC): `ticketAgentPrompt` adds a full-auto section telling the agent to finish without stopping for confirmation, move the ticket as its lane prompt says, then exit. Exiting matters because a session left open keeps a terminal tab busy for nothing
  - App-side kickoff: the agent can't reliably open a terminal tab, but the app already does that through `lane:auto-run`. When a refresh shows that a full-auto ticket changed lanes, the app launches the destination lane's agent for that ticket, using the destination lane's agent, terminal and worktree settings
- D4. The chain stops when any of these is true:
  - The destination lane has an empty `agentPrompt` and an empty `agentFilePath`
  - The destination is the unassigned lane
  - The move came from this window. That falls out of the design: a UI move updates `store.state` before any refresh, so the diff never sees it
- D5. Worktree reuse. Most of this already works: `ticketBranchName` returns the ticket's existing `branchName`, and `ensureTicketWorktree` (`electron/ticketWorktree.ts:112`) returns the existing worktree when `.worktrees/t<N>/.git` exists or another linked worktree holds the branch. The gap: a destination lane with `autoRunWorktrees: false` would run the agent in the project root and lose track of the previous lane's work. Rule: `useWorktrees = lane.autoRunWorktrees !== false || Boolean(ticket.worktreePath)`
- D6. No dedupe set. `refresh()` runs inside the `saveQueue` chain, so refreshes run one at a time. If the previous snapshot is taken inside the queued callback (not before it is queued), each move shows up in exactly one diff. A set keyed `ticketId:laneId` would also wrongly block a ticket that comes back to a lane later

## Code facts (verified 2026-11-08 on `ebdfcd5`)
- `confirmAutoRunLane` lives in `src/views/BoardView.vue:386`, not in the store. It builds each launch inline from `ticketBranchName`, `ticketShellCommand`, `promptContext` (assignee name) and `ticketTabTitle`, then calls `store.autoRunLane`
- `autoRunTerminal(lane)` (`BoardView.vue:352`) falls back to `openInStore.selectedId`, then to `TERMINAL_TARGETS[0]`
- `store.autoRunLane` (`src/stores/projects.ts:357`) returns early while `autoRunning[laneId]` is set. A handoff into a lane whose launch is still in flight would be dropped without any message
- `refresh()` (`projects.ts:185`) swaps in `freshState` wholesale. It is called from `App.vue` `refreshUnlessTyping` on outside-change events (a 10 s `PRAGMA data_version` poll) and on window focus
- `confirmAutoRunLane` clears `worktreePath` from the prompt when worktrees are on. Keep that: the tab `cd`s into the worktree `ensureTicketWorktree` returns, which for an existing ticket is the same path

## Requirements
### R1. Types: `src/shared/projectTypes.ts`
- `SwimLane.fullAuto?: boolean` and `Ticket.fullAuto?: boolean`. Absent means off, same as the other optional fields
- `isFullAuto(ticket, lane): boolean`, a pure function for D1
- `ticketAgentPrompt`: when `isFullAuto(ticket, lane)` is true, add a section just before `output`:
  `Full auto is on. Work without stopping to ask for confirmation. When done, move the ticket to the next lane as instructed above. The next lane's agent starts automatically. Then exit.`
- When it is false, the prompt must be byte-for-byte what it is today
- `laneHasAgentWork(lane)`: `agentPrompt.trim() || agentFilePath.trim()`, for the D4 check
- Shared launch builder, moved out of `confirmAutoRunLane`: `buildAutoRunLaunch(ticket, lane, agent, context, useWorktrees) → { ticket, launch: AutoRunTicketLaunch }`. `confirmAutoRunLane` and the handoff both call it

### R2. Storage: `electron/storage/schema.ts` and `stateRepository.ts`
- `swim_lanes.full_auto INTEGER NOT NULL DEFAULT 0` and `tickets.full_auto INTEGER NOT NULL DEFAULT 0`, in both the `CREATE TABLE`s and the `ADD COLUMN` migration list (same pattern as `auto_run_worktrees`, `schema.ts:126`)
- Read them with `asBool`, write `1`/`0`, and add them to the lane and ticket upsert column lists and their `excluded.` updates

### R3. Lane toggle: lane cog modal in `BoardView.vue`
- Checkbox under "Worktree and branch per ticket" (`BoardView.vue:1006`): "Full auto: start the next lane's agent when this lane's agent moves a ticket on"
- `@change="editLane(openLane, { fullAuto: checked })"`
- Hint text: the handoff waits until the next refresh, and while you're typing in a field it waits until focus leaves it

### R4. Ticket toggle and card indicator: `BoardView.vue`
- Ticket modal checkbox "Full auto", saved through the existing `updateTicket` patch path (`BoardView.vue:291`)
- The card shows a small "auto" badge when `isFullAuto(ticket, laneOfTicket(ticket))` is true

### R5. Handoff: `src/stores/projects.ts`
- Pure function in `projectTypes.ts`: `fullAutoHandoffs(previousBoard, nextBoard) → { ticket, fromLane, toLane }[]`. It returns tickets whose `laneId` changed, where `isFullAuto(ticket, fromLane)` is true, `toLane` is not unassigned, and `laneHasAgentWork(toLane)` is true. `ticket` is the version from `nextBoard`
- In `refresh()`, inside the queued `.then`: snapshot `this.state` boards, swap in `freshState`, then for each project board run `fullAutoHandoffs(old, new)`
- Group the handoffs by destination lane and make one `autoRunLane` call per lane, using `buildAutoRunLaunch` with the lane's `autoRunAgentId` and the terminal from `lane.autoRunTerminalId ?? useOpenInStore().selectedId` (move `autoRunTerminal` into a shared helper so the board and the store resolve it the same way). Set `useWorktrees` per D5
- Don't `await` the launches inside the queue. Start them after the refresh finishes, so a slow `git fetch` doesn't hold up saves
- If `autoRunning[laneId]` is already set, show `notice`: "Full auto skipped #N: <lane> Auto Run already running", so the drop is visible
- Notice on success: `Full auto: #N → <lane>`

### R6. Tests
- `projectTypes.test.ts`:
  - `isFullAuto` truth table (4 cases)
  - The prompt has the full-auto section only when on, and the off prompt is unchanged from today's snapshot
  - `fullAutoHandoffs`: moved and on (lane flag), moved and on (ticket flag), moved and off, moved to a lane with no prompt, moved to unassigned, unchanged, ticket new in `nextBoard` (no handoff)
  - `buildAutoRunLaunch`: keeps an existing `branchName`, and drops `worktreePath` from the prompt when worktrees are on
- `stateRepository` test: `full_auto` round-trips on lanes and tickets, and an older DB without the columns migrates to `false`

## Acceptance criteria (testable)
- [ ] The lane cog has a Full auto checkbox that survives a restart
- [ ] The ticket modal has a Full auto checkbox that survives a restart
- [ ] A full-auto ticket's agent prompt contains the Full auto section. Every other prompt is byte-for-byte unchanged
- [ ] An agent moves a full-auto ticket from PRD to In Development, and an In Development tab opens for it within one poll interval (~10 s) with no click
- [ ] Dragging a full-auto ticket by hand, or changing its lane in the modal, launches nothing
- [ ] A ticket moved into a lane with no prompt, or into unassigned, launches nothing
- [ ] A ticket with an existing worktree runs its next agent in that worktree, even when the destination lane has worktrees off
- [ ] `bun run test` and typecheck pass

## Risks
- A handoff waits while the user is typing (`refreshUnlessTyping`). That's acceptable, and the R3 hint says so
- Two prompted lanes that move tickets back and forth (review → dev → review) would loop. Not handled now. If it shows up, add a per-ticket hop cap in memory (about 10 per session)
- If an agent moves the ticket and keeps working, the next agent can start while it's still going. The R1 prompt says to exit right after the move to make this less likely
- Two windows open on the same DB would both see the outside write and both launch. Single-window use is the norm, so this is out of scope

## Effort
About 1 day. Types, storage and toggles are small. Most of the work is R5 (the diff, grouping, and pulling out `buildAutoRunLaunch` and the terminal helper)
