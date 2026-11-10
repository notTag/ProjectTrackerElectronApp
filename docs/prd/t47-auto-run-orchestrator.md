# PRD — Ticket #47: Auto Run orchestrator agent

## Problem
Auto Run on a lane opens one terminal tab per ticket, each running its own agent. With several tickets going at once (and Full auto chaining them lane to lane, #44), nobody watches the batch as a whole: you flip through tabs to see which agent is still working, which opened a PR, and which is stuck on a question. Finished tabs stay open.

This adds one extra tab per multi-ticket Auto Run: an orchestrator agent that watches the run's tickets, reports their state, and closes tabs once their ticket is done.

## Code today (verified 2026-11-10 on `404859b`)
- `confirmAutoRunLane` (`src/views/BoardView.vue:748`) builds `launches` via `buildAutoRunLaunch` and calls `store.autoRunLane` (`src/stores/projects.ts:673`)
- `lane:auto-run` (`electron/main.ts:470`) validates the payload, resolves `COMMAND_RUNNERS[targetId]` (`main.ts:110`) and opens every tab in one `runCommands(projectPath, tabs)` call. With worktrees on, each ticket tab `cd`s into `ensureTicketWorktree`'s path
- Tab titles: `ticketTabTitle` (`src/shared/projectTypes.ts:569`) → `#<N> <title>`, capped; main re-checks with `usableTabTitle` (`main.ts:223`, max 200 chars, no control chars)
- `laneHasAgentWork` (`projectTypes.ts:619`) = lane has an agent prompt or agent file
- Terminal, iTerm2, Ghostty driven by AppleScript; Warp by a launch-config YAML (`electron/terminalLaunch.ts`)
- The app cannot close a tab. #48 (agent closes its own Ghostty tab, not merged) is the nearest prior art

## Acceptance criteria
- [ ] An Auto Run with 2+ tickets opens one extra tab in the same window. An Auto Run with 1 ticket opens no extra tab
- [ ] The extra tab is titled `AUTORUN-ORCHESTRATOR-<SWIMLANE_NAME>` (lane name as shown on the board, upper-cased, whitespace runs → `-`)
- [ ] The orchestrator watches every ticket launched in that Auto Run until each is done, including later lanes when Full auto hands it on
- [ ] It prints a status update per ticket on start and whenever something changes (poll ~60 s):
  - Is the agent still running?
  - Which PRs are open?
  - Which PRs are closed or merged?
  - Are there open questions that need the user?
- [ ] When a ticket's task is done, the orchestrator closes that ticket's tab
- [ ] When every ticket is done it prints a final summary and exits, leaving its own tab open
- [ ] `bun run test` and typecheck pass

## Decisions (defaults, no blockers)
- D1. The orchestrator is an agent, not app UI. It runs the same agent CLI the Auto Run picked, with a generated prompt. No new panel, no new polling code in the app
- D2. Launch: `lane:auto-run` takes optional `orchestrator: { command, title }` and runs it as the last tab of the same `runCommands` call, in the project root (never a worktree). Renderer sends it only when `launches.length > 1`
- D3. Prompt, built by pure `orchestratorPrompt(lane, launches, context)` in `projectTypes.ts`, gives the agent:
  - Each ticket's number, title, tab title, branch name
  - DB path + `project_path` + a read-only lookup (`lane_id`, `pull_request_url`, `branch_name`, `description`). Explicit rule: never write to the DB
  - `gh pr list --head <branch> --state all` for PR state
  - The terminal id and the matching close-tab recipe (D7)
- D4. "Agent still running" = its tab still exists (AppleScript lookup by title). Warp can't be queried → `unknown`
- D5. "Open questions" = the ticket description has a non-empty `## Open questions` section (not "None"), or its tab is gone but the ticket never left the lane
- D6. "Done" = ticket reached a lane with no agent work (`laneHasAgentWork` false) or the unassigned lane, or its PR is merged. Prompt lists the board's lanes with that flag so the agent doesn't have to infer it
- D7. Closing a tab = AppleScript close by title for Terminal, iTerm2, Ghostty. Warp: no close; the update tells the user to close it by hand
- D8. Full auto handoffs open new tabs with new titles. The orchestrator matches tabs by ticket-number prefix (`#<N> `), which `ticketTabTitle` guarantees
- D9. Command quoting reuses the existing per-ticket path (`ticketShellCommand` single-quoting) — no new shell escaping

## Requirements
- R1. `orchestratorTabTitle(lane)` + `orchestratorPrompt(lane, launches, context)` in `src/shared/projectTypes.ts`. Title stays ≤ 200 chars and control-char free so `usableTabTitle` keeps it
- R2. `confirmAutoRunLane` builds the orchestrator launch when 2+ launches; `store.autoRunLane`, preload and `env.d.ts` types pass `orchestrator` through
- R3. `lane:auto-run` validates `orchestrator` (object with string `command`, usable `title`; malformed → throw) and appends it as the last tab in both the worktree and non-worktree branches, `cd`'d to the project root
- R4. Tests:
  - Title format (spaces, case, long lane name)
  - Prompt contains every ticket, the DB query, the no-write rule, the terminal's close recipe
  - 1-ticket run sends no orchestrator
  - IPC rejects a malformed orchestrator payload

## Out of scope
- In-app status panel or notifications
- Orchestrator answering questions or moving tickets. It reports only
- Orchestrating Full auto handoffs started outside an Auto Run
- Restarting stuck or crashed agents
- Closing tabs in Warp
- Per-lane orchestrator instructions — that's #50, built on top of `orchestratorPrompt`

## Open questions
None. Defaults above; revisit D4/D7 if Warp support matters.

## Branch / worktree
- Branch: `t47-auto-run-should` (fast-forwarded to `404859b`)
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t47`
