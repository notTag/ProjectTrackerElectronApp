# PRD — #124 Unique tab titles per agent run (session id suffix)

## Why a PRD
- Changes the orchestrator's close-tab protocol: handoff tab titles stop being predictable from `ticketTabTitle(ticket, lane)`, so the orchestrator needs a new source for them. Getting that wrong → handoff tabs never close, or the wrong agent gets killed.
- Touches every terminal launch path plus liveness / ⏸ Interrupted detection.

## Problem
- Orchestrator closes finished agents' tabs by exact title (`closeTab` recipes, `src/shared/projectTypes.ts:1047-1080`).
- Title = `<N>-<Lane>-<title>` (`ticketTabTitle`, `projectTypes.ts:941`) → same ticket, same lane, two runs = same title:
	- ▶ Run / ⌁ Run in / Auto Run relaunch while the old tab is still open
	- ⏯ Resume (`projects.ts:1231`) opens a second tab with the same title
	- full auto bouncing a ticket back into a lane it already had a tab in
	- two projects with same number + lane + (cut) title
- Guard today (#106): "never close when more than one open tab matches" → both tabs stay open forever.
- Ghostty tab order ≠ creation order → "close first match" kills the fresh agent (seen 2026-11-17 on #94).

## Today (verified 2026-11-22, HEAD adcf96a)
- Every agent tab launch goes through `buildAutoRunLaunch` (`projectTypes.ts:982`):
	- Auto Run / ⌁ Run in from the board — `BoardView.vue:1446`
	- full auto handoff on lane move — `projects.ts:647`
	- picks a fresh `sessionId = newAgentSessionId(agent)` (UUID v4, or `undefined` when the agent has no `sessionArgs`/`resumeArgs`, `projectTypes.ts:816`)
	- `launch.title = ticketTabTitle(ticket, lane)` — session id not used
- `autoRunLane` stores `agentRun.sessionId` + `agentRun.tabTitle = launch.title` (`projects.ts:979-992`).
- ⏯ Resume (`projects.ts:1216-1249`) reuses `run.sessionId` but recomputes `tabTitle = ticketTabTitle(ticket, ticketLane)` and stores it.
- Open in shell (`BoardView.vue:1467-1471`) — no agent, no session id.
- Liveness (`tabLivenessFor`, `projects.ts:1166-1173`) matches `run.tabTitle`; falls back to `ticketTabTitle(ticket, runLane)` for old runs. `runsToInterrupt` (`projectTypes.ts:902`) consumes that liveness → an old duplicate tab reports `alive` for a new run.
- Orchestrator ticket lines (`orchestratorPromptParts`, `projectTypes.ts:1210-1229`): `tab "<launch.title>"` + predicted handoff titles = `ticketTabTitle(ticket, lane)` for every agent lane.
- Orchestrator ticket query (`projectTypes.ts:1165`) selects `number, title, lane_id, branch_name, pull_request_url, description` — no run info.
- Ticket agent prompt (`ticketAgentPrompt`, `projectTypes.ts:676`) never mentions session id or tab title.

## Requirements
1. `ticketTabTitle(ticket, lane, sessionId?)`:
	- with session id → `<today's title> · <first 8 chars of sessionId>`
	- suffix added after the 40-code-point cut, never cut itself
	- no / empty session id → today's title, byte for byte
2. `buildAutoRunLaunch` passes its `sessionId` → `launch.title` unique per launch (covers Auto Run, ⌁ Run in, full auto handoff).
3. ⏯ Resume: title = `ticketTabTitle(ticket, ticketLane, run.sessionId)` → resumed tab carries the same suffix as the run it resumes (old tab of that run is dead/finished by definition of Resume).
4. Liveness fallback (`projects.ts:1172`) passes `run.sessionId` too. Stored `run.tabTitle` still wins.
5. Ticket agent prompt: when the launch has a session id, add
	- `Your session id is <id>; your tab is "<tab title>". Include both in every message to the orchestrator.`
	- needs the tab title in `TicketPromptContext` (or as an arg) — build it once in `buildAutoRunLaunch`, pass it to `ticketShellCommand`
6. Orchestrator:
	- ticket line: `— session <8-char id> — tab "<unique title>"` for the launched run
	- ticket query adds `json_extract(agent_run_json, '$.tabTitle') AS tab_title` → current run's tab, incl. handoff runs started after launch
	- handoff tabs: drop the predicted `ticketTabTitle` list; instead "remember every `tab_title` the query has shown for a ticket, plus any tab title an agent reports to you; close those once the ticket is done"
	- keep "more than one open tab matches → don't close" (now only hit by pre-change tabs)
7. No session id path (agents without resume support) → behaviour identical to today, incl. predicted handoff titles fallback when the run has no stored `tabTitle`.

## Acceptance criteria
- Two terminal runs of one ticket in one lane get different tab titles.
- Title ends with ` · <8-char session prefix>`; ticket title part still cut at 40 code points; `<N>-<Lane>` prefix unchanged.
- Launches without a session id keep today's title.
- Ticket agent prompt states session id + tab title and asks to include them in orchestrator messages.
- Orchestrator prompt lists each ticket's session id + unique tab title; ticket query returns `tab_title`; handoff tabs closed by observed/reported titles.
- `runsToInterrupt` gets liveness for the unique stored title → old duplicate tab no longer keeps a new run "running".
- Manual (Ghostty): two runs of one ticket+lane open → orchestrator closes the finished one, fresh one stays.

## Tests (`src/shared/projectTypes.test.ts`)
- `ticketTabTitle`: with / without session id; long title cut, suffix intact; emoji at cut boundary + suffix.
- `buildAutoRunLaunch`: `launch.title` ends with `entry.sessionId.slice(0, 8)`; agent without resume → no suffix.
- `ticketAgentPrompt`: contains session id + tab title when given, neither when not.
- orchestrator prompt: ticket line contains session prefix; ticket SQL selects `tab_title`; no predicted handoff titles when session ids exist.
- Update existing snapshot-ish assertions that hard-code tab titles.

## Decisions
- `--name <N>-<Lane>` session name unchanged: ListAgents already disambiguates duplicates by `[ref]`; #104's agent count matches on that prefix.
- No DB migration: old runs keep stored titles; only new launches get the suffix.
- 8 chars of UUID v4 (32 bits): collision odds negligible for open tabs.
- Separator ` · ` (space, middle dot, space): readable, can't appear in the `<N>-<Lane>` prefix, safe in all three AppleScript recipes (no `"` or `'`).
- Handoff tabs from the DB (`agent_run_json`) not from prediction: next lane's session id is picked at handoff, after the orchestrator prompt was written.
	- ceiling: an intermediate handoff run overwritten between two polls is never seen → its tab stays open (reported as orphan); agents reporting their tab title in messages covers most of that gap.

## Out of scope
- Warp (no tab titles, age-only liveness), headless runs.
- Retitling already-open tabs.
- Open in shell titles.

## Open questions
None

## Work location
- Branch: `t124-bug-when-two`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t124`
