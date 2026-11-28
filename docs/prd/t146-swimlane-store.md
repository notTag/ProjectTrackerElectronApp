# PRD — Ticket #146: Swimlane Store

## Work location
- Branch: `t146-swimlane-store`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t146`
- PRD file: `docs/prd/t146-swimlane-store.md`

## Dependency
- Blocked on #144 (Workflow modal). The "Swimlane Store" section lives inside that modal. Rebase onto `main` after #144 merges, before development starts.

## Context
- Workflows (#133) are snapshots: the active workflow's lanes are the live `swim_lanes` rows, inactive ones sit in `workflows.lanes_json` (`electron/storage/schema.ts:151`, `stateRepository.ts:617-676` `activateWorkflow` / `createWorkflow` / `ensureActiveWorkflow`).
- `swim_lanes` PK is `(project_path, id)`. A lane row holds every lane setting: name, agent + orchestrator prompts and file paths, output target, auto run (agent / terminal / model / worktrees), full auto, next lane, closes ticket, orchestrator agent / model / poll, PR-merge wait, graph position.
- Lane prompts also live on disk: `<project>/SwimlaneAgentPrompt/<lane>/AgentPrompt.md` and `AgentOrchestratorPrompt.md` (#81, `electron/agentMarkdown.ts`, IPC `lane:save-agent-markdown` `electron/ipcHandlers.ts:771`).
- Lane IPC: `lane:create|update|reorder|delete` (`ipcHandlers.ts:431-451`); workflow IPC: `workflow:activate|create` (`:457-463`); bridge list `src/shared/bridgeApi.ts:40`.
- Lane settings modal footer: `.modal-actions` in `src/views/BoardView.vue:2847` ("Delete lane" + "Done").
- No store or template concept exists yet. The only lane seed is `DEFAULT_LANE_NAMES` / `createDefaultBoard` in `src/shared/projectTypes.ts`.

## Goal
Save a configured lane once and reuse it: a global "Swimlane Store" of lane presets (settings + prompts) that can be added to the active workflow of any board.

## Requirements
- R1 Storage: new global table `lane_store (id TEXT PRIMARY KEY, lane_id TEXT NOT NULL, origin_project_path TEXT NOT NULL, name TEXT NOT NULL, lane_json TEXT NOT NULL, agent_markdown TEXT NOT NULL DEFAULT '', orchestrator_markdown TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`. `id` is the unique swimlane id.. Add-only migration. Not tied to a project.
- R2 Save to Store: a "Save to Store" button in the lane settings modal footer (`BoardView.vue:2847`), beside "Delete lane". Hidden for the unassigned (No status) lane.
  - Snapshots the lane row (all columns except `project_path`, `position`, `graph_position_json`) into `lane_json`.
  - Reads the lane's agent + orchestrator markdown files (if they exist) into `agent_markdown` / `orchestrator_markdown`.
  - Re-saving a lane from the same board (same origin project + `lane_id`) updates its entry; the same lane saved from another board is a separate entry, so presets never overwrite each other across boards.
  - Success hint "Saved to store" + inline error, same pattern as "Save to Agent Markdown".
- R3 Store section: in the #144 Workflow modal, a "Swimlane Store" section with a scrollable list of store entries (name, sorted by name). Empty state: "No saved swimlanes yet. Use "Save to Store" in a swimlane's settings."
- R4 Row buttons: each entry has `-` and `+` buttons on its right.
  - `-` → both buttons swap to one checkmark button (confirm delete). Checkmark deletes the store entry. Click elsewhere / Esc / blur reverts to `-` `+`.
  - `+` → both buttons swap to one checkmark button (confirm add). Checkmark adds the lane to the active workflow. Same revert rules.
  - Only one row in a confirm state at a time.
- R5 Add to active workflow: new IPC `lane-store:add` → one transaction:
  1. Insert the lane into `swim_lanes` for the board with its stored `lane_id`, at the last position.
  2. Clear `next_lane_id` if that lane isn't on the board.
  3. Clear `agent_file_path` / `orchestrator_file_path` (fall back to default `SwimlaneAgentPrompt/<lane>/` paths) and write the stored markdown there only when that file doesn't exist yet. Never overwrite an existing file.
  - Lands in the live lanes, so it belongs to the active workflow (#133 R9).
- R6 Conflict: `+` is disabled, with a tooltip "Already in this workflow", when the active workflow already has a lane with that `lane_id`.
- R7 Disable `+` while a lane agent or orchestrator for this board is running (same rule as workflow swap, #133 R10).
- R8 IPC: `lane-store:list`, `lane-store:save`, `lane-store:delete`, `lane-store:add`. Payload validation in `ipcHandlers.ts` like `lane:*`. Bridge + preload + `webBridge.ts` + `projectTrackerApi.ts` pass-through.

## Acceptance criteria
- [ ] "Save to Store" button in every lane settings modal except No status; saving creates or updates one store entry
- [ ] Workflow modal shows a "Swimlane Store" section listing saved lanes
- [ ] Each entry has `-` and `+` on the right
- [ ] `-` → checkmark → entry deleted; cancel reverts
- [ ] `+` → checkmark → lane (all settings + prompts) added to the active workflow; cancel reverts
- [ ] `+` disabled with reason when the lane id is already in the active workflow or an agent is running
- [ ] Added lane's markdown files written to `SwimlaneAgentPrompt/<lane>/` only when missing
- [ ] Store survives app restart and is shared across boards
- [ ] Tests: `stateRepository.test.ts` (save/overwrite/delete/add round-trip, `next_lane_id` cleared, migration adds table), IPC payload validation, component test for the `-`/`+` → checkmark states; `bun run test` + typecheck pass

## Out of scope
- Renaming store entries, editing them in place, reordering.
- Import/export of the store to files, sharing between users.
- Adding a whole workflow from the store (lanes only).
- Remapping tickets onto added lanes.

## Decisions (defaults, full auto)
- The ticket's last bullet says `+` confirms *deletion*. Treated as a copy-paste slip: `+` confirms *adding* the lane (matches the first bullet).
- Store is global, not per board. "Store" implies reuse across boards. Per-board would just duplicate workflows.
- Lane keeps its original id when added, so tickets parked in that lane id (#133 R5) reappear. A collision disables `+` instead of minting a new id.
- Prompts travel as markdown content, not file paths, since paths are project-relative.
- Save updates the entry for the same origin board + lane id; other boards get their own entry (user decision, replaces the earlier lane id + name rule).

## Open questions
- None.
