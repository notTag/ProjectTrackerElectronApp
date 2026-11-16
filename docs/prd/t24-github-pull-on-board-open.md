# PRD — Ticket #24: Pull GitHub Issues on First Board Open

Branch: `t24-when-initially-landing`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t24`

## Problem

GitHub issues reach a board only when the user clicks the manual import (`pullIssues` → `store.pullGithubIssues`). Nothing refreshes on its own, so a board silently drifts behind its repo's open issues.

## Decision: push vs. pull (settled)

**One-way pull. The Project Tracker ticket wins every conflict. Nothing is written back to GitHub.**

- "Update existing issues using the tickets as source of truth" means: an issue already on the board is never overwritten by GitHub data. It does not mean PATCHing GitHub.
- Write-back needs a write-scoped token, conflict rules, and lane → issue-state mapping. That is a separate feature; file a ticket if it's wanted.
- `addGithubIssuesToBoard` (`src/shared/projectTypes.ts:595`) already behaves this way: it skips any issue whose `github:<number>` `externalId` is already on the board and never touches imported tickets. No new merge logic.

## Behavior

1. The first time a project's board (BoardView) is shown in an app session, pull that project's open GitHub issues in the background.
2. New issues (no ticket with a matching `externalId`) are created in the `github-issues` lane (`GITHUB_IMPORT_LANE_ID`), the same way the manual import does.
3. Issues already on the board are skipped. Title, description, lane, labels, and checklist stay as the user left them.
4. Runs at most once per project per app session. Switching between boards, or leaving and coming back, does not pull again. An app restart starts a new session.
5. The board renders from the DB straight away. No blocking spinner. The existing `pullingIssues` button state may show while the pull runs.
6. Projects without a `githubUrl` are skipped silently: no error banner. This differs from the manual button, which reports "no linked GitHub repository".
7. Failures (offline, 401/403/404, rate limit) show the existing `requestGithub` error message in the `store.error` banner, which can be dismissed. The board keeps working. The project still counts as synced for this session (no retry loop). The manual button stays available for a retry.
8. Success notice: show `Imported N issues` only when N > 0. A no-op auto pull stays silent so every first board open doesn't show a banner.

## Implementation notes

- **Store** (`src/stores/projects.ts`): add a module-level `const autoPulledProjects = new Set<string>()`, outside Pinia state so it isn't persisted and resets per app launch. Add `autoPullGithubIssues(projectPath)`:
  - return if the path is already in the set; otherwise add it, **before** awaiting, so overlapping calls can't double-pull
  - return quietly if the project has no `githubUrl`
  - otherwise reuse the existing `pullGithubIssues` body. The simplest form is a `{ quiet: true }` option on `pullGithubIssues` that skips the "no linked repo" error and the zero-count notice. Don't duplicate the fetch/merge code.
- **BoardView** (`src/views/BoardView.vue`): the component is reused across `:projectPath` route changes, so `onMounted` alone misses board switches. Use a `watch` with `{ immediate: true }` on `projectPath` that fires once project state is loaded:
  - `onMounted` may kick off `store.load()` on a deep link. Before that resolves, `store.projects` is empty and `githubUrl` looks missing. Gate on `store.state.snapshot.scannedAt` (watch `[projectPath, scannedAt]`) so the project isn't marked synced while its data is still unknown.
- **Main process** (`electron/main.ts:535`): no change. Reuse `project:fetch-github-issues` (open issues only, PRs filtered, 5×100 page cap).
- **Concurrency**: `updateBoard` applies the merge to the *current* state after the fetch resolves, so edits the user makes during the pull aren't lost.

## Acceptance criteria

- [ ] First open of a board with a `githubUrl` pulls issues once, in the background
- [ ] New issues land in `github-issues` and existing `externalId` matches are skipped (already covered by `addGithubIssuesToBoard` tests)
- [ ] Switching away and back, or re-routing to the same board, doesn't fetch again in the same session
- [ ] No `githubUrl` → no fetch, no error banner
- [ ] Fetch failure → existing error banner, board fully usable
- [ ] Deep-linking straight to a board (state not yet loaded) still pulls once, after load

## Tests

- Store test: `autoPullGithubIssues` called twice for the same path → `fetchProjectGithubIssues` called once. Project without a `githubUrl` → no fetch, `error` stays null. Fetch rejects → `error` set, and a second call doesn't retry.
- Existing `addGithubIssuesToBoard` tests already cover dedupe by `externalId` and leaving imported tickets untouched. Add nothing there unless that behavior changes.

## Out of scope

- Writing ticket changes back to GitHub (see the decision above)
- Periodic or background polling after the first load
- Issue comments, assignees, milestones, labels
- Closing or deleting tickets whose issue was closed or deleted on GitHub
- Updating imported tickets when the GitHub issue's title or body changes (the local ticket wins)

## Open questions

None.
