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
- Narrow windows: title-strip and filter-bar labels never wrap. The title strip's name gives up space first: it shrinks with an ellipsis. Below 1180px the title-strip buttons use tighter padding. The board's filter bar drops controls to a second row instead of squeezing them. (`.titlebar-title`, `.titlebar-actions`, `.board-filters` in `src/styles.css`)
- Hardware acceleration is off. Some Apple Silicon GPUs scrambled the text in packaged builds.
- Clicking the Dock icon reopens the window if every window was closed. On macOS, closing all windows doesn't quit the app.
- The Dock icon and the About panel icon come from `assets/app-icon.png`.

### 1.2 Application menu

| Menu | Items |
|------|-------|
| Project Tracker | About, Services, Hide, Hide Others, Show All, Quit |
| File | Back Up Database Now (reveals the new snapshot in Finder), Show Backups in Finder, Close |
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
- While the bar has a query, virtualized lanes mount every card so off-screen tickets match; closing the bar re-virtualizes (`src/pageFind.ts`).

### 1.5 Theme picker — `src/components/ThemePicker.vue`

Shown in the Dashboard title strip.

- A dropdown labeled "Theme" that shows the name of the current theme.
- Themes come from `@nick_tag_tech/themes` and are grouped under **light** and **dark** headings, each with an accent-color swatch.
- Hovering a theme previews it. Moving off the menu, clicking outside it, or closing it reverts the preview.
- Clicking a theme applies it. A ✓ marks the current theme.
- Only a clicked choice is saved, never a hover preview. It goes to SQLite `user_settings` key `theme` (per user), so it survives restarts, dev-server port changes and dev ↔ packaged builds. `localStorage` key `project-tracker-theme` is kept only as a first-paint cache; on boot the DB theme wins, and an existing localStorage theme is adopted into an empty DB once. Unknown ids fall back to the default. (`useThemePersistence` in `src/stores/theme.ts`)
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
- Notices close on their own 30 seconds after they appear (timer in `src/App.vue`, so switching views doesn't restart it). A new notice restarts the 30 seconds. Errors stay until you close them.
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
| **📊 Metrics** | Popover table for exactly the projects the filtered list shows (`src/components/MetricsPanel.vue`): tickets closed and PRs merged per time window, PRs open, agents running, plus a totals row. Follows every list filter (metric tiles, status, priority, search, hidden) through the shared `projectMatchesFilters` (`src/shared/projectFilters.ts`); reloads 300 ms after filters settle; a 0-match filter shows "No projects match the current filters." **↻** pulls fresh numbers. Its open state is remembered per view |
| **Scan** / **Scanning...** | Rescans every scan directory. Disabled while scanning or when there are no scan directories. Tooltip: "A '.git' must be present in order for the project to appear." (see 5) |
| Scan progress + **Cancel** | While a scan runs, shows "Scanned N folders" and the folder being read (ellipsized, full path on hover; "Scanning..." until the first update). **Cancel** stops the scan, keeps nothing and shows "Scan cancelled." |

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

See 1.7. Dashboard notices include "Scan found N projects.", "Scan finished with N issues.", "Scan cancelled." and "Updated GitHub data for X."

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

**Active** is selected when the Dashboard opens, and again each time you come back from a board, since the view remounts.

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
  - **Offline**: every local feature keeps working. An "Offline Mode" badge shows in the header bar while the network is down. Manual GitHub actions say "Offline Mode"; background pulls on board open (issues, PR states) stay silent and retry on the next board open.
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

#### Expanded card, Metrics tab

- `src/components/CardMetrics.vue`, loaded each time the card expands.
- Bar charts for **Tickets closed** and **PRs merged** per time window (plain CSS bars). Without a closing lane it says "No lane counts as closed — set one in lane settings"; without a repo or on a failed fetch it says why.
- Tiles for **PRs open** and **Agents running** ("—" when processes can't be listed), and an "Updated <time>" line.
- **Agents running** (here and in the 📊 panel) = distinct tickets with a live app-launched agent, i.e. a `claude`/`codex`/`hermes` process whose args carry the ticket session name `--name <N>-<Lane>`, attributed to the project (worktrees included) by cwd (`electron/metrics.ts`). Orchestrators, `codex app-server` daemons, manual and headless sessions don't count; agents without `--name` support (Codex, Hermes) aren't counted either.

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
  - While it runs, the same progress line and **Cancel** button as the header replace **Skip**.
  - The modal closes on success.
  - If the scan finds no projects and has failures, an error banner shows the first failure and the modal stays open so you can try again.

---

## 3. Board view (`/board/:projectPath`)

Source: `src/views/BoardView.vue` (orchestration), `src/components/board/` (titlebar, filters, lanes, modals) and `src/components/TicketGraph.vue`. There is one board per project. A new board starts with lanes **Idea, PRD, In Development, In PR, In Dev, In QA, In Production**, plus a virtual **No status** column that always exists.

### 3.1 Title strip

From left to right:

| Control | Behavior |
|---------|----------|
| **Project name** title | The project's folder name, or the last part of its path. Ellipsizes when long |
| **Open In** picker | Right of the title; its menu opens rightward. See 1.6 |
| **⌁ Open** | Right of Open In. Opens the project folder in the Open In app |
| **← Projects** | Back to the Dashboard. Escape does the same when no modal is open |
| **Workflow** picker | Shows the active workflow (a named set of swim lanes with all their settings and prompts; every board starts with **Development Workflow**; boards whose built-in workflow was stored as "Default" are renamed on startup unless the name is taken). Lists the board's workflows, the active one checked; picking one swaps the board's lanes at once. Tickets keep their lane: one whose lane the new workflow lacks shows under No status until you swap back or move it. **Create new Workflow** asks for a name (required, unique on the board), copies the current lanes under the same ids, and makes the copy active. Lane edits always belong to the active workflow. Disabled, with a tooltip, while a lane is launching or a ticket agent is running on the board. Stored in `workflows` and `projects.active_workflow_id`, shared by all members |
| **+ Ticket** | Opens the New ticket modal (3.6) in the first lane, or No status if there are no lanes |
| **⇣ Pull issues** / **Pulling…** | Imports the repo's open GitHub issues (3.10). Disabled when the project has no GitHub URL; the tooltip explains why |
| **+ Swim lane** | Opens the New swim lane modal (3.7) |
| **⚙ Settings** | Toggles the floating Settings panel (see Settings panel below). A sidebar lists **Metrics** (the Dashboard's panel (2.1) for this project only, inline), **Display** (3.5) and **UI Settings**; the selected one shows on the right. The selection lasts for the app session, never saved |

### 3.2 Notices and errors

See 1.7. Board notices include:

- "Imported N issues into X (M already on the board)." Pull results and pull errors ("X: <message>") name the project, so a pull that finishes after you switch boards isn't mistaken for the open board's.
- "Imported N issues into X, moved N to <lane>, removed N closed, kept N closed with local work." (only non-zero parts); a sync with no imports reads "X: Moved N to <lane>, …"
- "Auto Run opened N tabs in X."
- "Agent running on #N…" and "Agent finished #N."
- "Running the agent command in X."

### 3.3 Filter bar

From left to right:

- The active workflow's name (3.1 Workflow picker), as a bold label. Clicking it opens the **Workflows** modal: a scrollable list of the board's workflows (active one ✓; click another to switch, disabled while an agent or orchestrator runs) and a solid-bordered **+ Create new Workflow** tile that asks for a unique name and copies the current lanes into a new active workflow. Escape, backdrop click or Close dismiss it.
  - Below the tile, a **Swimlane Store** section (#146): lane presets saved from any board (global, sorted by name), each row showing its origin project and last update (hover for unique id, origin path, created and updated). Each row has **−** and **+**; either swaps to one ✓ that confirms (− deletes the entry, + adds the lane with all its settings and prompts to the end of the active workflow). Clicking elsewhere, Escape or blur cancels. **+** is disabled when the active workflow already has that lane id, or while an agent or orchestrator runs. An added lane keeps its id, drops a next lane the board lacks, and gets its prompts in `SwimlaneAgentPrompt/<lane>/` only where no file exists yet.
- **Filter tickets…** text box. It matches the ticket number (`#12`), title, description, labels and branch, ignoring case.
  - **⌘⇧F** (Ctrl+Shift+F) focuses the box and selects its text, from anywhere on the board. Ignored while a modal is open.
  - A theme-coloured **✕** shows inside the box while it has text. Clicking it empties only the text; the lane and assignee filters stay, and focus stays in the box. Escape leaves the box without clearing it. (`board/BoardFilters.vue`, `.filter-query::-webkit-search-cancel-button` in `styles.css`)
- **Swim lane** multi-select popover ("All swim lanes", one lane's name, or "N lanes"): check any set of lanes to show only those columns, in board order. None checked, or all checked, shows every lane. Lanes hidden by the Display toggles aren't listed, and a pick is ignored while its lane is hidden. Closes on outside click, focus leaving it, or Escape. Ids of deleted lanes are ignored. Resets when switching to another project's board.
- **Assigned to me** toggle: shows only tickets assigned to the current user.
- **Column toggles** for **No status (N)** and, once issues have been imported, **GitHub Issues (N)**. Each one shows or hides that column; N is the total number of tickets in it.
- **"X of Y"** count: visible tickets out of all tickets.
- **Clear**: appears when any filter is set (any text in the box, spaces included) and resets the text, lane and assignee filters. Column toggles aren't touched.
- The text box, Swim lane filter, Assigned to me and each column toggle can be hidden from Display → **Ticket Dashboard** (3.5). Hiding one with a filter set clears that filter. Hiding a column toggle hides only the button, not the column. With the text box hidden, ⌘⇧F does nothing.
- **View switch**: a two-button slider for **Graph view** and **Swimlane view** (the default). Switching closes any open ticket.

### 3.4 Swimlane view

- When the board has no lanes: "No swim lanes yet." with a **Create swim lane** button.
- Otherwise the columns are No status followed by the board's lanes in order. Hidden columns and the lane filter apply.
- **"+" add zone** after the last lane, one lane wide (260 px). Invisible until hovered: a bordered **+** slides in from the right, and stays 3 s after the pointer leaves (re-entering cancels the hide). Clicking it opens the New swim lane modal (3.7). Reachable by Tab (shown on focus). Opacity-only under Reduce Motion. Hidden while any lane filter is set, and inert (but keeps its space, so lanes don't jump) during a lane drag. (`.lane-add-zone` in `board/BoardLanes.vue` / `styles.css`)

#### Lane column

- **Header**: lane name, count of matching tickets, and two buttons:
  - **▶ Auto Run** (3.11). Disabled when the lane has no matching tickets or a launch is already running. The tooltip names the terminal and agent.
  - **⚙** opens the Lane settings modal (3.9).
  - Narrow lanes: the buttons and badges keep their size and stay inside the lane. The name gives up space first: it stays on one line and truncates with an ellipsis, with the full name on hover (`.lane-heading` in `styles.css`).
- Double-clicking the header or an empty part of the lane opens the New ticket modal for that lane.
- **Reordering**: drag a lane by its header to a new position, or focus the header and press Alt+← / Alt+→ to move it one slot. Escape cancels a drag. No status always stays first, and lanes can't move while any lane filter is set.
- **Resize handle** on the right edge. Width runs from 200 to 900 px (default 260). The width is saved once when you let go, as a per-user preference.
- You can drop a ticket on any lane to move it there.
- **Long lanes are virtualized**: a lane over 50 cards mounts only the cards within one screen of its viewport, with spacers for the rest (estimated height, replaced by measured heights). The header count still shows every matching ticket. A card mid-drag stays mounted. Find on page with a query mounts every card so native find sees them (`LaneCardList.vue`, `src/shared/cardWindow.ts`).
- Tickets are grouped by lane once per change (`groupTicketsByLane` in `projectTypes.ts`); cards, counts, badges and the graph all read that map. Ticket-only writes patch the one row in place, so unchanged cards don't re-render (`TicketCard.vue`).

#### Ticket card

- Draggable between lanes. Clicking a card opens the Ticket modal (3.8).
- **Select checkbox** (title "Select (run / move)"): checked cards feed Auto Run's ticket set and bulk drag. Selection is in memory only and clears when you switch project.
- **Bulk drag**: dragging a checked card moves every checked, visible ticket to the drop lane in one save, all with the same `updatedAt` (`ticketIdsToMove` in `projectTypes.ts`, `moveTickets` in `stores/projects.ts`).
  - Dragging an unchecked card moves only that card.
  - Checked tickets hidden by search, the assignee filter, a hidden lane or the lane filter don't move. Tickets already in the drop lane aren't touched.
  - Moved tickets stay checked.
  - **Stack ghost** (2+ tickets carried): the drag image is the dragged card with up to 2 offset card edges behind it (3 layers max) and an accent count badge with the carried count. The other carried cards fade and shrink in place (`.ticket-carried`) until `dragend`. The count is every checked visible ticket, including ones already in the drop lane (`carriedTicketIds` in `projectTypes.ts`, `startTicketDrag` in `board/BoardLanes.vue`). Reduce Motion drops the fade/shrink transition; the ghost and dimming stay. An unchecked card, or the only checked one, uses the browser's default drag image.
- The title always shows (a locked, checked **Title** row in Display). These fields show only when switched on in Display:
  - **#number**
  - **Description** preview
  - **Assignee** name
  - **Labels** as chips
  - **☑ done/total** checklist progress
  - **⑂ branch**
  - **⌂ worktree** folder name (full path on hover)
  - **v1.4.0** semantic version
  - **PR #N ↗** link, with a dot for the PR's state (open, draft, merged, closed). Clicking it opens the PR without opening the ticket
- **Agent run badge**: running, ✓ succeeded, failed, or ⏸ interrupted, for the last run in the ticket's current lane. A finished result clears once you open the ticket; a running one stays (`agentRunBadge` in `projectTypes.ts`).
- **auto** badge after the title when full auto is on, then a green **ready → <Next lane>** badge when the ticket is ready to move but nothing moved it (`isReadyToMove` in `projectTypes.ts`). Always shown, no Display toggle.
  - With move rules: shows while the rules are confirmed in this lane and every checklist item is done. An agent's `sqlite3` confirm shows after the poll refresh.
  - Without rules: shows when the ticket completed (3.8 Next Lane) in this lane while unarmed. Unticking an item clears it.
  - Never shown when the Next Lane doesn't resolve to another lane on the board, or after the ticket moves.

### 3.5 Display settings (⚙ Settings → Display)

- **Ticket Dashboard** (first): a checkbox per filter bar control (Ticket filter box, Swim lane filter, Assigned to me, No status toggle, GitHub Issues toggle). All on by default; unchecking hides it from the filter bar (3.3). Saved per user in `BoardPreferences.hiddenFilterControls` (`BOARD_FILTER_CONTROLS` in `projectTypes.ts`). The GitHub Issues row shows even before issues are imported.
- **Ticket Card**: first row is **Title**, checked and disabled because the title always shows (a static row, not a `TICKET_CARD_FIELDS` entry, so nothing is saved for it). Below it, a checkbox per optional card field (Ticket number, Description, Assignee, Labels, Checklist progress, Branch, Worktree, GitHub PR, Semantic version). All are on by default.
- **Swim lane settings fields**: a checkbox per Lane settings modal field (flat list, in the modal's order: Agent, then Orchestrator, then Auto Run fields). Hides it in every lane's settings; saved per user in `BoardPreferences.hiddenLaneModalFields`. Display-only: the agent still gets the value.
- **Columns**: a checkbox per column (No status first, then every lane in board order, each with its ticket count) to show or hide it. New lanes start shown.
- Toggles apply live; the section has no Done button.
- These settings are per user and per board. They're kept separate from the board, which is shared.

#### Settings panel (⚙ Settings) — `src/components/UiSettingsPanel.vue`, `src/uiDemo.ts`

- **⚙ Settings** opens a floating panel, centered every time. Left sidebar (icon + label, flat list rows like macOS System Settings: hover tints, selected one is an accent bar) picks 👁 Display (default, top) / 📊 Metrics / 🎨 UI Settings; Metrics shows its table directly, no toggle button, and fits the pane with no sideways scroll (long project names ellipsize, full path on hover) (#176); the content pane on the right fills with the darker overlay color and scrolls. Resizable from the bottom-right corner (min 688×280, never past the window's right/bottom edge); size and position reset on reopen. No backdrop, so the board stays clickable while you tune. The panel stays on top of open modals (z-index 250, above modal backdrops at 200, below toasts at 300), so modal knobs can be tuned live while a modal is open. Open the panel first, then the modal you want to tune: the ⚙ Settings button sits under a full-screen modal's backdrop (graph view's side-panel ticket modal leaves it clickable).
- Drag it by its title bar; it stays inside the window. ✕ or Escape closes it (Escape closes open modals/menus first). Position isn't remembered.
- UI Settings section: each row is a slider plus a number box bound to the same value; typed values clamp to the range, non-numbers revert.
  - Radius 0–24px: swimlanes, ticket cards, modals, buttons.
  - Opacity 0–100%: modals, swimlanes, ticket cards. Fades the background only, text stays solid.
  - Card text justify (left / center / right) and card content align (top / middle / bottom).
- Each knob writes one `--ui-*` CSS variable on `:root`; `styles.css` falls back to the original values, so defaults look unchanged in every theme. Button and modal radius also reach the Dashboard, since those styles are shared.
- **Reset** restores every default. Values and panel position are saved to `localStorage` key `project-tracker-ui-demo` (this machine only, not the DB) and applied before the app first paints. An ⓘ next to the title says this: changes save automatically, this machine only.

### 3.6 New ticket modal

- **Title** input. Enter saves.
- **Status** select: No status or any lane. It defaults to the lane you started from.
- **Next Lane** select: None, No status, or any lane. Prefilled from the Status lane's Next Lane (3.9) and follows Status changes until you pick a value. A pick that matches the lane default is saved as no override, so the ticket keeps inheriting. A ticket saved with a resolved Next Lane starts armed (the ticket modal's footer checkbox is ticked).
- **Description** textarea, prefilled with a template:
  ```
  ## Context
  ## Acceptance criteria
  -
  ## Out of scope
  ```
  A template you didn't change is thrown away on save, so the ticket is saved with an empty description.
- **Images**: the same dropzone as the Ticket modal (3.8): click to pick, drop files, or Cmd+V. Images wait as previews (blob URLs) and are saved to the new ticket's attachments folder after Save; × removes one before saving. If a save fails, the new ticket opens so its image error shows.
- **Cancel** or **Save**. Save is disabled while the title is blank.
- The ticket gets the next number on the board (highest + 1). Numbers stay fixed after that.

### 3.7 New swim lane modal

- **Name** input. Enter saves.
- **Cancel** or **Add lane**. Add lane is disabled while the name is blank.
- The new lane is added at the end.

### 3.8 Ticket modal (click a ticket)

In graph view this opens as a side panel instead of a centered modal.

**Header:** `#N · Created <date> · Updated <date time>`

**Expand / Collapse** button (top right, here and in the New ticket modal): widens the modal to 85% of the window, click again for normal width. Shared by both ticket modals (not the Lane settings modal) and kept until the app restarts. Not shown in the graph side panel. (`src/components/ExpandToggle.vue`, state in `src/modalWidth.ts`)

**Drag to resize:** the left or right edge of the New ticket, Open ticket (board view), and Lane settings modals (cursor turns to ↔) drags the width anywhere from the default (760px ticket, 560px lane) up to the window width minus the backdrop padding. These three modals close only when the press starts on the backdrop, so a drag released over it doesn't close them. Clicking Expand / Collapse drops the dragged width. Not remembered after the modal closes. (`vEdgeResize` in `src/modalWidth.ts`, limits in `.modal.resizable` in `src/styles.css`)

**Ticket fields** closed-eye button (left of Expand, same closed-eye icon as the fields button in the Lane settings modal (3.9); this modal only): a checkbox per field (Status, Assignee, Description, Labels, Branch, Worktree, Version, Merge Request, External Links, Images, Checklist, Agent, Model, Full auto, Next Lane, Last agent run). Unchecking hides that field in every ticket on this board; saved per board in `BoardPreferences.hiddenModalFields`, so other boards are unaffected. Display-only: hidden fields keep their values and still reach the agent prompt, and empty fields are never sent either way. Outside click or Escape closes the popover (Escape doesn't close the modal). `src/components/board/TicketModal.vue`, `TICKET_MODAL_FIELDS` in `src/shared/projectTypes.ts`.

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
| Version | Semantic version, `MAJOR.MINOR.PATCH` with optional `-prerelease` / `+build`. A leading `v` is dropped. Anything else shows "Use MAJOR.MINOR.PATCH, like 1.4.0" and isn't saved. Cleared when left empty |
| GitHub PR | URL input. An **Open pull request ↗** link appears only for absolute http(s) URLs |

**Merge Request**

- A state pill (open, draft, merged, closed, or none), "Merged <date time>" for merged PRs, a link to the PR, and a **Refresh from GitHub** ↻ icon button (glyph centred: no bottom-padding nudge).
- State comes from GitHub: a PR with `merged_at` is merged, otherwise closed or open, and draft only while open. Opening a board refreshes tickets that have a branch or PR URL and whose PR isn't settled yet.

**External Links**

- Any number of extra links per ticket (design docs, Figma, Slack threads, related issues). Stored as `external_links_json` on the ticket row.
- Type a URL and press **Add** or Enter. The link joins the list above, and the input clears and keeps focus for the next one.
- Only http(s) URLs are added. Anything else keeps its text and shows "Use an http(s) URL". Duplicates are skipped.
- Each link opens in the default browser. **×** removes it. No titles, editing in place, or reordering.
- Passed to agents as a `Links:` block in the ticket prompt, only when the ticket has links. Not shown on board cards.

**Images**

- Attach png/jpg/jpeg/gif/webp images: the full-width **Drag or paste images here +** dropzone (click opens the native picker, multi-select; thumbnails list below it), Cmd+V anywhere in the ticket panel (text pastes still go to the field), or drop files onto the section. 20 MB cap per image.
- Each image is copied to `<userData>/attachments/<ticketId>/<uuid>.<ext>`, so moving or deleting the original doesn't break the ticket. Paths are stored as `images_json` on the ticket row.
- Thumbnails load through the `ticket-image:` scheme, which only serves files inside the attachments folder. Clicking one opens it in the OS viewer; **×** removes it and deletes the copy.
- Passed to agents as an `Images (open each path to view it):` block of absolute paths, only when the ticket has images. Deleting the ticket deletes its attachments folder.

**Checklist**

- The heading shows done/total.
- Each item has a checkbox to mark it done (done items are struck through) and × to remove it.
- To add an item, type it in the full-width "Add an item, then press Enter" input.

**Agent completion**

One section, three captioned groups laid out in wrapping rows that span the modal (`.field-row`): **Who runs it** (Agent | Model | Full auto), **When it's done** (Next Lane | Move to Next Lane, then Move rules and Move rules pass), **Run** (command, buttons, last run). A caption hides when every control in its group is hidden.

- **Agent** select: Claude Code (the default), Codex, Hermes, opencode, and any custom agents saved in state. The pick is saved with the ticket.
- **Model** select (`src/components/ModelField.vue`): "CLI default", then every model the agent lists (`Agent.models`), then **Custom…** to type any other id. A saved id that isn't in the list still shows as an option. Switching agent clears it. Agents that take no model (Hermes) show a disabled "No models configured". Empty adds no flag. Used by ▶ Run and Run in, not by Auto Run.
- **Full auto** checkbox: in every lane, when an agent moves this ticket on, the next lane's agent starts on it (said in its ⓘ tip). An ⓘ icon (`InfoTip.vue`) beside it shows a tooltip on hover or keyboard focus. Esc always hides a showing tip; when the ⓘ itself has focus that Esc is claimed (second Esc closes the modal), otherwise it passes on to the Find bar, custom Model entry, fields menus, lane drag, or modal close (#102, #119). Label text sits in a `<span id>` and the control uses `aria-labelledby`, so "More info" stays out of its accessible name — same for every ⓘ below (#119). The tip bubble is a manual popover in the top layer, anchored to its ⓘ with CSS anchor positioning, so a modal's overflow never clips it; near the right or bottom edge it flips to stay on screen (#138).
- **Next Lane** select (ⓘ tip beside its caption): **Lane default: <lane>** (or **None** when the lane has no Next Lane), No status, or any lane. Where the ticket goes when it completes: its checklist goes from not-all-done to all-done, or a ▶ Run succeeds.
  - The ticket's own pick overrides its lane's Next Lane (3.9). The first option drops the override and inherits.
  - Picking a lane arms the move. Picking the lane default arms it only when the lane has a Next Lane. Inheritance alone never arms a ticket, so existing tickets don't start moving on their own.
  - The checkbox **Move to Next Lane: <lane>**, beside the select, shows the resolved lane and toggles the arming. Untick it to keep the ticket where it is.
  - After the move the box unticks and the override is cleared, so the ticket then inherits its new lane's Next Lane. Deleting the target lane clears it.
  - **Move rules** textarea under that row (shown when there's a Next Lane or saved rules): one rule per line or bullet, saved on change. With rules, the ticket completes only when the rules pass AND every checklist item is done; an empty checklist then passes.
  - **Move rules pass** checkbox, shown when there are rules: confirms them for the current lane only (`move_rules_passed_lane_id`). Ticking it can be the edit that completes and moves the ticket. Any lane change or rules edit resets it.
  - Lane agents get the rules in their prompt plus a `sqlite3` command that confirms them.
- A preview of the exact shell command, built from the lane's prompt and the ticket (see 4.4). The **Run** caption's ⓘ says what the agent gets and how Run differs from Run in.
- **▶ Run** / **Running…** runs the agent in the background in the project folder.
  - Claude Code and Codex runs can write files but can't run shell commands.
  - Other agents follow their own CLI's permission config. opencode allows everything, shell included, unless `opencode.json` says otherwise.
  - A run can last up to 30 minutes and capture up to 10 MB of output.
  - It keeps showing as running if you leave the board and come back.
  - Each run starts a fresh Claude Code session under an id the app picks, saved on the ticket before the agent starts.
  - A network drop, timeout, overload, rate limit or 5xx retries up to 2× (after 30 s, then 2 min), resuming the same session. A notice says "retrying in…". A missing CLI or the 30-minute timeout never retries.
- **⏯ Resume** (next to ▶ Run, Claude Code only): shown when the last run in this lane was interrupted or failed. Opens a terminal tab in the directory the session started in, running `claude --resume <id>` with a "you were interrupted, check git status and continue" prompt. ▶ Run still starts over clean.
- **Interrupted** badge (amber ⏸) on the card: a run still marked running whose app process died (headless, after an app restart) or whose terminal tab is gone (checked at launch and every 60 s; Terminal, iTerm2 and Ghostty by tab title, Warp by age only, after 45 min). Auto Run and full-auto tabs are tracked the same way. An interrupted full-auto ticket doesn't hand off; a notice says "Full auto paused on #N: agent interrupted".
- **⌁ Run in <Open In app>**:
  - Terminals open a new window in the project folder and run the command there, so you can watch each step (and approve it, if the agent asks).
  - Editors open the folder and put the command on the clipboard.
  - The command is copied to the clipboard in both cases.

**Last agent run** (shown once the ticket has one, under the Run buttons)

- Shows the lane it ran in, a timestamp, and the full output, including stderr and the reason when the run failed. Blank output shows a muted "No output" line.
- Only the latest run is kept.

**View on GitHub (#N)**: shown only on tickets imported from GitHub, at the top of External Links (directly above Agent completion when External Links is hidden). Opens the issue in the browser.

**Actions**

- **Trash icon** (left) asks "Are you sure you want to delete ticket #N?". Delete removes it, and Cancel, Escape or a backdrop click keep it.
- **Cancel** undoes the edits made since the modal opened, then closes it.
- **Done** closes the modal and keeps edits. So do clicking the backdrop and Escape.

### 3.9 Lane settings modal (⚙ on a lane)

- **Expand / Collapse** button (top right): widens the modal to 85% of the window, same button as the ticket modal (3.8). Its own state, separate from the ticket modals, kept until the app restarts (`laneModalExpanded`) (#98).
- **Closed-eye button** (left of Expand): checkboxes for this lane's settings fields, this lane only (`hiddenLaneModalFieldsByLane`). The Display modal list is the default; a field hidden there shows disabled with "Hidden for the whole board". Display-only. Lane name always shows.
- **Lane name** input, for renaming.
- Fields below the name sit in 3 collapsable sections, **Agent**, **Orchestrator**, **Auto Run** (native `<details>`: click the header, or Enter/Space with it focused; chevron rotates when open). All open by default. Open/closed is shared by every lane and kept until the app restarts (`laneModalSectionsOpen` in `src/modalWidth.ts`, #136). A section with every field hidden (closed-eye or Display) isn't shown. Collapsing keeps values: a focused prompt blurs and stores on the header click. A collapsed Orchestrator header still shows the missing-token warning.
- **Agent** section:
  - **Agent prompt** textarea: standing instructions for every ticket in this lane. An ⓘ icon beside it shows a tooltip on hover or keyboard focus (#102).
  - **Autosave to markdown** (no button): 1s after typing stops, the prompt is written to the lane's markdown file, and a new file path is stored on the lane. The prompt text itself is stored on blur, as before. The box is bound to the typed draft, so autosave status, a first-save path update or an outside DB refresh never puts old text back mid-typing (#92). Leaving the box, switching lanes or closing the modal saves at once. Saves run one at a time, in order.
    - File field empty: writes `<project>/SwimlaneAgentPrompt/<LANE>/AgentPrompt.md`, making the folders if they're missing. One folder per lane, so the lane's other prompt files (e.g. `AgentOrchestratorPrompt.md`) sit beside it. The lane name is sanitized: spaces and `/ \` become `-`, `: * ? " < > |` and leading dots are dropped, and an empty result falls back to `lane`. A path the app generated (an old `agent-context/*-AgentContext.md`, or a lane folder under the lane's old name) is re-derived on the next save, so a lane's prompts always share one folder; the old file is left in place. Any other path you typed is kept.
    - File field set: writes to that file, creating missing parent folders. The path must end in `.md`. A relative path resolves against the project. Changing the path saves the current prompt there, unless the prompt is empty.
    - The file mirrors the box: each save replaces it, and clearing the prompt leaves it blank. A file holding anything other than what this lane last wrote (a hand-written guide, an edit made in an editor) is never overwritten: the save fails with "<path> has other content…". Pasting the file's text into the box (or pointing the field at another file) lets autosave carry on.
    - Field hint: "Saved to <path>" on success, the error on failure (lane left unchanged). Works on **No status** too. No default caption otherwise: the Agent prompt ⓘ tip covers the autosave, the default folder and the no-prompt fallback (#120).
  - **Agent markdown file**: the file the prompt autosaves to. Ticket agents get the prompt once: the typed prompt when there is one, else "Follow the guidance in <path>." (a hand-written guide with no prompt).
  - **Output**: free text naming where the work goes. An existing directory is used as-is, without asking.
  - Placeholders are lane-neutral (`docs/agent-prompt.md`, "a new folder inside the project directory"): the modal is shared by every lane, so example text never names one lane's artifact (#103).
- **Orchestrator** section:
  - **Orchestrator prompt** textarea (monospace): the full prompt this lane's Auto Run orchestrator gets, fully editable. Has the same ⓘ tooltip icon (#102). Its tip ends with a "Variables:" list, one token per line with its meaning, built from `ORCHESTRATOR_PROMPT_TOKENS` by `orchestratorPromptTokenHelp()`; `{{tickets}}` and `{{ticket_numbers}}` are marked required. The Agent prompt tip instead says it takes no `{{variables}}` (tokens aren't filled in). Tip text keeps `\n` line breaks (`white-space: pre-line`) (#112). No token caption under the box; the tip is the one place tokens are listed. The "Missing {{…}}" error still shows below it (#120).
    - Shows the prompt the launch runs: the lane's current prompt (`swim_lanes.current_agent_orchestrator_prompt`) if set, else its default (`swim_lanes.default_agent_orchestrator_prompt`), else the app-generated prompt with launch-time tokens `{{tickets}}`, `{{ticket_numbers}}`, `{{lanes}}`, `{{terminal}}`, `{{lane_name}}`, `{{lane_id}}`, `{{poll_step}}` (same renderer as the launch, so the preview can't drift). Blank counts as unset. At launch each token is filled in once, unknown `{{…}}` is left as typed (#168).
    - Leaving the textarea with changed text saves it as the lane's current prompt. Text equal to the shown default (trimmed), or a cleared box, stores current as empty, so the lane follows its default.
    - Old per-lane extras (`orchestrator_prompt`) show inside the generated prompt under **Lane instructions** and fold into the current prompt on first edit (and into the default on Save as default).
    - **Save as default** button, only while the box text (not blank) differs from the lane's default: stores the text as the lane's default and clears current, since it would only repeat the default. The default is set only this way.
    - **Reset to default** button, only while a current prompt is set: clears current, so the box shows the default again. No confirm, the edited text is gone. The buttons are bordered like the title strip buttons (`.lane-prompt-actions` in `src/styles.css`, buttons in `src/components/board/LaneSettingsModal.vue`).
    - Missing `{{tickets}}` or `{{ticket_numbers}}`: red hint, launch still runs.
    - The generated prompt carries the lane as tokens: `{{lane_name}}` in the title line, `{{lane_id}}` in "still in the … lane" / "left the … lane", and `{{poll_step}}` as Loop step 1 (the every-N-minutes step, or the ∞ wait-for-messages step). A saved current or default prompt holding them follows lane renames and the poll stepper. They aren't required, so leaving them out shows no red hint. The project path is still typed in.
    - **Restore app default** button, only while the lane has a saved default: clears default and current, so the lane goes back to the app-generated prompt. No confirm.
    - Migration: opening a pre-#168 database copies each lane's non-blank `orchestrator_prompt_override` into `current_agent_orchestrator_prompt` once (schema version 7), inactive workflow snapshots included. The old column stays in the schema, unread and unwritten.
  - **Agent Orchestrator markdown file** (`swim_lanes.orchestrator_file_path`): additional prompt context. Nothing is ever written to it. At launch main reads it (default `<project>/SwimlaneAgentPrompt/<LANE>/AgentOrchestratorPrompt.md`, a typed path must end in `.md` and sit inside a scan directory) and, when it has text, appends it after the prompt under `Additional context (from <path>):`. It never replaces the box text. Missing, blank, unreadable or refused files are skipped and the launch runs without them (`lane:read-orchestrator-context`). Ticket agents never see it. The field hint and the Orchestrator prompt ⓘ tip both say so.
  - **Orchestrator poll (minutes)** stepper pill (`−` · minutes · `+`) one row under the Orchestrator prompt (#101). Center is typeable (whole minutes ≥ 1). `−` from 1 shows `∞` = never polls; `+` from `∞` turns polling back on at 1 (not the old interval). Defaults: 2 minutes, on.
    - Hovering the stepper shows "The Orchestrator agent will poll running agents every N minute(s)." or, at ∞, "The Orchestrator agent never polls: it waits for messages from the ticket agents."
    - The orchestrator's Loop runs `every <N> minutes (sleep <N*60>)`; at `∞` it gathers state once, then waits for ticket-agent messages (#114).
    - Whole minutes, 1 or more. Anything else isn't saved and the field shows the stored value again.
    - `∞`: Auto Run still opens the orchestrator tab; it never polls, sleeps or schedules wake-ups. `−` is disabled. A saved current or default prompt follows it through `{{poll_step}}`; one with a hardcoded sleep loop instead still loops.
    - Saved per lane (`swim_lanes.orchestrator_poll_minutes`, `orchestrator_poll_active`).
  - **Orchestrator agent** select: "Same as ticket agent" (the default) or any agent. **Orchestrator model** select lists the effective orchestrator agent's models: empty means the ticket model when the agent is "Same as", otherwise the CLI default.
- **Auto Run** section (also holds the two Auto Run hints):
  - **Agent** select, plus **Model** select (same picker as the ticket's). Full auto handoffs into the lane use both.
  - **Terminal** select: Warp, Terminal, Ghostty or iTerm2. With no saved choice, it uses the Open In app if that's a terminal, otherwise Warp.
  - Note: Terminal needs Accessibility permission to open tabs.
  - **Full auto** checkbox: start the next lane's agent when this lane's agent moves a ticket on. An ⓘ icon after the label shows a tooltip on hover or keyboard focus, explaining the ticket-level Full auto override and Next Lane (#102, #119).
  - **Next Lane** select, under Full auto: None, No status, or any other lane (never the lane itself). Where this lane's tickets go on completion when they set no Next Lane of their own. Saved per lane (`swim_lanes.next_lane_id`). Deleting the target lane resets it to None.
  - No built-in PR-merge gate: the lane-level "Wait for PR merge" setting was removed (#127). To hold tickets until a merge, write it into the lane's agent prompt or the ticket's Move Rules. The old `swim_lanes.waits_for_pull_request_merge` column stays in the schema, unread and unwritten.
  - **Agent sets semantic version** checkbox, off by default. When on, the lane's ticket prompts tell the agent it decides whether the ticket needs a version, with the `sqlite3` command to write it. The app sets no rule for when.
- **Delete lane** asks "Are you sure you want to delete the <lane> lane?", adding "Its N ticket(s) will move to No status." when the lane has tickets (#108). Cancel has focus on open, so a stray Enter can't delete; Cancel, Escape or a backdrop click close only the confirm. **Delete** moves the lane's tickets to No status; no ticket is deleted. The confirm drops itself if the lane vanishes underneath (poll, other window). No status can't be deleted, so its modal says "This column always exists — it holds tickets with no status." instead.
- **Save to Store** (every lane but No status, #146) saves the lane's settings and its agent + orchestrator markdown files to the global Swimlane Store; each entry gets its own unique swimlane id and records its origin project, created and updated dates; re-saving the same lane from the same board updates its entry, while the same lane saved from another board becomes a separate entry. Shows "Saved to store" or the error.
- **Done** closes the modal.

### 3.10 GitHub issue import (⇣ Pull issues)

- Opening a board with a GitHub repo pulls automatically, once per project per app launch (`autoPulledProjects` in `projects.ts`). The button runs the same pull on demand.
- Fetches open issues, up to 5 pages of 100. Pull requests are skipped.
- The first import creates a **GitHub Issues** lane at the far left.
- Each issue becomes a ticket:
  - title from the issue title, description from the issue body
  - `externalId` set to `github:<n>`, and a link back to the issue
- Running it again is safe: issues already on the board are skipped, and edits to imported tickets are never overwritten.
- Each pull (manual or the auto pull on board open) also syncs imported tickets with GitHub's closed state:
  - closed as completed → moved to the rightmost lane that closes tickets; stays put if no lane does or it's already there
  - closed for any other reason (not planned, duplicate, none) → removed from the board, unless the ticket has a worktree or PR, then kept and reported
  - still open, reopened, or missing from GitHub → untouched
  - closed issues are fetched with `since` = the oldest imported ticket's creation time; no imported tickets → no closed fetch
- Nothing added, moved or removed → no DB write; the auto pull stays silent.

### 3.11 Auto Run (▶ on a lane)

- Opens **one new terminal window with one tab per visible ticket** in the lane. Active filters decide which tickets count.
- Each tab `cd`s into the project and runs that ticket's agent command, then leaves an open shell behind — except in Warp, where the command is `<agent>; exit`, so the tab closes when its agent ends (#123).
- Tab titles are `<N>-<Lane>-<title>` (`ticketTabTitle`), e.g. `99-Merge-Request-Fix the thing`, the same for ⌁ Run in, Open in shell and Resume. The lane is the display name, dashed (`laneTitleToken`); No status reads `Unassigned`. Only the title part is cut, to 40 code points + `…`.
- Launches with a session id (Auto Run, full auto handoffs, Resume) end the title with ` · <first 8 of the session id>`, e.g. `99-PRD-Fix the thing · 1234abcd`, so two runs of one ticket in one lane get different tabs (#124). The suffix is never cut. ⌁ Run in, Open in shell and agents without session ids keep the plain title.
- Each run takes the lane it launches for, so a full auto handoff opens its tab under the new lane's title. Open tabs are never retitled. The orchestrator matches each ticket by the exact tab title it was given; its ticket lines carry the session id, and a handoff tab is any open tab titled with a predicted handoff title, alone or plus ` · <session id>`, or one seen in `agent_run_json.tabTitle` from its ticket query, or one a ticket agent reports (each agent's prompt states its session id and tab title).
- Agents with `sessionNameArgs` get a session name: Claude Code runs with `--name '<N>-<Lane>'` (`ticketSessionName`), e.g. `99-PRD`.
- How each terminal does it:
  - **Warp**: writes one Tab Config per tab to `~/.warp/tab_configs/project_tracker_ticket_<id>.toml` and opens `warp://tab_config/<stem>`. Tabs land in the focused Warp window; a new window opens only when Warp has none. Each file is deleted after ~60 s, so none linger in Warp's `+` menu. Launches are queued, so two lanes started back to back both get their tabs (#116).
  - **Terminal**: AppleScript `do script`. Extra tabs are opened with ⌘T through System Events, which needs Accessibility permission. The script stops with an error if no tab appears.
  - **iTerm2**: AppleScript `write text`.
  - **Ghostty**: Ghostty 1.3+ scripting (`initial input`), for one ticket or several.
- The button asks first. The dialog starts on the lane's settings and changes them for this run only: agent, model, terminal, and the orchestrator agent and model. The model picker sits inline in the question ("Run N separate <agent> agents with <model> for N tickets?"); the orchestrator agent and model sit in their own **Orchestrator** section below it, hidden when the lane's orchestrator poll **Active** checkbox is off. The orchestrator Agent and Model fields sit side by side and wrap on a narrow window.
- With no saved lane model, the model picker starts on the agent's `defaultModel` — Claude Code: `claude-opus-5-5` (agents without one start on "CLI default"). A saved lane model wins. Switching the agent in the dialog resets the model to the new agent's default.
- Plus one orchestrator tab, `AUTORUN-ORCHESTRATOR-<LANE>`, that watches the run's tickets — unless the lane's orchestrator poll **Active** checkbox is off.
  - It closes a ticket's tab in this lane only after the ticket query shows the ticket has left the lane, never on a "done" message alone. Handoff tabs (the next lane's agents) close only once the ticket is done. It never closes a title that more than one open tab matches. Lane instructions can't override this (#106).
  - In Warp (no tab scripting) it finds each agent by its `--session-id`/`--resume` UUID with `pgrep -f` and closes the tab with `kill -TERM <pid>`; a session id matching more than one pid is skipped. Handoff session ids come from `agent_run_json.sessionId` (#123).
  - It exits only when nothing needs the user; otherwise it stays running with open questions on screen, since in Warp exiting closes its tab.
  - Full auto ticket agents finish in a fixed order: move the ticket, print the final footer, then message the orchestrator (if one is watching) as the very last action.
- A second click on the lane does nothing until the first launch has finished.
- One agent per ticket per lane (#121): tickets whose agent is already running in this lane are left out of the count and the launch, and the notice adds "Skipped #N, #M: agent already running in <lane>". Checking a card overrides this (for a stale `running` record). Full auto handoffs into a lane skip the same tickets — dropped, not queued (`splitRunnable`).

### 3.12 Graph view

- A workflow editor for the board. Each **Swim lane** is a node ("Swim lane · N", N = its ticket count). Tickets themselves are not shown.
- **Moving nodes**: drag a node anywhere on the canvas. Its spot is saved on drop (`swim_lanes.graph_position_json`, `SwimLane.graphPosition`) and kept across view switches and restarts. A lane never dragged sits in its row slot, left to right in board order (`laneGraphPosition` in `projectTypes.ts`). The No status node moves the same way. Moving a node never reorders the swimlane columns. A click without movement selects the lane.
- **Connecting**: every node has a dot on its left and right edge. Drag from either dot and an arrow follows the pointer; release on any dot of another lane to set the origin lane's Next Lane to it. A lane has at most one outgoing arrow: connecting again replaces it. Releasing on empty canvas or on the origin lane changes nothing.
- **Transitions**: an arrow from a lane's right dot to its Next Lane's left dot. Arrows pointing back left loop below the nodes. Click an arrow to select it, then press Delete/Backspace or its **×** to clear that lane's Next Lane.
- **+ Add swim lane** (sidebar, nothing selected) opens the same name prompt as the swimlane view's +; the new lane's node lands one column right of the rightmost node, and it is added as the last swimlane column.
- **State markers**: the first lane has an entry arrow (start state). Lanes with no Next Lane, or that close tickets, have a double border (terminal). Any other lane that no lane points to is dimmed. Tickets can still be dragged there, so this is only a hint.
- It uses the same visible lanes as the swimlane view. Hidden or filtered-out lanes are not drawn and can't be connected to.
- **Details sidebar**:
  - Nothing selected: the number of swim lanes, **+ Add swim lane**, a list of lanes with ticket counts that you can click to select, and a **Transitions** list ("In Development → Merge Request").
  - With a lane selected: a back button to the project, then its ticket count, its Next Lane ("None — tickets stop here" when unset, "(hidden)" when the target is hidden), its incoming lanes, then **Agent prompt** and **Orchestrator prompt** sections.
  - Each prompt section lists the lane's prompt as editable rules (`promptRules` in `projectTypes.ts`): an unindented `- `/`* ` bullet or numbered line (`1.`) starts a rule; other lines, indented sub-bullets included, continue it. Leaving a rule (blur or Enter; Shift+Enter adds a line break) saves the prompt through `store.updateLane`, rewritten as `- rule` lines with numbered rules kept as-is (`rulesToPrompt`). **+ Add rule** and **×** add and delete rules; a rule cleared to empty is deleted. An empty prompt shows "No rules yet". When the lane has an agent markdown file the Agent section shows "Also follows: <file name>". The markdown file itself is not written; that stays on the Swimlane settings button.

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
- Walks asynchronously, one folder at a time, so the app stays responsive. Sends progress (folders seen + current folder) at most every 100 ms over `projects:scan-progress`; `projects:scan-cancel` aborts it. Only one scan runs at a time. Reloading or closing the window that started the scan aborts it too (`electron/pageGone.ts`), so a hung scan can't block the next window from scanning.
- **Merging with saved data**: your status, priority, notes and GitHub stats are kept across rescans, and new data from the scan fills in the rest.

### 4.2 Storage — `electron/storage/`

- SQLite through the built-in `node:sqlite`, at `~/Library/Application Support/Project Tracker/project-tracker.sqlite`.
- WAL mode with a 5-second busy timeout, so other processes can read and write while the app is open.
- Snapshots in `snapshots/` next to the DB, via `VACUUM INTO`: one on launch when the newest is over 24h old (before migrations), plus File → Back Up Database Now. Newest 7 kept. A failed snapshot logs a warning and startup continues. Restore steps in `README.md`.
- Tables: `users`, `projects`, `project_members`, `swim_lanes`, `tickets`, `project_paths`, `user_paths`, `user_settings`, `schema_meta`.
- Saves write only what changed: changed fields for tickets, changed rows for everything else.
- Text written as a BLOB, for example with a bare `readfile()`, is decoded as UTF-8 when read.
- When a board is read, any ticket whose lane no longer exists moves to No status, and tickets without a number get one.
- The web build (4.8) reaches the same file through the local web server, one repository connection per browser tab.
- Local only today. Cloud provider costs for 1 → 1M users (AWS, Azure, GCP, Cloudflare): `docs/research/t78-cloud-db-cost-analysis.pdf`, re-runnable via `python3 -I docs/research/t78-cost-model.py` (#78).

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
   - then, where set: Assignee, Labels, Branch, Worktree, Version, Pull request, Source URL, and the checklist as `- [x]` / `- [ ]` lines
4. The ticket description.
   - Lanes with **Agent sets semantic version** on add the version instruction after it.
5. `Output: <target>`, with the standing instruction to use that location as-is or create it.

If the prompt starts with `-`, it's prefixed with "Instructions:" so the CLI doesn't read it as an option. For the terminal command, the prompt is wrapped in single quotes, so text from GitHub issues is passed as one literal argument and never runs as code.

### 4.5 Security boundaries — `electron/main.ts`, `electron/preload.cts`, `electron/ipcHandlers.ts`

- Context isolation is on, Node integration is off, and the renderer is sandboxed. The renderer can only reach the API the preload script exposes.
- Every IPC handler checks which page sent the request: the `file://` page in packaged builds, the dev server URL (`VITE_DEV_SERVER_URL`, port picked per checkout) in development. The web server's equivalent is its request guard (4.8).
- Payloads are type-checked, and paths are normalized to POSIX absolute paths. A rejected ticket or lane patch names the first bad key: `Invalid lane update payload: rejected key "<key>".` (`rejectedPatchKey` in `electron/ipcHandlers.ts`)
- Project-scoped actions refuse paths outside the configured scan directories: Open In, Auto Run, agent runs and README reads.
- Open In targets, Auto Run terminals and agents are looked up by id in fixed lists, so the renderer can't choose which program runs.
- Child processes get their arguments as an array, never through a shell.
- External links (http and https only) open in the system browser. All other navigation and new windows are blocked.
- `NSAppleEventsUsageDescription` is set so macOS allows the AppleScript launches.

### 4.6 Build and release — `package.json`

- `bun run dev` (`scripts/dev.mjs`) runs the Vite dev server and Electron together with hot reload. Each checkout gets its own fixed port: main checkout 5173, a linked worktree 5200–5899 hashed from its path; `PROJECT_TRACKER_DEV_PORT` overrides. A taken port fails loudly (`--strictPort`) instead of drifting. Cmd+Q, closing the last window (dev only) or Ctrl+C stops both and frees the port.
- `bun run dist` builds an arm64 `.dmg` and `.zip` with electron-builder into `dist/`.
- `bun run release` builds and publishes to GitHub Releases, which is where auto-update gets new versions.
- `bun run start:prod` launches a fresh copy of the packaged app.
- `bun run eval` runs the behavioral prompt evals (see 4.7). It's opt-in and never part of `bun run test` or CI.
- `bun run set-version <version> <ticket>...` (`scripts/set-ticket-version.mjs`) stamps one SemVer on many tickets in the tracker DB. Tickets as `12 14 15,16`; a `#` prefix must be quoted (`'#14'`) or the shell treats it as a comment. Project defaults to the main checkout of the cwd repo (works from worktrees); `--project` / `--db` override. All-or-nothing: any number missing for that project → error, nothing written. Prints `#N title: from → to` per ticket. The app picks the change up live.
- `bun run scale-test [--keep] [--port 9333]` (`scripts/scale-test.mjs`) grows one throwaway board on a `.backup` copy of the live DB (isolated `PROJECT_TRACKER_USER_DATA`) and times ticket create + open through the real UI over CDP at 10…100 (step 10), then every 100, until median-of-3 creation > 5 s, 20,000 tickets or 60 min. Writes a CSV; `scripts/scale-report.mjs` turns it into a PDF via `printToPDF`. `--tag <name>` names the output files. Last runs: `docs/reports/t118-scaling-report.pdf` (before), `docs/reports/t134-scaling-report.pdf` (after #134).
- CI (`.github/workflows/ci.yml`): one `check` job on `ubuntu-latest` runs `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test` and `bun run build` on every PR to `main` and every push to `main`. Bun is pinned to 1.3.11; Node 22 is set up because vitest runs under Node and `node:sqlite` needs ≥ 22.5. `check` is a required status check on `main`. No `.dmg` packaging in CI (needs signing creds).

### 4.7 Lane prompt evals — `evals/`

- Static tier, part of `bun run test`:
  - `evals/static/lint.test.ts` checks every `SwimlaneAgentPrompt/**/*.md`: not empty, names only lane ids on `evals/fixtures/board.json`, no hard-coded real DB path, assembled prompt never starts with `-`.
  - `evals/static/snapshots.test.ts` snapshots the assembled prompt for each prompted lane × 4 ticket variants (bare, full auto, branch + worktree, checklist). A prompt edit shows as a snapshot diff in the PR.
- Behavioral tier, `bun run eval`:
  - Each case in `evals/fixtures/cases/<lane>/` runs the lane's real agent against a throwaway world: temp git repo with a local bare `origin`, temp Project Tracker DB, stubbed `gh` / `osascript` / `mise`.
  - The prompt gets the temp DB path through `TicketPromptContext.databasePath` plus an appended system prompt, so the agent never writes to the real DB.
  - Graded on outcome (end lane, move count from a SQLite trigger, required fields, stub calls), then by an LLM judge (`evals/judge.ts`) on the case's rubric using the agent's tool-call trajectory.
  - A case passes at ≥ ⌈2N/3⌉ of `EVAL_RUNS` (default 3). Knobs: `EVAL_LANE`, `EVAL_RUNS`, `EVAL_AGENT`, `EVAL_EXTRA_ARGS`, `EVAL_KEEP`, `EVAL_JUDGE`, `EVAL_JUDGE_MODEL`.
  - Results: a lane × case table on stdout and `evals/results/<timestamp>.json` (gitignored).
  - The real DB is guarded: any row with the eval ticket number or a sandbox project path fails the case.
  - `evals/behavioral/sync.eval.test.ts` checks each lane's committed prompt file (saved path, else `SwimlaneAgentPrompt/<lane>/AgentPrompt.md`) against its lane's prompt in the live DB.

---

### 4.8 Web app — `electron/web/server.ts`, `src/services/webBridge.ts`

- `bun run web` builds `src/` with `vite build --mode web` into `out/web/` and starts a Node server on `http://127.0.0.1:5174` (`PROJECT_TRACKER_WEB_PORT` to change it).
- `src/main.ts` installs `webBridge` as `window.projectTracker` before mount. Each method posts the preload's payload to `POST /api/invoke/<channel>`. Both the preload and the web bridge `satisfies ProjectTrackerBridge` (`src/shared/bridgeApi.ts`), so neither can drift from the interface.
- The server runs the same `createIpcHandlers` as `electron/main.ts`. The channel list is `IPC_CHANNELS` in `src/shared/bridgeApi.ts`.
- One `StateRepository` per browser tab, keyed by a random client id, so each tab has its own diff baseline and sees other tabs' writes as outside changes. Closed 30 s after the tab's event stream drops.
- Outside changes, agent retries and scan progress arrive over Server-Sent Events, `GET /api/events?client=<id>`. Outside changes come from the same 10 s `data_version` poll. A scan running when the tab's last event stream drops is aborted, like a reload in Electron.
- Ticket images: Add image opens the browser's file picker and uploads the bytes (base64) through `ticket-images:save-bytes`, the same path paste and drop use. Thumbnails load from `GET /api/ticket-image/<path>`, confined to `<userData>/attachments` by `resolveAttachmentPath`, the web twin of the `ticket-image://` scheme. Every response has `Cross-Origin-Resource-Policy: same-origin`, so other sites can't embed them.
- Request guard: listens on `127.0.0.1` only. `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding). Any `Origin` must be the server's own; a `POST` needs that `Origin` and `Content-Type: application/json`. Everything else gets 403, and no CORS headers are ever sent. Responses carry `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
- Add folder runs `osascript choose folder` on the server. The Dirs panel also shows an absolute-path text box in the web build.
- Connection cap: plain HTTP/1.1, so the browser allows 6 open connections to the server across all tabs. Each tab holds one for its event stream and each ▶ Run holds one until the agent finishes. Past 6, new requests wait silently. Fix when it bites: one SharedWorker owning the event stream, or HTTP/2 (needs TLS).
- Missing compared with the desktop app: PageFind (the browser's ⌘F works instead), `theme:set-native`, application menu, auto-update, native window chrome.

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
