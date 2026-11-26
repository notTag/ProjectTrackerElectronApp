# PRD — #150 Warp opens an empty tab; full auto handoffs open no orchestrator

Branch `t150-bug-when-opening` · Worktree `.worktrees/t150` · Base `main @ 85705b9`

## Problem
A ticket launched into Warp opens its own tab plus one extra empty tab with no command. No `AUTORUN-ORCHESTRATOR-<LANE>` tab opens. The user reads the empty tab as "the orchestrator failed to launch", but there are two separate bugs:
- A. Warp with no window open adds its default session tab next to ours. That tab is the empty one.
- B. Full auto handoffs never build an orchestrator. This happens in every terminal, not just Warp.

## Evidence (2026-11-26)
- 17:29:16Z: #145 full auto handoff In Development → Merge Request. The lane has no Auto Run terminal, so it used the default, Warp.
- `~/Library/Logs/warp.log` 17:29:17Z: 1× "received url" → "Opening window with id 7" → 2× "Creating terminal model" → 2 zsh shells (98588, 98589). One URI opened two tabs.
- Only one `warp://` URI was sent. There was no orchestrator URI at all.
- Same pattern on 2026-11-25 07:58:19Z: the first URI opened a new window with 2 terminal models; later URIs opened 1 each.

## Code today
- `electron/ipcHandlers.ts:318` `openWarpWithCommands`: queued (#116) and sweeps stale files. Per tab it writes `~/.warp/tab_configs/project_tracker_ticket_<uuid>.toml` (`warpTabConfigToml`, `electron/terminalLaunch.ts:61`), runs `openUri('warp://tab_config/<stem>')`, then deletes the file after `WARP_TAB_CONFIG_LIFETIME_MS` (60 s).
- `src/stores/projects.ts:711` `startFullAutoHandoffs` → `this.autoRunLane(projectPath, toLane.id, terminal.id, terminal.label, launches, useWorktrees)`. It passes no orchestrator argument.
- `src/views/BoardView.vue:1498-1517` `confirmAutoRunLane`: `orchestratorContextFor(terminal)` (`BoardView.vue:1257`, a view-local closure over `projectPath` and `board`) → `orchestratorAgentChoice(...)` → `buildOrchestratorLaunch(...)` → `store.autoRunLane(..., orchestrator)`.
- `buildOrchestratorLaunch` (`src/shared/projectTypes.ts:1339`) always returns a tab. Since #114, poll Active off (`∞`) means "an orchestrator with no poll loop", not "no orchestrator". BoardView never gates on it.
- #69 PRD (`docs/prd/t69-orchestrator-always-open.md`) listed handoffs as out of scope. That is where this gap comes from.

## Decisions
- D1. **Fix A, the no-window path.** When Warp has no on-screen window, launch the whole batch as one Warp Launch Configuration: `~/.warp/launch_configurations/project_tracker_launch_<uuid>.yaml`, opened with `warp://launch/<file path>`. This opens a new window containing exactly these tabs and no default tab.
- D2. **Fix A, the window path.** When Warp has a window, keep today's per-tab `tab_config` path unchanged, so tabs land in the focused window. The #116 queue covers both paths: the window check runs inside the queued step, so a second launch sees the window the first one opened.
- D3. **Window check.** Use `osascript -l JavaScript` with the ObjC bridge: `$.CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, 0)`, then count entries with `kCGWindowOwnerName === 'Warp'` and `kCGWindowLayer === 0`. It needs no Accessibility, Automation or Screen Recording permission, because it reads owner names only, never titles. Run it with the existing `run()` helper (`ipcHandlers.ts:117`, which has a timeout). If the check fails or times out, use the tab_config path (today's behaviour, at worst an empty tab).
  - [~75% confidence: a minimized or other-Space Warp window is not "on-screen", so it would get a new window. That's acceptable: the new window opens with no empty tab.]
- D4. **Launch config file lifecycle.** Same as tab configs: a unique stem, deleted ~60 s after `open` returns, and stale files with the prefix swept on the next launch. Add a `WARP_LAUNCH_CONFIG_PREFIX` constant next to `WARP_TAB_CONFIG_PREFIX`.
- D5. **YAML builder.** Add a pure `warpLaunchConfigYaml(projectPath, tabs)` in `terminalLaunch.ts`, next to `warpTabConfigToml`. Every tab gets `title`, `layout.cwd` and `layout.commands: [{ exec: "<command>; exit" }]`. Reuse `doubleQuotedString` for every value: JSON strings are valid YAML double-quoted scalars, so the injection safety matches the TOML path. Share the `; exit` suffix with `warpTabConfigToml` (extract it if the two would otherwise duplicate the comment).
- D6. **Spike first** (one manual run, Warp fully quit and then with windows closed). Check that `warp://launch/<path>` opens no extra default tab, that `title` is honoured, and that the file is read before it's deleted. [~70% confidence it's clean.] If Warp still adds a default tab, stop and report back on the ticket with the warp.log excerpt. Don't invent a workaround in the PR.
- D7. **Fix B.** `startFullAutoHandoffs` builds an orchestrator for each launch group, the same way BoardView does:
  - `orchestratorAgentChoice(toLane, { agent, model: toLane.autoRunModel }, agents)` → `buildOrchestratorLaunch(toLane, launches, choice.agent, context, choice.model)` → passed as the 7th arg to `this.autoRunLane`.
  - Context = `{ projectPath, lanes: [...board.lanes, getUnassignedLane(board)], terminalId, terminalLabel }`. Move this into a shared pure helper (e.g. `orchestratorPromptContext(board, projectPath, terminal)` in `projectTypes.ts`). Both BoardView's `orchestratorContextFor` and the store call it. The store gets `board` from its state for `projectPath`.
- D8. **No poll-Active gate.** The ticket asked for "only when poll Active", but that contradicts #114: Auto Run ▶ always opens an orchestrator, and `∞` only drops its loop. Handoffs follow the same rule as Auto Run ▶, so they always get an orchestrator. One rule for both launch paths.
- D9. Ticket list = the handoff group's `launches` (after `splitRunnable` skips). The deferred path (`deferHandoffs` when the lane is already Auto Running) is unchanged: that lane already has an orchestrator.

## Change (≈4 files + tests + docs)
- `electron/terminalLaunch.ts`: `WARP_LAUNCH_CONFIG_PREFIX`, `warpLaunchConfigYaml`, and the JXA window-count script as a constant/args builder.
- `electron/ipcHandlers.ts`: `openWarpWithCommands` → window check → either one launch config or today's per-tab loop. The sweep covers both dirs. Update the comment above it, which says "A launch configuration would always open a new window" — that is now the reason we use one.
- `src/shared/projectTypes.ts`: the shared orchestrator-context helper.
- `src/views/BoardView.vue`: `orchestratorContextFor` → delegates to the helper (or is replaced by it).
- `src/stores/projects.ts`: `startFullAutoHandoffs` builds and passes the orchestrator (D7).
- `feature-map.md`:
  - The Warp bullet (~l.523) gets the window/no-window split.
  - The orchestrator line (~l.529) says "unless poll Active is off". That's stale since #114, so correct it to say the orchestrator always opens and `∞` means no loop.
  - Add that full auto handoffs open the destination lane's orchestrator.

## Acceptance criteria
- AC1. Warp with no window open: an Auto Run of 1 ticket opens one new window with exactly 2 tabs (the ticket and `AUTORUN-ORCHESTRATOR-<LANE>`), and no empty tab.
- AC2. Warp with a window open: tabs are added to that window as today, with no new window and no empty tab.
- AC3. A full auto handoff opens the ticket tab plus the destination lane's orchestrator tab, in Warp, Terminal, iTerm2 and Ghostty. That holds with poll Active on or off; off = an orchestrator with no loop (D8).
- AC4. Two lanes started back to back in Warp each still get their own tabs (#116), including when the first one opens the window.
- AC5. Launch config files and tab config files are both deleted ~60 s after launch and swept when stale.
- AC6. Tests:
  - `terminalLaunch.test.ts`: `warpLaunchConfigYaml` puts all tabs in one window, adds the `; exit` suffix, and quotes hostile titles/commands (`"`, `\`, newline, `$(...)`).
  - Store test: a handoff passes an orchestrator whose title is `orchestratorTabTitle(toLane)` and whose prompt lists the group's tickets.
  - The window/no-window branch, if `openWarpWithCommands` can be tested by injecting the window check through `dependencies` (otherwise covered by manual AC1/AC2).
- AC7. `bun run test` and typecheck pass. Manual run on an isolated DB copy (see memory `drive-app-via-cdp`) with Warp windows closed, then with one open.

## Out of scope
- Duplicate orchestrators when a handoff lands in a lane that's mid-Auto-Run. Today that path defers (D9). If a manual Auto Run starts while handoff tabs exist, the lane prompts already say "message the active one and close yourself" (t104 notes).
- Warp `startup_config` and the user's Warp settings.
- Terminal/iTerm2/Ghostty window behaviour. They already open one window per launch with no stray tab.
