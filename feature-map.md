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
| **📊 Metrics** | The same popover as the Dashboard's (2.1), for this project only |

### 3.2 Notices and errors

See 1.7. Board notices include:

- "Imported N issues into X (M already on the board)." Pull results and pull errors ("X: <message>") name the project, so a pull that finishes after you switch boards isn't mistaken for the open board's.
- "Imported N issues into X, moved N to <lane>, removed N closed, kept N closed with local work." (only non-zero parts); a sync with no imports reads "X: Moved N to <lane>, …"
- "Auto Run opened N tabs in X."
- "Agent running on #N…" and "Agent finished #N."
- "Running the agent command in X."

### 3.3 Filter bar

From left to right:

- **Filter tickets…** text box. It matches the ticket number (`#12`), title, description, labels and branch, ignoring case.
  - **⌘⇧F** (Ctrl+Shift+F) focuses the box and selects its text, from anywhere on the board. Ignored while a modal is open.
  - A theme-coloured **✕** shows inside the box while it has text. Clicking it empties only the text; the lane and assignee filters stay, and focus stays in the box. Escape leaves the box without clearing it. (`BoardView.vue`, `.filter-query::-webkit-search-cancel-button` in `styles.css`)
- **All swim lanes** select: limits the board to a single column.
- **Assigned to me** toggle: shows only tickets assigned to the current user.
- **Column toggles** for **No status (N)** and, once issues have been imported, **GitHub Issues (N)**. Each one shows or hides that column; N is the total number of tickets in it.
- **"X of Y"** count: visible tickets out of all tickets.
- **Clear**: appears when any filter is set and resets the text, lane and assignee filters.
- **View switch**: a two-button slider for **Graph view** and **Swimlane view** (the default). Switching closes any open ticket.

### 3.4 Swimlane view

