# PRD — Ticket #57: BUG: GitHub pull banner shows on the wrong board

- Labels: bug
- Severity: high
- Bump: patch → target version 0.3.1
- Source: https://github.com/notTag/ProjectTrackerElectronApp/issues/67
- Introduced with ticket #24 (PR #56)

## Context
Opening a board with a `githubUrl` triggers a quiet auto-pull. If the user switches to another board before the fetch resolves, the result banner ("Imported N issues." or a GitHub error) appears on the second board, where nothing happened. A GitHub error for board A reads as if it belongs to board B. The manual Pull button has the same problem when the user switches boards mid-fetch.

## Repro
1. Open board A (project with a `githubUrl`) for the first time this session; the auto-pull starts
2. Before the fetch resolves, switch to board B
3. Board A's fetch resolves → banner shows on board B with no project named

## Cause (verified in code)
- `store.notice` / `store.error` are single global fields in `src/stores/projects.ts`; `pullGithubIssues` (line ~294) sets them at the end with no project attached
- `src/components/MessageBanners.vue` renders them on every route; the 30s auto-dismiss timer lives in `src/App.vue`
- `src/views/BoardView.vue` watches `projectPath` → `autoPullGithubIssues` (quiet). BoardView is reused across boards, so the banner stays up after the switch

## Decision
Name the project in the message. Do not tag notice/error with `projectPath`.
- Why: the banner is global and also carries non-board messages (scan, Auto Run, full auto, agent runs). Per-project banner state would change the store shape, MessageBanners, the App.vue timer and every other setter. Naming the project fixes the misattribution in one store function
- Revisit per-board banner state only if more per-board async messages show up

## Requirements
All in `pullGithubIssues` in `src/stores/projects.ts`. Use `project.name` (already looked up at the top of the function).

1. Success notice → `Imported N issue(s) into <name> (M already on the board).`
   - Parenthetical only when M > 0, same as today
   - Example: `Imported 1 issue into app.`
2. Fetch error (the `catch` block) → `<name>: <message>`
   - Example: `app: GitHub rate limit exceeded`
3. Save error → also prefixed with `<name>: `
   - Gotcha: a failed save does not reach the `catch` here. `updateBoard` → `save()` catches the error itself, sets `this.error`, and returns `false`; `pullGithubIssues` then does `if (!saved) return`. Prefix `this.error` in that `!saved` branch before returning
4. Missing repo (non-quiet) → `<name> has no linked GitHub repository.`
   - Here `project` may be undefined (path not in `this.projects`). Fall back to the current generic message when there is no project
5. Unchanged behavior
   - Quiet pull with 0 new issues → no notice
   - Non-quiet pull still clears `error` / `notice` before fetching
   - `githubLoading[projectPath]` still reset in `finally`

## Tests — `src/stores/projects.test.ts`
- Update `expect(store.notice).toBe('Imported 1 issue.')` (line ~354) → `'Imported 1 issue into app.'`
- Update `expect(store.error).toBe('GitHub rate limit exceeded')` (line ~383) → `'app: GitHub rate limit exceeded'`
- Update the no-repo test if it asserts the exact message (line ~358)
- Add: two projects, A and B, with different names. Start a pull for A with a fetch promise that is held open; "switch" to B (B is just another project in the store; there is no active-board state in the store to set); resolve A's fetch → notice names A, not B
  - `storeWithProject` hardcodes `name: 'app'`. Add an optional `name` param (default `'app'`) rather than a new helper
- Optional: save-failure case (`api.saveProjectState` rejects) → error prefixed with the project name

## Out of scope
- Other global notices (scan, Auto Run, full auto, agent runs, the second GitHub path at line ~787)
- `MessageBanners.vue`, the App.vue dismiss timer
- Per-board banner state / tagging messages with `projectPath`

## Acceptance criteria
- [ ] Pull result notice for project A names project A, whichever board is open when it resolves
- [ ] GitHub fetch error for project A names project A
- [ ] Save failure during pull names the project
- [ ] Quiet auto-pull with 0 new issues still shows nothing
- [ ] Manual Pull on the open board still clears old banners before fetching
- [ ] `bun run test` and typecheck pass

## Open questions
None.

## Effort
Under an hour. One function plus test updates.

## Branch / worktree
- Branch: `t57-bug-github-pull`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t57`
- PRD file: `docs/prd/t57-github-pull-banner.md` (committed on the branch)
