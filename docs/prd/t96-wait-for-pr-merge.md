# PRD — #96 Tickets leave Merge Request before their PR is merged

## Why a PRD
- Touches persistence (new `swim_lanes` column + migration seed), shared move logic (`completionMoves`), and the lane settings modal. It also changes what triggers an auto-move in one kind of lane. The UI, storage, and move logic must agree.

## Problem
- #92 sat in Merge Request (`in-pr`) with PR #127 still open and moved itself to In Dev Env (`in-dev`) seconds later.
- `in-dev` has `closes_ticket = 1`, so the early move also set `closed_at`.

## Root cause (verified in code, 2026-11-17)
- `completionMoves` — `src/shared/projectTypes.ts:1236`. An armed ticket (`moveOnComplete`) moves to `effectiveNextLaneId(ticket, currentLane)` as soon as `isJustCompleted` is true (checklist just completed, or id in `alsoCompletedIds`).
- It never looks at the lane's kind or the ticket's `pullRequestState`.
- #92: the agent moved it to `in-pr` and ticked the last checklist items in one write → checklist complete → moved to `in-pr`'s Next Lane (`in-dev`) → disarmed.

## Callers (all go through one function)
- `withCompletionMoves` in `src/stores/projects.ts` wraps every write path:
	- `refresh()` — outside DB writes (agent `sqlite3 UPDATE`). The #92 path.
	- `writeBoard()` / `writeState()` (+ its outside-moves pass) — in-app edits, ▶ Run success (`alsoCompletedIds`).
	- `refreshPullRequest()` → `updateBoard` → same write path, so a PR sync flipping `pullRequestState` to `merged` reaches `completionMoves`.
- → One guard in `completionMoves` covers every caller.
- Full-auto handoff (`fullAutoHandoffs`) only reacts to a lane change that already happened; it never moves a ticket. Once the move is held, no handoff fires. No change needed.
- Lane `nextLaneId` only matters through `effectiveNextLaneId` inside `completionMoves`. Same guard covers it.

## Decisions
- D1 — Lane recognition: per-lane flag, not a hard-coded `in-pr`. Lane ids/names differ per board; matches the existing optional-boolean lane flags (`closesTicket`, `fullAuto`, `agentSetsVersion`; absent = off).
	- `SwimLane.waitsForPullRequestMerge?: boolean`
	- Column `swim_lanes.waits_for_pull_request_merge` (INTEGER, nullable/0 = off).
- D2 — Seeding: on for lane id `in-pr` in `createDefaultBoard`, and once in the storage migration (`electron/storage/stateRepository.ts:396`, next to the `SEEDED_CLOSING_LANE_IDS` seed). Gate it like `seedClosingLanesOnce`: bump the schema version and seed only when the stored `schema_meta.version` is below it, so a user who later unticks it keeps their choice.
- D3 — UI: checkbox in the lane settings modal beside "Closes ticket" (`src/views/BoardView.vue:2245`), label "Wait for PR merge before moving on". Same `editLane(openLane, { … })` pattern.
- D4 — No PR in a waiting lane → ticket stays put. PR state syncs once per board visit (`BoardView.vue` ~498); in the #92 race the PR existed but `pullRequestState` could still be empty. Moving on "no PR" reintroduces the bug. Manual drag still works.
- D5 — Trigger in a waiting lane is the PR merging, not the checklist:
	- Armed ticket, checklist completes (or ▶ Run succeeds), PR not `merged` → returned unchanged: still armed, no move.
	- Armed ticket, `pullRequestState` becomes `merged` (wasn't in `previousBoard`) → counts as just completed → moves to Next Lane, disarmed.
	- PR already `merged`, then checklist completes → moves right away (as today).
	- Incomplete checklist at merge time doesn't block the move. Merge is the real "done" signal here; also covers empty checklists.
- D6 — Unflagged lanes: behavior identical to today.
- D7 — `TicketGraph.vue` `willMove` (line 34) stays as is: it only asks "armed + has target", which is still true for a held ticket.

## Requirements
- R1: Add `waitsForPullRequestMerge?: boolean` to `SwimLane` (`src/shared/projectTypes.ts`, beside `closesTicket` ~257).
- R2: Storage — column, read/write mapping, migration that adds the column and seeds `in-pr` (D2).
- R3: `createDefaultBoard` sets the flag on `in-pr` (D2).
- R4: `completionMoves` (D4, D5):
	- `pullRequestJustMerged = isPullRequestSettled(ticket.pullRequestState) && !isPullRequestSettled(previous?.pullRequestState)`
	- current lane waits for merge:
		- PR not merged → return ticket unchanged
		- PR just merged → treated as just completed
	- otherwise → current logic
	- Doc comment states the no-PR rule (D4).
- R5: Lane modal checkbox (D3).

## Acceptance criteria
- AC1: Checklist completes in a waiting lane (`in-pr`) with an open PR → stays in `in-pr`, `moveOnComplete` still true.
- AC2: Same ticket after `pullRequestState` → `merged` → moves to Next Lane, disarmed.
- AC3: No PR in a waiting lane, checklist completes → stays put.
- AC4: PR already merged in a waiting lane, checklist completes → moves right away.
- AC5: Unflagged lanes unchanged; existing `completionMoves` tests pass.
- AC6: Manual drag out of `in-pr` works; full-auto handoff still fires on a manual/agent move.
- AC7: New boards and migrated boards have the flag on for `in-pr` only; checkbox toggles it; survives restart.

## Tests
- `src/shared/projectTypes.test.ts` → `completionMoves`: held while open, moves on merge, no PR, already merged, unflagged lane.
- Storage test: flag round-trips; migration seeds `in-pr` only.
- `bun run test`.

## Manual verification
- Real app on an isolated DB copy + throwaway project (CDP recipe).
	- Ticket in `in-pr`, open PR, armed → tick last checklist item → stays.
	- `UPDATE tickets SET pull_request_state = 'merged' …` via sqlite3 → after next refresh, moves to `in-dev`.

## Known limitation
- Post-merge move happens when the app learns of the merge: next board visit's PR sync, or an agent writing `pull_request_state`. A merge on GitHub while the board stays open isn't seen until the next visit. Periodic PR polling → separate ticket if needed.

## Out of scope
- Periodic PR polling.
- Reverting #92's early `closed_at` (fixed by hand).

## Open questions
None.

## Work location
- Branch: `t96-bug-tickets-leave`
- Worktree: `.worktrees/t96`
- PRD file: `docs/prd/t96-wait-for-pr-merge.md`
