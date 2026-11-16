# PRD — Ticket #53: Auto Run opens a new Ghostty window per launch

## Problem
Every Ghostty launch from Project Tracker opens a new window. One launch with N tickets gets N tabs in one window. But tickets usually arrive in separate launches: Full auto handoffs, deferred handoffs, `groupByLaunch` splits, and single-ticket Runs. So the user ends up with one Ghostty window per ticket instead of one window with a tab per ticket.

## Root cause (verified on `404859b`)
- Every launch path goes through one IPC: `BoardView.vue:762` (Auto Run / Run) and `startFullAutoHandoffs` (`src/stores/projects.ts:459`) → `store.autoRunLane` (`src/stores/projects.ts:673`) → `lane:auto-run` (`electron/main.ts:470`) → `COMMAND_RUNNERS.ghostty` → `openGhosttyWithCommands` (`electron/main.ts:104`).
- `ghosttyOsascriptArgs` (`electron/terminalLaunch.ts:173`) always runs `new window with configuration` for tab 1. Nothing carries a window from one call to the next.
- `run()` (`electron/main.ts:74`) throws away osascript's stdout, so the script has no way to report which window it made.
- Fix point: the Ghostty runner and its script. `lane:auto-run` and the renderer stay as they are.

## Requirements

### R1. Script reuses a window by id and returns the id (`electron/terminalLaunch.ts`)
- New signature: `ghosttyOsascriptArgs(projectPath, tabs, reuseWindowId = '')`.
- argv layout: item 1 = directory, item 2 = window id (`''` = none), then `[command, title]` pairs from item 3. Update the pair indexing to match: loop `1 .. ((count of argv) - 2) div 2`, command at `2 * i + 1`, title at `2 * i + 2`.
- Before the loop, look up the window and keep the result only if it exists:
  ```applescript
  set targetWindow to missing value
  set reuseWindowId to item 2 of argv
  if reuseWindowId is not "" then
    try
      set targetWindow to window id reuseWindowId
      get id of targetWindow -- a stale reference errors here
    on error
      set targetWindow to missing value
    end try
  end if
  ```
- In the loop: `targetWindow is missing value` → `new window with configuration` + `tab 1`. Otherwise → `new tab in targetWindow`. This replaces the current `i = 1` branch.
- The script's last statement returns `id of targetWindow`, so osascript prints it on stdout.
- Leave `LAUNCH_WITHOUT_DEFAULT_WINDOW`, `initial input`, `name override` (`«class GTno»`) and `activate` as they are.
- ID type: verified in `/Applications/Ghostty.app/Contents/Resources/Ghostty.sdef`: `window` `id` is `type="text"`, read-only, "Stable ID for this window." Pass it through as-is, with no coercion. JS stores it as a trimmed string.

### R2. Main keeps the window id and runs Ghostty launches one at a time (`electron/main.ts`)
- Add `runWithStdout(bin, args): Promise<string>`, a sibling of `run()` that resolves with `stdout.trim()`. Don't change `run()`: Terminal, iTerm2 and Warp still use it.
- Module-level state, in memory only:
  ```ts
  let ghosttyWindowId = ''
  let ghosttyLaunchQueue: Promise<unknown> = Promise.resolve()
  ```
- `openGhosttyWithCommands` adds its launch to the end of `ghosttyLaunchQueue`. The queued step runs the script with `ghosttyWindowId` and saves the id the script returns. If one launch fails, the queue must keep going. The failure still goes back to the caller (`lane:auto-run` turns it into the existing error toast).
  ```ts
  // ponytail: one global queue. Launches are rare and each takes about 1s, so serializing them costs nothing.
  const openGhosttyWithCommands = (projectPath: string, tabs: TerminalTab[]) => {
    const launch = ghosttyLaunchQueue.then(async () => {
      const args = ghosttyOsascriptArgs(projectPath, tabs, ghosttyWindowId)
      ghosttyWindowId = await runWithStdout('osascript', args)
    })
    ghosttyLaunchQueue = launch.catch(() => undefined)
    return launch
  }
  ```
- Update the `COMMAND_RUNNERS` comment. Ghostty now adds tabs to the window the app last opened. The other terminals still open a new window per launch.
- The app reuses only a window id it got back from its own script. It never touches Ghostty's front window, so the user's own windows never receive ticket tabs.

### R3. Tests (`electron/terminalLaunch.test.ts`)
- Update the existing Ghostty argv assertions (lines ~98, 121, 128, 186, 194) for the new item 2.
- New cases:
  - no id → argv item 2 is `''`
  - id given → argv item 2 is that id
  - the script contains the `window id` lookup, the `missing value` fallback to `new window with configuration`, and the `new tab in targetWindow` branch
  - the script returns `id of targetWindow`
- Queue behavior in `main.ts` gets no unit test: the module isn't importable without Electron. R4 covers it.
- `bun run typecheck` and `bun run test` pass.

### R4. Manual check (Ghostty 1.4, macOS)
- Ghostty not running → Auto Run a lane with 2 tickets. Expect one window with 2 tabs (#38/#63 behavior kept).
- With that window open, Run a single ticket. Expect it to land as a new tab in that same window.
- Turn on Full auto for a lane, move 2 tickets into it in separate refreshes. Expect both tabs in the same window.
- Close the app's window, Run again. Expect a new window. Run once more and expect a tab in that new window.
- Open a Ghostty window yourself and bring it to the front, then Run. The tab must not go into your window.
- Restart Project Tracker, then Run. Expect a new window.
- Tab titles and working directory match today's behavior.

## Acceptance criteria
- [ ] Separate Auto Run / Full auto launches into Ghostty land as tabs in the window the app opened earlier, while that window is open
- [ ] A single-ticket Run adds a tab to that window
- [ ] App window closed → the next launch opens a new window, and later launches reuse it
- [ ] Ghostty cold launch → exactly one window (no regression of #38/#63)
- [ ] The user's own Ghostty windows never receive ticket tabs
- [ ] Tab titles and initial working directory unchanged
- [ ] App restart forgets the id
- [ ] Two handoffs fired back to back end up in one window
- [ ] `terminalLaunch.test.ts` covers the new argv item and both script branches

## Out of scope
- Terminal, iTerm2, Warp (same symptom likely; separate ticket if wanted)
- Keeping the window id across app restarts
- Closing finished tabs (#47)

## Risks
- If the user closes one tab while other tabs remain, the window id is still valid. That's fine.
- Ghostty restore (`window-save-state`) recreates windows with new ids after a Ghostty restart. The old id then fails the lookup and the app opens a new window. That's the expected fallback.

## Open questions
None.

## Branch / worktree
- Branch: `t53-bug-auto-run`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t53`
