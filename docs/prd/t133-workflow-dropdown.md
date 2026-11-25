## Work location
- Branch: `t133-create-a-workflow`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t133`
- PRD: `docs/prd/t133-workflow-dropdown.md`

## Context
- A board has one fixed set of lanes. `swim_lanes` (`electron/storage/schema.ts:51`) has PK `(project_path, id)`, and each lane row holds all of that lane's settings: name, position, agent + orchestrator prompts and files, auto run, full auto, next lane, closes ticket, poll and PR-merge flags.
- No workflow or preset concept exists yet. The only lane seed is `DEFAULT_LANE_NAMES` / `createDefaultBoard` (`src/shared/projectTypes.ts:1551,1627`).
- Lanes are read and written through `stateRepository.ts` (`createSwimLane` :553, `updateSwimLane` :570, `reorderSwimLanes` :586, `deleteSwimLane` :605, `readBoards` :809), the `lane:*` IPC handlers (`electron/ipcHandlers.ts:426-446`) and `useProjectsStore` (`src/stores/projects.ts`).
- These fields point at lanes by id, none of them as a foreign key: `tickets.lane_id`, `move_to_lane_id`, `ready_lane_id`, `move_rules_passed_lane_id`, `move_rules`, and `swim_lanes.next_lane_id`. The per-user `boardPreferences` blob keys hidden lanes, widths and filters by lane id.
- The board titlebar (`<header class="titlebar">`, `src/views/BoardView.vue:1564`) acts as the app's menu bar. Its dropdowns use the `.filter-popover` pattern (`OpenInPicker.vue`, `MetricsPanel.vue`). "Filter tickets…" is at `BoardView.vue:1620`, first in `.board-filters`.

## Goal
A board can hold several named workflows. A workflow is a full set of lanes with every lane setting and agent prompt. The user switches the active workflow from a titlebar dropdown. The board's lanes change at once, and tickets are never lost.

## Requirements
- R1 Storage: add a new table `workflows (id TEXT, project_path TEXT REFERENCES projects(path) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL, lanes_json TEXT NOT NULL, PRIMARY KEY (project_path, id))` and a `projects.active_workflow_id TEXT` column via `ADDED_COLUMNS`. Both migrations only add.
- R2 Snapshot model: the active workflow's lanes stay the live `swim_lanes` rows, so all existing lane code keeps working. `lanes_json` holds the full lane rows (all columns, unassigned lane included) of each inactive workflow.
- R3 First run: a board with no workflow rows gets one named "Default", built from its current lanes and set active.
- R4 Swap: one transaction in a new repo fn plus a `workflow:activate` IPC handler. Steps in order:
  1. Snapshot the current `swim_lanes` rows into the active workflow's `lanes_json`.
  2. Delete the board's `swim_lanes` rows.
  3. Insert the target workflow's rows.
  4. Set `active_workflow_id`.
  The renderer then reloads the board.
- R5 Tickets on swap: never rewrite `tickets.lane_id`. A ticket whose lane is missing from the active workflow shows in the No status column until the user swaps back or moves it. Lanes keep their ids across workflows, so tickets in shared lanes such as `idea` stay put.
- R6 Dropdown: a titlebar `.filter-popover` button labeled with the active workflow's name. It lists all workflows (active one checked), then a divider, then "Create new Workflow".
- R7 Create new Workflow: ask for a name (inline input in the popover, required, unique on the board). It copies the current workflow's lanes with the same lane ids, saves it as a new workflow and activates it.
- R8 Title: show the active workflow's name as a label to the left of "Filter tickets…" in `.board-filters`.
- R9 Lane edits (create, update, reorder, delete, save agent markdown) keep writing `swim_lanes`. They belong to the active workflow and get snapshotted on the next swap.
- R10 Disable swapping while a lane agent or orchestrator for this board is running. Show a tooltip with the reason.

## Implementation notes
- Check how `getBoard` / `readBoards` treat a ticket whose `lane_id` matches no lane. R5 needs those tickets to land in No status, not vanish.
- The `swim_lanes` closes_ticket triggers fire when rows are inserted on swap (`swim_lanes_closed_at_on_flagged_insert`). Check that a swap doesn't re-stamp `closed_at`. `COALESCE(closed_at, …)` should keep existing values.
- Orchestrator polling and auto run read lanes from the live table, so after a swap they follow the new lanes without extra work.
- The `boardPreferences` blob is keyed by lane id, so shared ids keep their widths and hidden state. Leave it alone.
- Update `feature-map.md` §3 Board view: add a titlebar table row for the workflow dropdown and mention the workflow label in the filter bar notes. Update the README storage table with `workflows`.
- Add one test: a swap round trip (A → B → A) gives back identical `swim_lanes` rows and leaves every ticket's `lane_id` unchanged.

## Acceptance criteria
- [ ] An existing board opens with a "Default" workflow shown in the titlebar dropdown and as the label left of "Filter tickets…".
- [ ] "Create new Workflow" asks for a name, creates a copy of the current lanes, and makes it active. The dropdown and label show the new name.
- [ ] Changing lanes in the new workflow (rename, add, delete, change a prompt) and swapping back to Default restores Default's lanes and settings exactly.
- [ ] Swapping back again restores the edited workflow.
- [ ] Swaps never change any ticket's `lane_id`. Tickets in a lane the active workflow lacks show under No status.
- [ ] Workflows and the active choice survive an app restart.
- [ ] The dropdown is disabled with a tooltip while a lane agent or orchestrator runs on the board.
- [ ] `bun run test` and `bun run build` pass.

## Out of scope
- Renaming, deleting and reordering workflows. A follow-up ticket covers these.
- Per-user active workflow. The active workflow is board data shared by all members, like lanes.
- Importing or exporting workflows across boards, and built-in workflow templates.
- Remapping tickets between lanes on swap.

## Decisions
- "Menu bar" means the in-app board titlebar. The native Electron menu only has the standard App/File/Edit/View/Window menus.
- Snapshot table rather than a `workflow_id` column on `swim_lanes`. Changing the PK would be a migration that doesn't just add, and it would touch every lane query.
- A new workflow starts as a copy of the current one, not blank, so tickets keep their lanes.

## Open questions
None.
