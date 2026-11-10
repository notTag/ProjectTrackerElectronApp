# Project Tracker — Feature Map

What the app does, laid out the way you'd meet it on screen, from top to bottom. Every item comes from the current source. File references point to where each feature lives.

- [1. App-wide](#1-app-wide)
- [2. Dashboard view (`/`)](#2-dashboard-view-)
- [3. Board view (`/board/:projectPath`)](#3-board-view-boardprojectpath)
- [4. Behind the scenes](#4-behind-the-scenes)
- [5. Known quirks](#5-known-quirks)

---

## 1. App-wide

Features that are present in every view. Sources: `electron/main.ts`, `src/App.vue`, `src/main.ts`.

### 1.1 Window

- Opens at 1280×840 and can't be made smaller than 960×680.
- The native title bar is hidden. Each view draws its own themed title strip, and the macOS window buttons (close, minimize, zoom) sit inside it at (12, 17).
- Hardware acceleration is off. Some Apple Silicon GPUs scrambled the text in packaged builds.
- Clicking the Dock icon reopens the window if every window was closed. On macOS, closing all windows doesn't quit the app.
- The Dock icon and the About panel icon come from `assets/app-icon.png`.

### 1.2 Application menu

| Menu | Items |
|------|-------|
| Project Tracker | About, Services, Hide, Hide Others, Show All, Quit |
| File | Close |
| Edit | Undo, Redo, Cut, Copy, Paste, Select All |
| View | Reload, Force Reload, Toggle DevTools, Reset Zoom, Zoom In, Zoom Out, Toggle Full Screen |
| Window | Minimize, Zoom, Bring All to Front |

### 1.3 Routing

- Hash-based routing, so reloading the packaged app never shows a blank screen.
- `/` is the Dashboard and `/board/<url-encoded project path>` is a project's Board.

### 1.4 Find on page (⌘F / Ctrl+F) — `src/components/PageFind.vue`

- ⌘F opens a find bar, focuses it and selects any existing text.
- The search runs 300 ms after you stop typing and uses Chromium's built-in find-in-page through IPC.
- The bar shows a live "N of M" match count.
- Enter goes to the next match and Shift+Enter to the previous one. There are also ↑ and ↓ buttons, disabled when nothing matches.
- Escape or × closes the bar, clears the highlights and puts focus back where it was.
- The bar closes itself when you switch views.

### 1.5 Theme picker — `src/components/ThemePicker.vue`

Shown in the Dashboard title strip.

- A dropdown labeled "Theme" that shows the name of the current theme.
- Themes come from `@nick_tag_tech/themes` and are grouped under **light** and **dark** headings, each with an accent-color swatch.
- Hovering a theme previews it. Moving off the menu, clicking outside it, or closing it reverts the preview.
- Clicking a theme applies it. A ✓ marks the current theme.
- The choice is stored in `localStorage` under `project-tracker-theme`.
- macOS draws the window buttons light or dark to match the theme type, so they stay readable on dark themes.

### 1.6 Open In picker — `src/components/OpenInPicker.vue`, `src/shared/openInTargets.ts`

Shown in both title strips.

- A dropdown labeled "Open In" that shows the selected app. Clicking outside it closes it.
- Choices: **Warp** (the default), **Terminal**, **Ghostty**, **iTerm2**, **Cursor**, **Zed** and **VSCode**.
- The 4 terminals can run a ticket's command. The 3 editors only open the folder, and any command goes on the clipboard.
- The choice is stored in `localStorage` under `project-tracker-open-in`. A saved id that's no longer valid falls back to Warp.
- Every "Open" and "Run in…" button in the app uses this choice.

### 1.7 Notices and errors

Overlay toasts in the top-right corner, just below the title strip, in both views (`src/components/MessageBanners.vue`). They float over the content, so showing one never pushes the board down.

- A red **error** banner and a neutral **notice** banner, each closed with ×. Both fade in and out.
- Notices close on their own 10 seconds after they appear. A new notice restarts the 10 seconds. Errors stay until you close them.
- Banners are at most 360px wide; long text and line breaks wrap.
- Every store action reports here: scans, saves, GitHub calls, Open In, Auto Run and agent runs.

### 1.8 Picking up outside changes

`src/App.vue` and `electron/storage/stateRepository.ts`.

- The main process checks SQLite every 10 seconds (`PRAGMA data_version`) for writes from other processes, such as a second app instance or the `sqlite3` CLI, and tells the window when it finds one.
- The window also refreshes when it regains focus.
- Both refreshes are skipped while an input, textarea, select or editable element has focus, so text you're typing is never replaced.
- Focusing any field in the ticket modal triggers a refresh before you start typing.
- Refreshes wait behind any pending saves so they don't conflict with them.

### 1.9 Auto-update — `electron/autoUpdate.ts`

- Packaged builds only. On launch, electron-updater checks GitHub releases for `notTag/ProjectTrackerElectronApp`.
- An update downloads in the background and is installed when you quit. macOS shows a notification when it's ready.
- A failed check (offline, no release published) is logged and otherwise ignored, so the app still launches.

---

## 2. Dashboard view (`/`)

Source: `src/views/DashboardView.vue`, with `src/components/ProjectToolbar.vue`. State is loaded from SQLite when the view mounts.

### 2.1 Title strip

From left to right:

| Control | Behavior |
|---------|----------|
| **Project Tracker** title | Static |
| **Open In** picker | See 1.6 |
| **Theme** picker | See 1.5 |
| **Add** | Opens the native folder dialog, adds the chosen folder to the scan directories, then runs a full scan. Disabled while a scan is running |
| **Dirs** | Shows or hides the Scan directories panel (2.2) |
| **Scan** / **Scanning...** | Rescans every scan directory. Disabled while scanning or when there are no scan directories. Tooltip: "A '.git' must be present in order for the project to appear." (see 5) |

### 2.2 Scan directories panel (toggled by Dirs)

- Lists each scan directory as a code-formatted path with a **×** button.
- **×** opens a dialog, "Would you like to delete this item?", with **Cancel** and **Delete**. Escape or clicking the backdrop cancels.
- Despite the label, **Delete** only archives. Nothing is destroyed:
  - the directory leaves the scan list
  - its projects stay in SQLite with `projects.archived = 1`, along with their notes, status, priority, Hidden and Third-party marks and ticket boards
  - archived projects are hidden from every view and count, and rescans keep them
- **Add** on the same folder, or a folder that contains it, restores those projects as they were.
- Projects still covered by another scan directory are left alone. For example, a project under both `/a` and `/a/b` stays visible when only one of them is deleted.
- When the list is empty the panel shows "No scan directories selected."

### 2.3 Notices and errors

See 1.7. Dashboard notices include "Scan found N projects.", "Scan finished with N issues." and "Updated GitHub data for X."

### 2.4 Metric tiles

Eight clickable counters. Clicking a tile applies its filter, and clicking it again turns the filter off.

| Tile | Counts | Clicking it |
|------|--------|-------------|
| Total | every project | clears the status and priority filters |
| Visible | projects that aren't hidden | clears the status and priority filters |
| Active | status = active | sets the status filter to Active |
| Ongoing | status = ongoing | sets the status filter to Ongoing |
| Completed | status = completed | sets the status filter to Completed |
| High Priority | priority = high and not hidden | sets the priority filter to High |
| Third Party | third-party and not hidden | shows only third-party projects |
| Hidden | status hidden or path in the hidden list | sets the status filter to Hidden, which shows the hidden projects |

The selected tile is highlighted. Changing a filter by hand in the toolbar deselects the tile.

### 2.5 Toolbar (search, filter, sort)

From left to right:

- **Search box**: "Search projects, paths, notes". It matches the display name, name, path and notes, ignoring case.
- **All Statuses** dropdown: a checkbox for each status (Active, Ongoing, Paused, Completed, Archived, Hidden, Unknown). The button reads "Any" or "N selected" and is highlighted when a status is selected.
- **All Priorities** dropdown: checkboxes for High, Medium, Low and None, labeled the same way.
- **Sort** select: Priority (the default), Alphabetical, or Status.
  - Status order: active, ongoing, paused, completed, archived, hidden, unknown.
  - Ties are broken by display name.
- **Asc / Desc** toggle: Desc by default. It's highlighted when set to anything but the default.
- **Clear**: resets the search, status filter, priority filter and metric tile. Disabled when no filter is set.
- Clicking outside the toolbar closes both dropdowns.
- Hidden projects are left out unless Hidden is ticked in the status filter.

### 2.6 Project list

The list is a grid of cards. When a card in the right-hand column is expanded, it swaps places with the card to its left so it can span the full row.

#### Collapsed card

- **Display name**: the project's path relative to its scan directory when the project is nested (for example `apps/web`), otherwise the folder name.
- **Full path** in code formatting.
- **Action buttons**, top right:
  - **▤** opens the project's Board (section 3).
  - **⌁** opens the project in the Open In app (1.6). If the launch fails, `cd "<path>"` is copied to the clipboard and a notice says so.
- **Tags**: source (first-party or third-party), status, priority, then where present the package manager (bun, pnpm, yarn or npm), `git`, `package.json` and `readme`.
- **GitHub row**:
  - **GitHub** link to the repo in the system browser, or "No GitHub repo".
  - **Refresh GitHub** button (shows Updating… while loading). It fetches the repo's metadata, using `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token` so private repos work.
  - Once fetched, the row shows:
    - ⎇ default branch
    - **N open**, linking to `/pulls`; the count is GitHub's `open_issues_count`
    - ★ stars and ⑂ forks
    - "pushed <date>"
  - GitHub errors say what to do: private repo with no token, token rejected, rate limited, other HTTP failure.
- Clicking anywhere else on the card expands or collapses it. Escape collapses it.

#### Expanded card, Details tab

- **Status** select with the 7 statuses. Choosing Hidden adds the path to the hidden list, and choosing anything else removes it.
- **Priority** select: High, Medium, Low, None.
- **Notes** textarea. It saves when the field loses focus.
- **Third-party** checkbox: adds the path to or removes it from the third-party list.
- **Hidden** checkbox: adds the path to or removes it from the hidden list. Hiding sets the status to hidden, and un-hiding sets it to unknown.

#### Expanded card, README tab

- Reads the first `README*` file in the project folder, ignoring case. It's loaded once and kept for the session.
- States: "Loading README...", an error message, "No README found.", or the rendered file with its filename above it.
- A small built-in renderer handles headings (#, ## and ###), bullet lists, fenced code blocks, inline code, bold, italics and http(s) links. Output is sanitized with DOMPurify.

#### Empty state

When nothing matches: "No projects match the current view. Adjust filters or add another scan directory."

### 2.7 Scan issues panel

- Shown when the last scan recorded failures. Each one lists the path and the error, such as permission denied, path missing, or "Path is not a directory."

### 2.8 First-launch modal

- Shown when there are no scan directories, nothing has been scanned, and the snapshot holds at most the single seed project.
- Header "First launch", title "Choose your projects folder".
- **Path input** (placeholder `/Users/you/Code`) and a **Browse** button that opens the native folder dialog.
- **Skip** closes the modal for the session, and the seed project `sample-app` stays visible.
- **Scan Folder** / **Scanning...** scans the chosen path.
  - The modal closes on success.
  - If the scan finds no projects and has failures, an error banner shows the first failure and the modal stays open so you can try again.

---

## 3. Board view (`/board/:projectPath`)

Source: `src/views/BoardView.vue` and `src/components/TicketGraph.vue`. There is one board per project. A new board starts with lanes **Idea, PRD, In Development, In PR, In Dev, In QA, In Production**, plus a virtual **No status** column that always exists.

### 3.1 Title strip

From left to right:

| Control | Behavior |
|---------|----------|
| **Project name** title | The project's folder name, or the last part of its path |
| **← Projects** | Back to the Dashboard. Escape does the same when no modal is open |
| **Open In** picker | See 1.6 |
| **⌁ Open** | Opens the project folder in the Open In app |
| **+ Ticket** | Opens the New ticket modal (3.6) in the first lane, or No status if there are no lanes |
| **⇣ Pull issues** / **Pulling…** | Imports the repo's open GitHub issues (3.10). Disabled when the project has no GitHub URL; the tooltip explains why |
| **+ Swim lane** | Opens the New swim lane modal (3.7) |
| **⚙ Display** | Opens the Display settings modal (3.5) |

### 3.2 Notices and errors

See 1.7. Board notices include:

- "Imported N issues (M already on the board)."
- "Auto Run opened N tabs in X."
- "Agent running on #N…" and "Agent finished #N."
- "Running the agent command in X."

### 3.3 Filter bar

From left to right:

- **Filter tickets…** text box. It matches the ticket number (`#12`), title, description, labels and branch, ignoring case.
- **All swim lanes** select: limits the board to a single column.
- **Assigned to me** toggle: shows only tickets assigned to the current user.
- **Column toggles** for **No status (N)** and, once issues have been imported, **GitHub Issues (N)**. Each one shows or hides that column; N is the total number of tickets in it.
- **"X of Y"** count: visible tickets out of all tickets.
- **Clear**: appears when any filter is set and resets the text, lane and assignee filters.
- **View switch**: a two-button slider for **Graph view** and **Swimlane view** (the default). Switching closes any open ticket.

### 3.4 Swimlane view

- When the board has no lanes: "No swim lanes yet." with a **Create swim lane** button.
- Otherwise the columns are No status followed by the board's lanes in order. Hidden columns and the lane filter apply.

#### Lane column

- **Header**: lane name, count of matching tickets, and two buttons:
  - **▶ Auto Run** (3.11). Disabled when the lane has no matching tickets or a launch is already running. The tooltip names the terminal and agent.
  - **⚙** opens the Lane settings modal (3.9).
- Double-clicking the header or an empty part of the lane opens the New ticket modal for that lane.
- **Resize handle** on the right edge. Width runs from 200 to 900 px (default 260). The width is saved once when you let go, as a per-user preference.
- You can drop a ticket on any lane to move it there.

#### Ticket card

- Draggable between lanes. Clicking a card opens the Ticket modal (3.8).
- The title always shows. These fields show only when switched on in Display:
  - **#number**
  - **Description** preview
  - **Assignee** name
  - **Labels** as chips
  - **☑ done/total** checklist progress
  - **⑂ branch**

### 3.5 Display settings modal (⚙ Display)

- **Ticket card display**: a checkbox per optional card field (Ticket number, Description, Assignee, Labels, Checklist progress, Branch). All are on by default.
- **Columns**: checkboxes to show or hide No status and GitHub Issues.
- **Done** closes the modal. So do clicking the backdrop and Escape.
- These settings are per user and per board. They're kept separate from the board, which is shared.

### 3.6 New ticket modal

- **Title** input. Enter saves.
- **Status** select: No status or any lane. It defaults to the lane you started from.
- **Description** textarea, prefilled with a template:
  ```
  ## Context
  ## Acceptance criteria
  -
  ## Out of scope
  ```
  A template you didn't change is thrown away on save, so the ticket is saved with an empty description.
- **Cancel** or **Save**. Save is disabled while the title is blank.
- The ticket gets the next number on the board (highest + 1). Numbers stay fixed after that.

### 3.7 New swim lane modal

- **Name** input. Enter saves.
- **Cancel** or **Add lane**. Add lane is disabled while the name is blank.
- The new lane is added at the end.

### 3.8 Ticket modal (click a ticket)

In graph view this opens as a side panel instead of a centered modal.

**Header:** `#N · Created <date> · Updated <date time>`

**Fields** (each saves when changed or when it loses focus; every edit updates `updatedAt`):

| Field | Notes |
|-------|-------|
| Title | Text input |
| Status | No status or any lane. Changing it moves the ticket |
| Assignee | Unassigned or any user (currently only "Local") |
| Description | Textarea |
| Labels | Comma-separated. Spaces and duplicates are cleaned up. "Searchable from the filter box." |
| Branch | e.g. `feat/board-ticket-fields`. Cleared when left empty |
| Worktree | Absolute path to a worktree. Cleared when left empty |
| GitHub PR | URL input. An **Open pull request ↗** link appears only for absolute http(s) URLs |

**External Links**

- Any number of extra links per ticket (design docs, Figma, Slack threads, related issues). Stored as `external_links_json` on the ticket row.
- Type a URL and press **Add** or Enter. The link joins the list above, and the input clears and keeps focus for the next one.
- Only http(s) URLs are added. Anything else keeps its text and shows "Use an http(s) URL". Duplicates are skipped.
- Each link opens in the default browser. **×** removes it. No titles, editing in place, or reordering.
- Passed to agents as a `Links:` block in the ticket prompt, only when the ticket has links. Not shown on board cards.

**Checklist**

- The heading shows done/total.
- Each item has a checkbox to mark it done (done items are struck through) and × to remove it.
- To add an item, type it in "Add an item, then press Enter".

**Agent completion**

- **Agent** select: Claude Code (the default), Codex, Hermes, opencode, and any custom agents saved in state.
- A preview of the exact shell command, built from the lane's prompt and the ticket (see 4.4).
- **▶ Run** / **Running…** runs the agent in the background in the project folder.
  - Claude Code and Codex runs can write files but can't run shell commands.
  - Other agents follow their own CLI's permission config. opencode allows everything, shell included, unless `opencode.json` says otherwise.
  - A run can last up to 30 minutes and capture up to 10 MB of output.
  - It keeps showing as running if you leave the board and come back.
- **⌁ Run in <Open In app>**:
  - Terminals open a new window in the project folder and run the command there, so you can watch each step (and approve it, if the agent asks).
  - Editors open the folder and put the command on the clipboard.
  - The command is copied to the clipboard in both cases.

**Last agent run** (shown once the ticket has one)

- Shows the lane it ran in, a timestamp, and the full output, including stderr and the reason when the run failed.
- Only the latest run is kept.

**View on GitHub (#N)**: shown only on tickets imported from GitHub. Opens the issue in the browser.

**Actions**

- **Trash icon** (left) asks "Are you sure you want to delete ticket #N?". Delete removes it, and Cancel, Escape or a backdrop click keep it.
- **Cancel** undoes the edits made since the modal opened, then closes it.
- **Done** closes the modal and keeps edits. So do clicking the backdrop and Escape.

### 3.9 Lane settings modal (⚙ on a lane)

- **Lane name** input, for renaming.
- **Agent prompt** textarea: standing instructions for every ticket in this lane.
- **Save to Agent Markdown** button, under the prompt. Disabled while the prompt is empty or a save is running. It writes the prompt to a markdown file and links that file to the lane:
  - File field empty: creates `<project>/agent-context/<PROJECT>-<LANE>-AgentContext.md`, making the folder if it's missing. Names are sanitized: spaces and `/ \` become `-`, and `: * ? " < > |` are dropped.
  - File field set: writes to that file, creating missing parent folders. The path must end in `.md`. A relative path resolves against the project.
  - A file that's missing or blank gets the prompt as its contents. A file that already has content is never replaced: the prompt is appended to the bottom after a blank line. This applies to the generated file too, so saving twice adds the prompt twice.
  - On success the field hint reads "Saved to <path>", or "Appended to <path>". On failure it shows the error and the lane is left unchanged. Works on **No status** too.
- **Agent markdown file**: a path to a markdown guide. The prompt tells the agent to "Follow the guidance in <path>."
- **Output**: free text naming where the work goes. An existing directory is used as-is, without asking.
- **Auto Run** section:
  - **Agent** select.
  - **Terminal** select: Warp, Terminal, Ghostty or iTerm2. With no saved choice, it uses the Open In app if that's a terminal, otherwise Warp.
  - Note: Terminal needs Accessibility permission to open tabs.
- **Delete lane** moves the lane's tickets to No status; no ticket is deleted. No status can't be deleted, so its modal says "This column always exists — it holds tickets with no status." instead.
- **Done** closes the modal.

### 3.10 GitHub issue import (⇣ Pull issues)

- Fetches open issues, up to 5 pages of 100. Pull requests are skipped.
- The first import creates a **GitHub Issues** lane at the far left.
- Each issue becomes a ticket:
  - title from the issue title, description from the issue body
  - `externalId` set to `github:<n>`, and a link back to the issue
- Running it again is safe: issues already on the board are skipped, and edits to imported tickets are never overwritten.

### 3.11 Auto Run (▶ on a lane)

- Opens **one new terminal window with one tab per visible ticket** in the lane. Active filters decide which tickets count.
- Each tab `cd`s into the project and runs that ticket's agent command, then leaves an open shell behind.
- How each terminal does it:
  - **Warp**: writes `~/.warp/launch_configurations/project-tracker-ticket.yaml` and opens `warp://launch/...`.
  - **Terminal**: AppleScript `do script`. Extra tabs are opened with ⌘T through System Events, which needs Accessibility permission. The script stops with an error if no tab appears.
  - **iTerm2**: AppleScript `write text`.
  - **Ghostty**: Ghostty 1.3+ scripting (`initial input`), for one ticket or several.
- A second click on the lane does nothing until the first launch has finished.

### 3.12 Graph view

- A three-level tree: **Project** node, then **Swim lane** nodes ("Swim lane · N"), then **Ticket** nodes (#N and title), joined by curved lines.
- It uses the same visible lanes and filtered tickets as the swimlane view.
- **Details sidebar**:
  - With the project selected: the number of swim lanes, and a list of lanes with ticket counts that you can click to select.
  - With a lane selected: its ticket count and a list of tickets you can click to open, or "No tickets match the current filters."
- Clicking a ticket node or a list entry opens the Ticket modal as a side panel, and the sidebar makes room for it.

---

## 4. Behind the scenes

### 4.1 Project scanner — `electron/scanner/projectScanner.ts`

- Walks each scan directory up to 4 levels deep.
- A folder counts as a project if it contains `package.json`, `pnpm-workspace.yaml`, `bun.lock`, `bun.lockb`, `yarn.lock`, `Cargo.toml`, `go.mod`, `pyproject.toml` or `.git`. The scanner doesn't look inside a project for more projects.
- It skips dot-folders and `node_modules`, `dist`, `coverage`, `target`, `vendor`, `.next`, `.nuxt`, `.output`, `.turbo`, `.vercel`, `.cache` and `.DS_Store`.
- Hidden paths aren't scanned at all.
- For each project it detects:
  - package manager, from the lockfile
  - GitHub URL, from the `origin` remote in `.git/config`; SSH, `ssh://` and HTTPS forms are normalized
  - whether it has git, `package.json` and a README
  - last-modified time
- Errors are recorded for each path and the scan carries on.
- **Merging with saved data**: your status, priority, notes and GitHub stats are kept across rescans, and new data from the scan fills in the rest.

### 4.2 Storage — `electron/storage/`

- SQLite through the built-in `node:sqlite`, at `~/Library/Application Support/Project Tracker/project-tracker.sqlite`.
- WAL mode with a 5-second busy timeout, so other processes can read and write while the app is open.
- Tables: `users`, `projects`, `project_members`, `swim_lanes`, `tickets`, `project_paths`, `user_paths`, `user_settings`, `schema_meta`.
- Saves write only what changed: changed fields for tickets, changed rows for everything else.
- Text written as a BLOB, for example with a bare `readfile()`, is decoded as UTF-8 when read.
- When a board is read, any ticket whose lane no longer exists moves to No status, and tickets without a number get one.
- In a plain browser, without Electron, state falls back to `localStorage`. Scanning then uses `/api/project-scan`, and the desktop-only actions report "desktop APIs are unavailable".

### 4.3 Agents — `src/shared/projectTypes.ts`, `electron/agentRun.ts`

| Agent | Command | Background args | Terminal args |
|-------|---------|-----------------|---------------|
| Claude Code (default) | `claude` | `-p --permission-mode acceptEdits` | — |
| Codex | `codex` | `exec --sandbox workspace-write` | — |
| Hermes | `hermes` | `-z` | `chat -q` |
| opencode | `opencode` | `run` | `--prompt` |
| Custom | from `state.agents` | as configured | as configured |

- A saved agent with the same id as Codex, Hermes or opencode replaces it. Claude Code can't be replaced.
- Packaged apps don't get your shell PATH, so the app looks for agent CLIs in `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`.
- A missing CLI produces "X CLI (`cmd`) was not found. Install it or add it to your PATH."

### 4.4 How a ticket prompt is built

The parts below are joined in this order, and empty parts are left out:

1. The lane's agent prompt.
2. "Follow the guidance in <lane markdown file>."
3. Ticket metadata:
   - `Ticket #N: title`
   - `Status: <lane>`
   - then, where set: Assignee, Labels, Branch, Worktree, Pull request, Source URL, and the checklist as `- [x]` / `- [ ]` lines
4. The ticket description.
5. `Output: <target>`, with the standing instruction to use that location as-is or create it.

If the prompt starts with `-`, it's prefixed with "Instructions:" so the CLI doesn't read it as an option. For the terminal command, the prompt is wrapped in single quotes, so text from GitHub issues is passed as one literal argument and never runs as code.

### 4.5 Security boundaries — `electron/main.ts`, `electron/preload.cts`

- Context isolation is on, Node integration is off, and the renderer is sandboxed. The renderer can only reach the API the preload script exposes.
- Every IPC handler checks which page sent the request: the `file://` page in packaged builds, `http://127.0.0.1:5173` in development.
- Payloads are type-checked, and paths are normalized to POSIX absolute paths.
- Project-scoped actions refuse paths outside the configured scan directories: Open In, Auto Run, agent runs and README reads.
- Open In targets, Auto Run terminals and agents are looked up by id in fixed lists, so the renderer can't choose which program runs.
- Child processes get their arguments as an array, never through a shell.
- External links (http and https only) open in the system browser. All other navigation and new windows are blocked.
- `NSAppleEventsUsageDescription` is set so macOS allows the AppleScript launches.

### 4.6 Build and release — `package.json`

- `bun run dev` runs the Vite dev server and Electron together with hot reload.
- `bun run dist` builds an arm64 `.dmg` and `.zip` with electron-builder into `dist/`.
- `bun run release` builds and publishes to GitHub Releases, which is where auto-update gets new versions.
- `bun run start:prod` launches a fresh copy of the packaged app.

---

## 5. Known quirks

Things in the code worth knowing, or fixing:

- **The Scan button's tooltip is wrong.** It says a `.git` must be present, but the scanner accepts any of 9 markers (see 4.1).
- **"N open" on the Dashboard links to `/pulls`,** but the count is GitHub's `open_issues_count`, which counts issues and PRs together.
- **Deleting a ticket doesn't ask for confirmation,** and there's no undo.
- **Skip in the first-launch modal lasts only until the app reloads.** The modal comes back on the next launch until a scan succeeds or a scan directory is added.
- **Hiding then un-hiding a project resets its status to `unknown`.** Its previous status isn't restored.
- **Background agent runs can't be cancelled.** They time out after 30 minutes.
- **There's only one user ("Local").** The assignee features and per-user preferences are built for more users, but there's no screen for adding them.
- **Custom agents can only be added by editing state directly.** There's no screen for it.
- **Nothing lists archived projects.** The only way to restore them is to re-add their folder by its path.
