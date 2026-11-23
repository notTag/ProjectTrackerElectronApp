# PRD — #122 Warp agents open new windows instead of tabs

## Why a PRD
- Swaps Warp's hand-off format (YAML Launch Configuration → TOML Tab Config) and the runner's file lifecycle. Escaping gets a new target language (TOML), and the temp files become user-visible in Warp's `+` menu → cleanup is a requirement, not a nicety.

## Problem
- Every Warp launch (Auto Run, ⌁ Run in, Open in shell, Resume, full auto handoffs) opens a new Warp window.
- Wanted: new tabs in the Warp window already open; a new window only when Warp has none.

## Today (verified on `adcf96a`, 2026-11-22)
- `COMMAND_RUNNERS.warp` → `openWarpWithCommands` `electron/ipcHandlers.ts:303`
	- writes `~/.warp/launch_configurations/project-tracker-ticket.yaml` (single reused file) → `openUri('warp://launch/project-tracker-ticket')`
	- `ponytail:` comment above it `:296-297` names the single-file race
- YAML built by `warpLaunchConfigYaml` / `warpTabYaml` `electron/terminalLaunch.ts:51-73`; strings via `yamlDoubleQuoted` = `JSON.stringify` `:49`
- `WARP_LAUNCH_CONFIG_NAME` `terminalLaunch.ts:17`
- Launch config has top-level `windows:` → Warp always opens a new window. `warp://launch/...` has no "into active window" option.

## Fix: Tab Configs (verified against Warp docs 2026-11-22)
- https://docs.warp.dev/terminal/windows/tab-configs , https://docs.warp.dev/terminal/more-features/uri-scheme
- File: `~/.warp/tab_configs/<stem>.toml`, one tab per file, snake_case stem
- `warp://tab_config/<stem>` → new tab in the active window; new window only when no Warp window is open or `?new_window=true`
- `<stem>` matched case-insensitively against the file stem (not the `name` field)
- Schema used:
	- top level: `name` (required, `+` menu label), `title` (optional tab title)
	- `[[panes]]` leaf: `id` (required), `type = "terminal"` (required), `directory`, `commands` (array, run in sequence)
- Installed Warp `0.2026.11.04`; `~/.warp/tab_configs/` exists → supported

## Requirements

### R1. TOML builder replaces YAML builder (`electron/terminalLaunch.ts`)
- Delete `warpLaunchConfigYaml` / `warpTabYaml`; add `warpTabConfigToml(projectPath, tab): string` (one tab):
	```toml
	name = "Project Tracker ticket"
	title = "<tab.title>"          # only when tab.title set
	[[panes]]
	id = "main"
	type = "terminal"
	directory = "<projectPath>"
	commands = ["<tab.command>"]
	```
- Rename `yamlDoubleQuoted` → `doubleQuotedString`: `JSON.stringify(value.toWellFormed())`
	- JSON string ⊂ TOML basic string (`\"`, `\\`, `\n`, `\uXXXX` all valid TOML)
	- `.toWellFormed()` first: lone surrogate is a valid JSON escape (`\ud800`) but invalid TOML
	- check `toWellFormed` is in the TS `lib` target; if not, bump lib or replace lone surrogates with `�` by regex
- `WARP_LAUNCH_CONFIG_NAME` → `WARP_TAB_CONFIG_PREFIX = 'project_tracker_ticket_'`
- Header comment: Warp reads a Tab Config file per tab

### R2. Runner opens one Tab Config per tab (`electron/ipcHandlers.ts`)
- `openWarpWithCommands(projectPath, tabs)`:
	- dir = `<homeDirectory>/.warp/tab_configs`, `mkdirSync({ recursive: true })`
	- sweep first: delete `project_tracker_ticket_*.toml` with mtime older than 60 s (app quit before a timer fired)
	- per tab, in order:
		- stem = prefix + `randomUUID()` with `-` → `_`
		- write `<stem>.toml`
		- `await openUri('warp://tab_config/<stem>')`
		- `setTimeout(() => rmSync(file, { force: true }), 60_000)` — hand-off file, not a user config; shows in `+` menu while present
- Unique stem per tab fixes the single-file race → delete the `ponytail:` race comment
- Keep the safety comment: commands execute; safe because `ticketShellCommand` single-quote wraps ticket text
- `COMMAND_RUNNERS` comment: Warp adds tabs to the focused Warp window (Ghostty: its last window; Terminal/iTerm2: new window)
- Legacy `~/.warp/launch_configurations/project-tracker-ticket.yaml`: leave it, no migration

### R3. Tests (`electron/terminalLaunch.test.ts`)
- Port the `warpLaunchConfigYaml` cases to `warpTabConfigToml`: cwd with spaces, `AWKWARD_COMMAND`, multi-line command, hostile title round-trip, untitled tab → no `title` line
- Each quoted value `JSON.parse`s back to the input
- Lone surrogate in command → output `isWellFormed()`
- `openIn.test.ts` Warp cases unchanged and green (runner injected)
- `bun run typecheck` + `bun run test` green

### R4. Docs
- `feature-map.md:505` (**Warp** bullet) → writes a Tab Config per tab in `~/.warp/tab_configs/`, opens `warp://tab_config/...`, tabs land in the focused Warp window, files removed after ~60 s
- `build/entitlements.mac.plist:11` ("Warp is launched through Launch Services") still true; no change

### R5. Manual check (Warp, macOS, isolated DB copy — see memory `run-app-before-merge`)
- Warp not running → Auto Run lane with 2 tickets → one window, 2 tabs
- Warp window open → Run 1 ticket → new tab in that window, no new window
- Full auto: 2 handoffs back to back → both tabs in the same window
- Tab titles, cwd, agent command same as today
- Ticket text with `{{name}}` and `"quotes"` → command runs verbatim, no params modal (see Risks)
- ~60 s later `~/.warp/tab_configs/` has no `project_tracker_ticket_*` files

## Acceptance criteria
- [ ] Warp launches open as tabs in the focused Warp window when one exists
- [ ] No Warp window → one new window holding all of that launch's tabs
- [ ] Back-to-back launches don't clobber each other's commands
- [ ] Tab titles, cwd, command execution unchanged
- [ ] Temp Tab Configs removed after launch; none left in Warp's `+` menu
- [ ] Tests cover TOML escaping + title; typecheck + tests green

## Out of scope
- Targeting a specific Warp window (URI uses the focused one)
- Warp tab liveness / closing tabs (Warp still `unknown`, #47/#63)
- Warp Preview (`warppreview://`, `~/.warp-preview/`)

## Risks
- Tabs go to whichever Warp window is focused, possibly one the user opened (unlike Ghostty #53). Warp offers no window targeting; accepted
- `{{param}}` templating: docs say `{{name}}` is substituted in `directory`, `commands` and `title` for declared `[params.*]`. Undeclared `{{…}}` behavior unverified; ticket text can contain `{{…}}` (prompt variables, #112). R5 checks it. If Warp substitutes or prompts:
	- fallback: write the command to a sibling `<stem>.sh` script and set `commands = ["sh '<path>'"]` (path has no braces), delete both on the same timer
- N tabs = N URIs back to back; if Warp reorders, tab order may differ. Cosmetic
- Warp without Tab Configs → URI does nothing. Installed version supports it; no fallback
- 60 s delete: if Warp reads the file lazily after >60 s (very slow cold start), tab fails to open. Cold start is seconds; accepted, R5 covers cold start

## Open questions
None.

## Branch / worktree
- Branch: `t122-bug-new-agents`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t122`
