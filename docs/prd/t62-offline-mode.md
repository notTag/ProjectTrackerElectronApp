# PRD — Ticket #62: Offline mode

Branch: `t62-offline-mode`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t62`

## Context
The app should keep working without an internet connection. Most of it already does: boards, tickets, lanes, scans, metrics and agent launches all run against the local SQLite DB, local git and local processes. The renderer CSP (`index.html:7`) already blocks every remote origin, so no fonts, scripts or images come from the network.

What goes wrong offline is GitHub. Every GitHub call goes through one helper, and when the network is down the user gets a raw `fetch failed` error, sometimes on their own and sometimes more than once.

## Acceptance criteria
- With no network, every board, ticket, lane, scan, metrics and agent feature works exactly as it does online.
- No GitHub action shows a raw `fetch failed` / `TypeError`. The user sees one plain message: GitHub is unreachable, local work is unaffected.
- Opening a board while offline shows no error banner.
- After reconnecting, the next board open pulls GitHub issues and refreshes PR states without an app restart.
- The auto-update check stays silent when offline (it already is: `electron/autoUpdate.ts`).

## Code today (verified 2026-11-13 on `3a794ca`)
- Network calls, all in the main process:
  - `requestGithub` (`electron/main.ts:183`): the single path to `api.github.com`. It maps HTTP 401/403/404 to readable messages, but doesn't catch a `fetch` rejection (DNS or no route), so the Node `TypeError: fetch failed` reaches the renderer unchanged
  - Callers: `project:fetch-github` (Dashboard "Refresh GitHub"), `ticket:fetch-pull-request` (ticket modal and board PR refresh), `project:fetch-github-issues` (manual import and auto-pull on board open)
  - `startUpdateCheck` (`electron/autoUpdate.ts`): already logs and drops failures
  - `resolveGithubToken`: runs `gh auth token` locally, no network needed
- Renderer reactions:
  - `autoPullGithubIssues` (`src/stores/projects.ts:380`) marks the project as pulled *before* fetching, so an offline board open uses up the session's only auto-pull and also puts the error in the `store.error` banner
  - `refreshBoardPullRequests` (`src/stores/projects.ts:360`) stops on a rate limit (`message.includes('rate limit')`). Any other error, offline included, moves on to the next ticket, which sends N failing requests in a row
  - Manual actions (`fetchGithub`, `pullGithubIssues`, ticket modal PR refresh) show the error message. That's correct, only the wording is bad

## Decisions (defaults, no blockers)
- D1. "Offline mode" means graceful degradation, not a toggle. Nothing to switch on: the app works offline by default and GitHub features fail quietly or clearly. A manual "offline" switch has no use, because local features never need the network.
- D2. Offline is detected in one place, on the `fetch` rejection inside `requestGithub`. No `net.isOnline()` pre-check and no connectivity polling. The failed request is the signal, and it can't disagree with reality.
- D3. Errors are recognized by message substring, the same as the existing rate-limit check. One exported constant holds the text so the main process and the renderer match the same string.
- D4. No persistent "Offline" badge in the UI. Manual actions say so when they fail, and background ones stay quiet. Add a badge only if users miss the state.
- D5. No offline queue or write-back. The app never writes to GitHub (see t24), so there's nothing to replay.

## Requirements
- R1. Shared constant (`src/shared/projectTypes.ts`): `GITHUB_UNREACHABLE_MESSAGE = 'GitHub is unreachable. You look offline; local boards and tickets still work.'` and `isGithubUnreachableError(error: unknown): boolean` (an `Error` whose message includes the constant).
- R2. `requestGithub` (`electron/main.ts`): wrap the `fetch` call. A rejection throws `new Error(GITHUB_UNREACHABLE_MESSAGE)`. HTTP status handling stays as it is. Every caller is covered, because they all route through here.
- R3. `refreshBoardPullRequests`: stop the loop on `isGithubUnreachableError` as well as on a rate limit. Still no banner.
- R4. `autoPullGithubIssues`: when the pull fails as unreachable, remove the project from `autoPulledProjects` and clear the error. No banner, and the next board open retries. Other failures keep today's behavior (banner, no retry).
  - `pullGithubIssues` sets `this.error`. Either have it return or rethrow the error so `autoPullGithubIssues` can check it, or check `this.error` against the constant afterwards. Pick whichever diff is smaller.
- R5. Manual actions need no change: they now show the R1 message instead of `fetch failed`.
- R6. Docs: in `feature-map.md`, one line under GitHub features about the offline behavior.
- R7. Tests:
  - `projectTypes.test.ts`: `isGithubUnreachableError` is true for an IPC-wrapped message (`Error invoking remote method '…': Error: <msg>`), false for rate-limit and 404 messages, and false for non-Errors
  - Store test: an unreachable auto-pull leaves `error` null, and a second `autoPullGithubIssues` call fetches again. A 404 auto-pull still sets `error` and doesn't retry
  - Store test: `refreshBoardPullRequests` with 3 eligible tickets and an unreachable rejection calls `fetchTicketPullRequest` once
- R8. Manual check: turn Wi-Fi off and launch the packaged app (`bun run start:prod`). Open a board with a GitHub repo and confirm there's no banner. Edit and move tickets. Press Refresh GitHub and confirm the R1 message shows. Turn Wi-Fi on, reopen the board, and confirm issues and PR states refresh.

## Out of scope
- Caching GitHub responses beyond what's already saved (repo stats in the snapshot and PR state on tickets already persist, and they show offline)
- A manual offline toggle, a connectivity indicator, and automatic retry on the `online` event
- Agent CLIs (Claude Code and others) launched in a terminal. Their own network needs belong to them
- GitLab and GitHub Enterprise

## Risks
- Node's `fetch` rejects with `TypeError: fetch failed` for DNS, refused-connection and timeout errors alike. A hard server-side outage looks the same as being offline. That's acceptable, since the advice ("local work unaffected, try later") is the same either way.
- A hung connection (captive portal) may stall without rejecting. Mitigation if it shows up: `AbortSignal.timeout(10_000)` on the `fetch` in R2.

## Open questions
None. D1 (graceful degradation instead of a toggle) is the main call, and it's easy to revisit in review.
