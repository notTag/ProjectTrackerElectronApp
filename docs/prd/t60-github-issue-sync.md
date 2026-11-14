# PRD — Ticket #60: Sync imported tickets during "Pull issues"

Branch: `t60-update-during-a`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t60`

## Problem
A pull (manual button or the #24 first-open auto pull) only adds new open issues. Tickets already imported never change, so an issue closed on GitHub stays on the board forever.

## Goal
On pull, reconcile imported tickets (`externalId` = `github:<n>`) with GitHub's open/closed state:
- closed as completed → move to the board's production lane
- closed for any other reason → remove from the board (unless it has local work)
- still open → untouched

## Code today (verified 2026-11-13 on `3a794ca`)
- `project:fetch-github-issues` (`electron/main.ts:641`): `state=open`, 5×100 page cap, PRs filtered, returns `{ number, title, body, htmlUrl }`
- `addGithubIssuesToBoard` (`src/shared/projectTypes.ts:1049`): adds issues whose `github:<n>` id isn't on the board
- `store.pullGithubIssues` (`src/stores/projects.ts:294`): previews merge, writes via `updateBoard` only when `added > 0`, sets notice
- Board save deletes ticket rows missing from the saved board (`electron/storage/stateRepository.ts:628`) → dropping a ticket from `board.tickets` is a real delete
- Lanes carry `closesTicket` (`projectTypes.ts:238`); this board flags `in-dev` + `in-production`. `tickets_closed_at_on_move` trigger sets `closed_at`
- `fullAutoHandoffs` fires only on moves seen in an external DB refresh → a sync move via `updateBoard` does not start a lane agent (desired)
- Existing tests: `src/shared/projectTypes.test.ts:165` (`addGithubIssuesToBoard`), `src/stores/projects.test.ts` (pull/auto pull, mocks `fetchProjectGithubIssues`)

## Decisions
- D1. `state_reason: completed` → production lane. `not_planned`, `duplicate`, `null` → remove. Title/body/labels from GitHub NOT synced (keeps #24 never-clobber rule)
- D2. Production lane = rightmost lane with `closesTicket`. None → completed tickets stay put
- D3. Closed fetch: `state=closed&since=<oldest createdAt among imported tickets on the board>`, same 5×100 cap, PRs filtered. No imported tickets → skip closed fetch (no `since` arg passed)
- D4. One IPC call: `project:fetch-github-issues(githubUrl, since?)` → `{ open: GithubIssue[], closed: GithubClosedIssue[] }`; `GithubClosedIssue = GithubIssue & { stateReason: string | null }`. Update preload, `src/env.d.ts:57`, `projectTrackerApi`
- D5. Ticket with local work (`worktreePath` or `pullRequestUrl`) closed as not-completed → kept, counted `keptWithWork`
- D6. Issue missing from both lists (deleted/transferred, or outside `since`) → untouched
- D7. Reopened issue whose ticket is in production lane → untouched
- D8. Validate `since` in the IPC handler (string, parses as a date) — trust boundary

## Requirements
- R1. `src/shared/projectTypes.ts`
	- Rename `addGithubIssuesToBoard` → `syncGithubIssuesToBoard(board, { open, closed })` → `{ board, added, moved, removed, keptWithWork }`
	- Pure, single pass over `board.tickets`; add step = existing add logic
	- `productionLane(board)` helper per D2
	- Already in production lane → not moved, not counted
	- Move sets `laneId` + `updatedAt` like a normal lane move
- R2. `electron/main.ts`
	- Extract page loop into one local fn `fetchIssuePages(stateQuery)`; call for open and (if `since`) closed
	- Map closed `state_reason` → `stateReason`
- R3. `src/stores/projects.ts` `pullGithubIssues`
	- `since` = min `createdAt` of tickets with `github:` externalId; undefined when none
	- Preview → write only when `added + moved + removed > 0`
	- Notice built from non-zero counts, e.g. `Imported 2 issues, moved 1 to In Prod Env, removed 1 closed.`; append `kept N closed with local work` when > 0
	- Quiet pull silent only when added, moved, removed all 0
	- Nothing changed, manual pull → keep a "nothing new" style notice (existing behavior for 0 added)
- R4. Tests
	- `projectTypes.test.ts`: completed → rightmost `closesTicket` lane; not_planned → removed; not_planned + `worktreePath` → kept; already in production → no move, `moved` 0; no `closesTicket` lane → stays; open issue with user edits → untouched; reopened in production → untouched
	- `projects.test.ts`: update mock to `{ open, closed }`; no write when all counts 0; notice text; `since` omitted when no imported tickets
	- `bun run test` + typecheck pass

## Acceptance criteria
- [ ] Pull (manual or auto) syncs imported tickets
- [ ] Completed → production lane
- [ ] Not planned / duplicate / no reason → removed (local-work tickets kept + reported)
- [ ] Open → untouched
- [ ] Already in production → no re-move; no changes → no DB write
- [ ] Notice reports counts; quiet pull silent only when nothing added/moved/removed
- [ ] Tests cover merge rules; `bun run test` + typecheck pass

## Out of scope
- Syncing title/body/labels from GitHub
- Closing GitHub issues from the board
- Periodic polling beyond #24 first-open pull
- Raising 500-issue cap

## Open questions
None.
