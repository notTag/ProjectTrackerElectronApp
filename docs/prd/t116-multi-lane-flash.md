## Context
BUG: The screen flashes when more than one swimlane is kicked off.
- Symptom: screen flashes when Auto Run starts in 2+ lanes back to back, or full-auto handoffs launch into 2+ lanes
- Not yet reproduced. Which surface flashes (board window vs terminal windows) is unknown

## Branch / worktree
- Branch: `t116-bug-the-screen`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t116`
- PRD: `docs/prd/t116-multi-lane-flash.md` (committed on the branch)

## Findings (code read, 2026-11-20)
- Ruled out: board layout shift / remount
	- `.message-row` is `position: fixed` overlay (`src/styles.css:891`) → toasts never move the board
	- Lanes + cards keyed by id (`src/views/BoardView.vue:1607,1649,1708`) → `refresh()` swapping `this.state` patches, does not remount
- S1 Notice toast blink (confirmed in code, cosmetic)
	- `autoRunLane` sets `notice = null` at start (`src/stores/projects.ts:974`), awaits `updateBoard` + launch, sets it again (`:1010`)
	- Lane B start → lane A's toast fades out (300 ms, `styles.css:941`) → lane B's fades in → blink per lane. Lane A's result is lost
	- Full-auto queue notice (`projects.ts:640`) and completion-move notice (`:605`) swap it more
- S3 Warp launch race (confirmed in code, correctness bug)
	- `openWarpWithCommands` (`electron/ipcHandlers.ts:301-307`) writes one fixed file `project-tracker-ticket.yaml` (`electron/terminalLaunch.ts:17`) then opens `warp://launch/project-tracker-ticket`
	- Two lanes within ms → second write lands before Warp reads the first → lane A's window opens lane B's tabs (twice), lane A's tickets never launch while their cards say running
	- Each Warp launch opens a new window and activates Warp → 2+ window pops/focus switches = likely the visible "flash"
- S2 Focus ping-pong (unverified)
	- `window` `focus` → `refresh()` (`src/App.vue:24`); each launch steals focus to the terminal, so each return re-reads the DB. Harmless unless repro shows a visual change

## Fix
1. Repro first (memory drive-app-via-cdp, `docs/packaged-smoke-test.md`)
	- Isolated DB copy + throwaway project, two lanes with 1+ ticket each, Auto Run both back to back (Warp terminal), screen record
	- Note which surface flashes and whether Warp opened the right tabs per lane. Record result in the PR body
2. S3: per-launch Warp config name
	- Name `project-tracker-ticket-<short unique id>` (e.g. `randomUUID().slice(0, 8)`), write + open that name
	- Delete the file once Warp has had time to read it (e.g. `setTimeout(unlink, 30_000)`, errors ignored), so files do not pile up — keeps the reason for the old single-file design
	- Remove the ponytail race comment; `WARP_LAUNCH_CONFIG_NAME` becomes the prefix
3. S1: don't blank the toast
	- Drop `this.notice = null` at `projects.ts:974`; the success line replaces the old notice in place (the `App.vue` watch already restarts the 30 s timer on change)
	- Optional, only if repro shows lane A's message being lost matters: append instead of replace — skip unless needed
4. S2: change only if repro shows the board window itself flashing on focus; otherwise leave

## Acceptance
- Auto Run in 2+ lanes back to back: no visible flash in the board window
- Toast moves from one lane's result to the next without blanking in between
- Each lane's Warp launch opens its own tickets' tabs
- Tests
	- `ipcHandlers` test: two back-to-back Warp launches write two distinct config files and open two distinct `warp://launch/<name>` URIs, each file containing its own tabs
	- Store test: `notice` never goes `null` during a second `autoRunLane` while a first notice shows
- Run app before merge (memory run-app-before-merge)

## Out of scope
- Terminal.app / iTerm2 / Ghostty launch paths (no shared file; Ghostty adds tabs to one window by design, #53)
- Queuing toasts / multi-toast stack

## Update after merging main (2026-11-23)
- #122 replaced Warp launch configs with one Tab Config per tab under a unique stem (`warp://tab_config/<stem>`) → S3 shared-file race already gone; Fix step 2 and the `ipcHandlers` file test dropped
- Shipped instead: Warp launches queued (`warpLaunchQueue`, `electron/ipcHandlers.ts`), since the repro showed Warp dropping one of two URIs handed over at once
- `open` gets the 60 s launch timeout Ghostty's osascript has, so one stuck launch can't block the queue
- Failed Auto Run clears the previous lane's notice (it would read as this lane's result)

## Open questions
None
