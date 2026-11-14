# PRD — Ticket #58: Opening a board bumps "Updated" time on tickets nobody edited

## Problem
- Board open runs `refreshBoardPullRequests` → `refreshPullRequest` per unsettled ticket (side effect of #21 / PR #62).
- Any new PR data (link found, Open → Merged) saves via `updateTicket`, which stamps `updatedAt = now`.
- Result: background GitHub sync shows up as "Updated <time>" in the ticket modal and in anything sorting by `updatedAt`.

## Code facts (verified at `3a794ca`, branch = `origin/main`)
- `src/stores/projects.ts:335` `refreshPullRequest`
	- in-flight guard: re-reads saved ticket, bails if `pullRequestUrl` changed meanwhile
	- `unchanged` guard: bails when url/state/mergedAt all match → no write
	- write: `this.updateTicket(projectPath, ticket.id, { pullRequestUrl, pullRequestState, pullRequestMergedAt })` (line 350)
- `src/stores/projects.ts:256` `updateTicket` always stamps `updatedAt`; its comment ("every ticket edit funnels through here") stays true — a PR sync is not an edit.
- Precedent: `markAgentRunSeen` (`projects.ts:279`) maps tickets inside `updateBoard`, no `updatedAt`. Test: `projects.test.ts:50`.
- Callers: board-load sweep `refreshBoardPullRequests`, modal refresh button. Both background syncs → both skip the stamp. Fix lives in `refreshPullRequest`, covers both.

## Requirements

### R1. Write PR fields without stamping `updatedAt`
- Replace the `updateTicket` call with:
	```ts
	const pullRequestPatch = {
	  pullRequestUrl: status.url,
	  pullRequestState: status.state,
	  pullRequestMergedAt: status.mergedAt
	}
	const applyPullRequest = (savedTicket: Ticket): Ticket =>
	  savedTicket.id === ticket.id ? { ...savedTicket, ...pullRequestPatch } : savedTicket
	await this.updateBoard(projectPath, (board) => ({ ...board, tickets: board.tickets.map(applyPullRequest) }))
	```
- Spread over the saved ticket inside the mutate callback (not the caller's `ticket`), so a concurrent edit to other fields isn't overwritten.
- Update the `// Skipped so a refresh…` comment: the stamp is now never applied; the skip just avoids a no-op save.
- Add a one-line why-comment mirroring `markAgentRunSeen`: PR sync is not a user edit.

### R2. Keep existing guards
- In-flight URL guard and `unchanged` skip unchanged.

### R3. Test — `src/stores/projects.test.ts`
- Add `fetchTicketPullRequest: vi.fn()` to the hoisted `api` mock.
- New `describe('refreshPullRequest')`:
	- seed: `store.projects = [{ path: PROJECT_PATH, githubUrl: 'https://github.com/o/r', … }]`, ticket with `pullRequestUrl`, `pullRequestState: 'open'`, `updatedAt: '2026-01-01T00:00:00.000Z'`
	- mock returns same url, `state: 'merged'`, `mergedAt` set
	- assert saved ticket has `pullRequestState === 'merged'` + `mergedAt`, and `updatedAt` equals seeded value
	- second case: mock returns identical data → `saveProjectState` not called

## Acceptance criteria
- PR state change (open → merged) saves the new PR fields.
- That ticket's `updatedAt` unchanged after refresh.
- No-change refresh writes nothing.
- `bun run test` + `bun run typecheck` clean.

## Out of scope
- `electron/storage/stateRepository.ts` row-level `updateTicket` stamp. Since #12 the renderer does hit it (`dispatchBoardWrites` → `api.updateTicket`), but it only stamps when the patch lacks `updatedAt`, and `boardWrites` always sends the ticket's own value. The test asserts the sent patch carries it.
- Repairing `updatedAt` values already bumped by past syncs (no record of the true value).

## Open questions
None.

## Branch / worktree
- Branch: `t58-bug-opening-a` (at `origin/main` `3a794ca`, no rebase needed)
- Worktree: `.worktrees/t58`
