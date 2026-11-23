# PRD — Ticket #123: Agents can't close Warp tabs after their task is done

> Since #122 Warp launches through per-tab TOML Tab Configs (`warpTabConfigToml`, `~/.warp/tab_configs`, `commands = [...]`), not the YAML launch config below. `; exit` moved there unchanged.

## Problem
- Auto Run / full auto in Warp → finished ticket agents' tabs pile up, nothing closes them
- `TERMINAL_TAB_RECIPES` (`src/shared/projectTypes.ts:1052`) has list/close recipes for Ghostty, iTerm2, Terminal only. Warp has no AppleScript dictionary, so no recipe
- `tabSection()` (`projectTypes.ts:1091`) falls back for Warp: report every agent "unknown", "tell the user to close its tab by hand"
- Warp launch: `openWarpWithCommands` (`electron/ipcHandlers.ts:303`) writes `~/.warp/launch_configurations/project-tracker-ticket.yaml` via `warpLaunchConfigYaml` (`electron/terminalLaunch.ts:62`). `exec:` types the agent command into the tab's shell → shell outlives the agent → tab stays

## Goal
In Warp, the orchestrator closes a done ticket's tab under the same rules as the other terminals, with no tab titles and no UI scripting.

## Key finding (changes the ticket's proposed lookup)
- Every Auto Run ticket agent already gets a unique `--session-id <uuid>` in argv (`buildAutoRunLaunch` → `newAgentSessionId`, `projectTypes.ts:992`; `agentSessionWords`, `:822`). Resume uses `--resume <uuid>`
- A UUID is unique across projects and lanes → no need for the ticket's `--name` + cwd match (`lsof` cwd lookup, collisions across projects). Process lookup by session id is exact
- Handoff tabs: the session id is minted at handoff time, so it is not in the orchestrator's launch prompt. Terminal runs record it on the ticket (`agent_run_json.sessionId`, `laneId`, from #63). The orchestrator already queries tickets, so it reads it there

## Decisions
- D1. Tab closes when its shell exits → every Warp tab's command becomes `<agent command>; exit`
	- `; exit`, not `&& exit`: SIGTERM exits nonzero (143), and `&&` would leave the tab open
	- not `exec <cmd>`: resume commands start with `cd … &&`, `exec` can't prefix those
	- Trade-off accepted: an agent that crashes at once takes its tab with it. The orchestrator already reports "tab gone while still in this lane" as Needs you, and the run is resumable
- D2. Every Warp tab gets `; exit`: Auto Run ticket tabs, full auto handoff tabs, manual single-ticket opens, and the orchestrator tab (user decision, 2026-11-22). The orchestrator closes its own tab only when it has no open questions; that condition lives in the orchestrator prompt's close step, not in the launcher
	- Generated orchestrator rule 5 (all terminals): print the final summary and exit only when nothing needs the user; otherwise stay running with the open questions on screen. Replaces "Leave your own tab open"
	- Live V1 (user): a tab launched without `; exit` stays open after its agent is killed → `; exit` is required on every agent launch
	- Mechanism: `warpTabConfigToml` (was `warpTabYaml`) always appends `; exit`. Other launchers don't read it → non-Warp output unchanged. No per-tab flag: every caller would set it
- D3. Close = end the agent process: `kill -TERM <pid>`. The agent exits, `; exit` runs, Warp closes the tab
- D4. Liveness = the process exists. Replaces "report every agent as unknown"
- D5. Rejected: System Events ⌘W on Warp. It only hits the front tab, steals focus, needs Accessibility, and can't target a tab by title

## Requirements
- R1. Every Warp tab exits with its agent; `TerminalTab` is unchanged
- R2. `warpTabConfigToml`: `commands` = `` `${tab.command}; exit` ``
- R3. Orchestrator `{{tickets}}` line: Warp only, append ` — session <uuid>` from the launch entry's `sessionId` (`orchestratorPromptParts`, `projectTypes.ts:1215`). Non-Warp lines unchanged (snapshots)
- R4. `tabSection` Warp recipe (new `TERMINAL_TAB_RECIPES.warp` entry, or a Warp branch; the comment at `:1051` is updated either way):
	- Session id: the launch line's `session <uuid>` for this lane's tab; `agent_run_json` → `$.sessionId` for a handoff (only when `$.laneId` is the handoff lane)
	- Running check: `pgrep -f -- '--(session-id|resume) <SESSION>'`. One pid = running, none = gone
		- the regex form keeps `pgrep` from matching the wrapper shell running it (that shell's argv holds the regex, not the plain text)
		- the orchestrator's own argv only holds `session <uuid>`, never `--session-id <uuid>`, so it never matches itself
	- Close: `kill -TERM <pid>`. Rerun the check until it shows none
	- Same rules as today: close this lane's agent only after the ticket query shows the ticket has left this lane; close handoffs only once the ticket is done; never close while open questions remain (#68); skip if more than one pid matches (#106)
- R5. The Warp prompt no longer says "close its tab by hand" or "report every agent as unknown"
- R6. The `<SESSION>` value goes through `isUuid` before reaching the prompt. A non-UUID means the line is left out (no injection into a shell recipe)

## Acceptance criteria
- [ ] In Warp, a ticket agent's tab closes once the orchestrator decides the ticket is done (same rules as Ghostty/iTerm2/Terminal)
- [ ] A tab whose agent still has open questions is not closed (#68)
- [ ] Closing never touches another project's agent with the same ticket number, or a handoff tab with the same session name (UUID match)
- [ ] The Warp orchestrator prompt has no "close its tab by hand" or "unknown"
- [ ] The orchestrator's Warp tab closes when its agent exits (its prompt exits only with no open questions)
- [ ] Non-Warp terminals unchanged (`evals/static` snapshots change only for Warp)
- [ ] Unit tests (`electron/terminalLaunch.test.ts`, `src/shared/projectTypes.test.ts`):
	- the Warp tab command ends in `; exit` for ticket and orchestrator tabs alike (D2)
	- the Warp `tabSection` has the pgrep/kill recipe and no "by hand"
	- the Warp ticket line carries `session <uuid>`; the Ghostty line does not

## Verify first in development (not checked in this PRD)
- V1. Warp closes the tab with no confirm dialog when the shell exits after `exec`. Not run live here: it would open a Warp window on the user's screen mid-run. Test with a throwaway launch config (`exec: "sleep 2; exit"`). If Warp keeps the tab, check Warp's "confirm before closing" / session-exit settings. If no setting fixes it, stop and add an open question
- V2. `kill -TERM` on Claude Code exits cleanly and `claude --resume <uuid>` still works afterwards. Claude writes its transcript as it goes, so this is expected [~85% confidence — needs a live kill + resume]
- V3. Full auto handoff runs record `sessionId` + `laneId` on `agent_run_json` for terminal mode (from #63) [~80% confidence — trace the handoff launch in `src/stores/projects.ts`]. If not, record it there; it is the handoff's only stable key
- V4. `ps` shows the agent's full argv with `--session-id <uuid>`. Verified 2026-11-23: one pid per live session (native `claude` binary, no wrapper); BSD `pgrep` skips its own ancestors, so an agent can't match itself

## Out of scope
- Closing tabs for manual (non–Auto Run) terminal opens
- Changing how Ghostty/iTerm2/Terminal are listed or closed

## Open questions
None