- When the board has no lanes: "No swim lanes yet." with a **Create swim lane** button.
- Otherwise the columns are No status followed by the board's lanes in order. Hidden columns and the lane filter apply.
- **"+" add zone** after the last lane, one lane wide (260 px). Invisible until hovered: a bordered **+** slides in from the right, and stays 3 s after the pointer leaves (re-entering cancels the hide). Clicking it opens the New swim lane modal (3.7). Reachable by Tab (shown on focus). Opacity-only under Reduce Motion. Hidden while the lane filter is set, and inert (but keeps its space, so lanes don't jump) during a lane drag. (`.lane-add-zone` in `BoardView.vue` / `styles.css`)

#### Lane column

- **Header**: lane name, count of matching tickets, and two buttons:
  - **▶ Auto Run** (3.11). Disabled when the lane has no matching tickets or a launch is already running. The tooltip names the terminal and agent.
  - **⚙** opens the Lane settings modal (3.9).
- Double-clicking the header or an empty part of the lane opens the New ticket modal for that lane.
- **Reordering**: drag a lane by its header to a new position, or focus the header and press Alt+← / Alt+→ to move it one slot. Escape cancels a drag. No status always stays first, and lanes can't move while the lane filter shows a single column.
- **Resize handle** on the right edge. Width runs from 200 to 900 px (default 260). The width is saved once when you let go, as a per-user preference.
- You can drop a ticket on any lane to move it there.

#### Ticket card

- Draggable between lanes. Clicking a card opens the Ticket modal (3.8).
- **Select checkbox** (title "Select (run / move)"): checked cards feed Auto Run's ticket set and bulk drag. Selection is in memory only and clears when you switch project.
- **Bulk drag**: dragging a checked card moves every checked, visible ticket to the drop lane in one save, all with the same `updatedAt` (`ticketIdsToMove` in `projectTypes.ts`, `moveTickets` in `stores/projects.ts`).
  - Dragging an unchecked card moves only that card.
  - Checked tickets hidden by search, the assignee filter, a hidden lane or the lane filter don't move. Tickets already in the drop lane aren't touched.
  - Moved tickets stay checked.
  - **Stack ghost** (2+ tickets carried): the drag image is the dragged card with up to 2 offset card edges behind it (3 layers max) and an accent count badge with the carried count. The other carried cards fade and shrink in place (`.ticket-carried`) until `dragend`. The count is every checked visible ticket, including ones already in the drop lane (`carriedTicketIds` in `projectTypes.ts`, `startTicketDrag` in `BoardView.vue`). Reduce Motion drops the fade/shrink transition; the ghost and dimming stay. An unchecked card, or the only checked one, uses the browser's default drag image.
- The title always shows. These fields show only when switched on in Display:
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

### 3.5 Display settings modal (⚙ Display)

- **Ticket card display**: a checkbox per optional card field (Ticket number, Description, Assignee, Labels, Checklist progress, Branch, Semantic version). All are on by default.
- **Columns**: a checkbox per column (No status first, then every lane in board order, each with its ticket count) to show or hide it. New lanes start shown.
- **Done** closes the modal. So do clicking the backdrop and Escape.
- These settings are per user and per board. They're kept separate from the board, which is shared.

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

**Expand / Collapse** button (top right, here and in the New ticket modal): widens the modal to 85% of the window, click again for normal width. Shared by both modals and kept until the app restarts. Not shown in the graph side panel.

**⚙ Ticket fields** button (beside Expand, this modal only): a checkbox per field (Status, Assignee, Description, Labels, Branch, Worktree, Version, Merge Request, External Links, Images, Checklist, Agent, Model, Full auto, Next Lane, Last agent run). Unchecking hides that field in every ticket on this board; saved per board in `BoardPreferences.hiddenModalFields`, so other boards are unaffected. Display-only: hidden fields keep their values and still reach the agent prompt, and empty fields are never sent either way. Outside click or Escape closes the popover (Escape doesn't close the modal). `src/views/BoardView.vue`, `TICKET_MODAL_FIELDS` in `src/shared/projectTypes.ts`.

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

- A state pill (open, draft, merged, closed, or none), "Merged <date time>" for merged PRs, a link to the PR, and a **Refresh from GitHub** button.
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
- To add an item, type it in "Add an item, then press Enter".

**Agent completion**

- **Agent** select: Claude Code (the default), Codex, Hermes, opencode, and any custom agents saved in state. The pick is saved with the ticket.
- **Model** select (`src/components/ModelField.vue`): "CLI default", then every model the agent lists (`Agent.models`), then **Custom…** to type any other id. A saved id that isn't in the list still shows as an option. Switching agent clears it. Agents that take no model (Hermes) show a disabled "No models configured". Empty adds no flag. Used by ▶ Run and Run in, not by Auto Run.
- **Full auto** checkbox: in every lane, when an agent moves this ticket on, the next lane's agent starts on it.
- **Next Lane** select, under Full auto: **Lane default: <lane>** (or **None** when the lane has no Next Lane), No status, or any lane. Where the ticket goes when it completes: its checklist goes from not-all-done to all-done, or a ▶ Run succeeds.
  - The ticket's own pick overrides its lane's Next Lane (3.9). The first option drops the override and inherits.
  - Picking a lane arms the move. Picking the lane default arms it only when the lane has a Next Lane. Inheritance alone never arms a ticket, so existing tickets don't start moving on their own.
  - The footer checkbox **Move to Next Lane: <lane>** shows the resolved lane and toggles the arming. Untick it to keep the ticket where it is.
  - After the move the box unticks and the override is cleared, so the ticket then inherits its new lane's Next Lane. Deleting the target lane clears it.
- A preview of the exact shell command, built from the lane's prompt and the ticket (see 4.4).
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
- **Autosave to markdown** (no button): 1s after typing stops, the prompt is written to the lane's markdown file, and a new file path is stored on the lane. The prompt text itself is stored on blur, as before. The box is bound to the typed draft, so autosave status, a first-save path update or an outside DB refresh never puts old text back mid-typing (#92). Leaving the box, switching lanes or closing the modal saves at once. Saves run one at a time, in order.
  - File field empty: writes `<project>/SwimlaneAgentPrompt/<LANE>/AgentPrompt.md`, making the folders if they're missing. One folder per lane, so the lane's other prompt files (e.g. `AgentOrchestratorPrompt.md`) sit beside it. The lane name is sanitized: spaces and `/ \` become `-`, `: * ? " < > |` and leading dots are dropped, and an empty result falls back to `lane`. A path the app generated (an old `agent-context/*-AgentContext.md`, or a lane folder under the lane's old name) is re-derived on the next save, so a lane's prompts always share one folder; the old file is left in place. Any other path you typed is kept.
  - File field set: writes to that file, creating missing parent folders. The path must end in `.md`. A relative path resolves against the project. Changing the path saves the current prompt there, unless the prompt is empty.
  - The file mirrors the box: each save replaces it, and clearing the prompt leaves it blank. A file holding anything other than what this lane last wrote (a hand-written guide, an edit made in an editor) is never overwritten: the save fails with "<path> has other content…". Pasting the file's text into the box (or pointing the field at another file) lets autosave carry on.
  - Field hint: "Saved to <path>" on success, the error on failure (lane left unchanged). Works on **No status** too.
- **Agent markdown file**: the file the prompt autosaves to. Ticket agents get the prompt once: the typed prompt when there is one, else "Follow the guidance in <path>." (a hand-written guide with no prompt).
- **Output**: free text naming where the work goes. An existing directory is used as-is, without asking.
- **Orchestrator prompt** textarea (monospace): the full prompt this lane's Auto Run orchestrator gets, fully editable.
  - Unedited: shows the generated prompt with launch-time tokens `{{tickets}}`, `{{ticket_numbers}}`, `{{lanes}}`, `{{terminal}}`. Same renderer as the launch, so the preview can't drift.
  - Leaving the textarea with changed text saves it as the lane's override (`swim_lanes.orchestrator_prompt_override`); at launch each token is filled in once, unknown `{{…}}` is left as typed. Text equal to the default (trimmed) saves nothing.
  - Old per-lane extras (`orchestrator_prompt`) show inside the prompt under **Lane instructions** and fold into the override on first edit.
  - **Reset to default** button, only while an override is set: back to the generated prompt. No confirm, the edited text is gone.
  - Missing `{{tickets}}` or `{{ticket_numbers}}`: red hint, launch still runs.
  - An override has lane name, id, project path and poll minutes typed in. Renaming the lane or changing the poll doesn't update it; Reset picks them up.
- **Agent Orchestrator markdown file** (`swim_lanes.orchestrator_file_path`): the Orchestrator prompt box (override or generated) autosaves here with the same rules as the Agent prompt, except it is always replaced (no other-content check: the generated text changes with the app, and the file is never read back); default file is `<project>/SwimlaneAgentPrompt/<LANE>/AgentOrchestratorPrompt.md`. The text is stored with the same override rules as leaving the box, so typing back to the default doesn't create an override. The file is a copy for versioning and review: the launch prompt never reads or names it, so the orchestrator gets its prompt once. Ticket agents never see it.
- **Orchestrator poll (minutes)** input with an unlabeled **Active** checkbox to its left, one row under the Orchestrator prompt; the checkbox sits centered on the input box (#84). Defaults: 2 minutes, Active.
  - Hovering the checkbox shows "The Orchestrator agent will poll running agents every N minute(s)." or, when off, "Off: Auto Run launches no Orchestrator agent for this lane."
  - The orchestrator's Loop runs `every <N> minutes (sleep <N*60>)`.
  - Whole minutes, 1 or more. Anything else isn't saved and the field shows the stored value again.
  - Active off: this lane's Auto Run opens no orchestrator tab; ticket tabs are unchanged. The minutes input is disabled but keeps its value.
  - Saved per lane (`swim_lanes.orchestrator_poll_minutes`, `orchestrator_poll_active`).
- **Auto Run** section:
  - **Agent** select, plus **Model** select (same picker as the ticket's). Full auto handoffs into the lane use both.
  - **Orchestrator agent** select: "Same as ticket agent" (the default) or any agent. **Orchestrator model** select lists the effective orchestrator agent's models: empty means the ticket model when the agent is "Same as", otherwise the CLI default.
  - **Terminal** select: Warp, Terminal, Ghostty or iTerm2. With no saved choice, it uses the Open In app if that's a terminal, otherwise Warp.
  - Note: Terminal needs Accessibility permission to open tabs.
- **Full auto** checkbox: start the next lane's agent when this lane's agent moves a ticket on.
- **Next Lane** select, under Full auto: None, No status, or any other lane (never the lane itself). Where this lane's tickets go on completion when they set no Next Lane of their own. Saved per lane (`swim_lanes.next_lane_id`). Deleting the target lane resets it to None.
- **Wait for PR merge before moving on** checkbox. When on, an armed ticket here moves to its Next Lane when its PR turns merged, not when its checklist completes or a ▶ Run succeeds. A ticket with no PR, or an open one, stays put and stays armed. A ticket whose PR is already merged moves on completion as usual. On for In PR (`in-pr`) on new boards and, once, on existing boards (`swim_lanes.waits_for_pull_request_merge`, `completionMoves` in `projectTypes.ts`). The move happens when the app learns of the merge: the board-open PR sync, or an outside write to `pull_request_state`.
- **Agent sets semantic version** checkbox, off by default. When on, the lane's ticket prompts tell the agent it decides whether the ticket needs a version, with the `sqlite3` command to write it. The app sets no rule for when.
- **Delete lane** moves the lane's tickets to No status; no ticket is deleted. No status can't be deleted, so its modal says "This column always exists — it holds tickets with no status." instead.
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
- Each tab `cd`s into the project and runs that ticket's agent command, then leaves an open shell behind.
- Tab titles are `#N <title>` (`ticketTabTitle`), the same for ⌁ Run in. The orchestrator tab matches tickets by that `#N ` prefix.
- Agents with `sessionNameArgs` get a session name: Claude Code runs with `--name 'Ticket #N'` (`ticketSessionName`).
- How each terminal does it:
  - **Warp**: writes `~/.warp/launch_configurations/project-tracker-ticket.yaml` and opens `warp://launch/...`.
  - **Terminal**: AppleScript `do script`. Extra tabs are opened with ⌘T through System Events, which needs Accessibility permission. The script stops with an error if no tab appears.
  - **iTerm2**: AppleScript `write text`.
  - **Ghostty**: Ghostty 1.3+ scripting (`initial input`), for one ticket or several.
- The button asks first. The dialog starts on the lane's settings and changes them for this run only: agent, model, terminal, and the orchestrator agent and model. The model picker sits inline in the question ("Run N separate <agent> agents with <model> for N tickets?"); the orchestrator agent and model sit in their own **Orchestrator** section below it, hidden when the lane's orchestrator poll **Active** checkbox is off. The orchestrator Agent and Model fields sit side by side and wrap on a narrow window.
- With no saved lane model, the model picker starts on the agent's `defaultModel` — Claude Code: `claude-opus-5-5` (agents without one start on "CLI default"). A saved lane model wins. Switching the agent in the dialog resets the model to the new agent's default.
- Plus one orchestrator tab, `AUTORUN-ORCHESTRATOR-<LANE>`, that watches the run's tickets — unless the lane's orchestrator poll **Active** checkbox is off.
- A second click on the lane does nothing until the first launch has finished.

### 3.12 Graph view

- A state diagram of the board's workflow. Each **Swim lane** is a state ("Swim lane · N"), laid out left to right in board order with No status first. Its **Ticket** nodes (#N and title) stack underneath it.
- **Transitions**: an arrow from a lane to its Next Lane. Arrows to a lane further right curve above the row; arrows back to an earlier lane curve below it.
- **Ticket overrides**: tickets whose own Next Lane differs from their lane's add a dashed arrow to their target. Overrides with the same source and target share one arrow, labeled with the ticket count ("2 tickets"). Built by `laneTransitions` in `projectTypes.ts`.
- **State markers**: the first lane has an entry arrow (start state). Lanes with no Next Lane, or that close tickets, have a double border (terminal). Any other lane with no incoming arrow is dimmed. Tickets can still be dragged there, so this is only a hint.
- Armed tickets (they move on completion) show **▶** next to their number.
- It uses the same visible lanes and filtered tickets as the swimlane view. Arrows into hidden, filtered-out or deleted lanes are not drawn.
- **Details sidebar**:
  - Nothing selected: the number of swim lanes, a list of lanes with ticket counts that you can click to select, and a **Transitions** list ("In Development → Merge Request").
  - With a lane selected: a back button to the project, then its ticket count, its Next Lane ("None — tickets stop here" when unset, "(hidden)" when the target is hidden), its incoming lanes, its ticket overrides ("#N → lane"), then **Agent prompt** and **Orchestrator prompt** sections.
  - Each prompt section lists the lane's prompt as editable rules (`promptRules` in `projectTypes.ts`): an unindented `- `/`* ` bullet or numbered line (`1.`) starts a rule; other lines, indented sub-bullets included, continue it. Leaving a rule (blur or Enter; Shift+Enter adds a line break) saves the prompt through `store.updateLane`, rewritten as `- rule` lines with numbered rules kept as-is (`rulesToPrompt`). **+ Add rule** and **×** add and delete rules; a rule cleared to empty is deleted. An empty prompt shows "No rules yet". When the lane has an agent markdown file the Agent section shows "Also follows: <file name>". The markdown file itself is not written; that stays on the Swimlane settings button.
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
- Walks asynchronously, one folder at a time, so the app stays responsive. Sends progress (folders seen + current folder) at most every 100 ms over `projects:scan-progress`; `projects:scan-cancel` aborts it. Only one scan runs at a time.
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
- Every IPC handler checks which page sent the request: the `file://` page in packaged builds, `http://127.0.0.1:5173` in development. The web server's equivalent is its request guard (4.8).
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
- `bun run eval` runs the behavioral prompt evals (see 4.7). It's opt-in and never part of `bun run test` or CI.
- `bun run set-version <version> <ticket>...` (`scripts/set-ticket-version.mjs`) stamps one SemVer on many tickets in the tracker DB. Tickets as `12 #14 15,16`. Project defaults to the main checkout of the cwd repo (works from worktrees); `--project` / `--db` override. All-or-nothing: any number missing for that project → error, nothing written. Prints `#N title: from → to` per ticket. The app picks the change up live.
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
