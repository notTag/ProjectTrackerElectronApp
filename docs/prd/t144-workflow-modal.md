# t144 — Workflow title opens a Workflows modal

## Work location
- Branch: `t144-when-clicking-the`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t144`
- PRD: `docs/prd/t144-workflow-modal.md`

## Context
- #133 added workflows: `workflows` table + `projects.active_workflow_id` (`electron/storage/schema.ts:151`), swap/create in `stateRepository.ts` (`ensureActiveWorkflow` :667, `insertWorkflowRow` :682), store actions `activateWorkflow` / `createWorkflow` (`src/stores/projects.ts`).
- Titlebar dropdown: `src/components/WorkflowPicker.vue` (list, active ✓, inline "Create new Workflow" name form, disabled while agents run).
- Workflow title: `<span class="workflow-label">` left of "Filter tickets…" (`src/views/BoardView.vue:1645`, style `src/styles.css:1125`). Today it is plain text.
- "Drag or paste images here" box: `.image-dropzone` + `.image-dropzone-plus` (`src/styles.css:1982-2006`, used at `BoardView.vue:2042,2261`). `2px dashed var(--color-border)`, 8px radius, muted text, big `+`.
- Default name: `DEFAULT_WORKFLOW_NAME = 'Default'` (`src/shared/projectTypes.ts:1564`). Used for the virtual fallback in `boardWorkflows` (:1567) and for the row stored on first swap/create (`stateRepository.ts:675`). Existing boards may already have a stored `workflows` row `id = 'default', name = 'Default'`.
- Modals use `.modal-backdrop` > `section.modal` (e.g. `BoardView.vue:1911`), closed on backdrop click / Escape.

## Goal
Clicking the workflow title opens a modal to browse, switch and create workflows. The built-in workflow is called "Development Workflow".

## Requirements
- R1 Trigger: make `.workflow-label` a button (same look, pointer cursor, focus ring). Click opens the Workflows modal.
- R2 Modal: new `src/components/WorkflowsModal.vue`, standard `.modal-backdrop` / `section.modal` pattern. Title "Workflows". Closes on backdrop click, Escape and a Close button.
- R3 List: scrollable list of the board's workflows (`boardWorkflows(board)`), order by position. Active one marked ✓. List body has `max-height` + `overflow-y: auto`, so the modal never grows past the viewport.
- R4 Switch: clicking a non-active workflow calls `store.activateWorkflow` and closes the modal. Same rule as the picker: disabled with the "agent or orchestrator running" tooltip while `store.boardAgentsRunning(projectPath)`.
- R5 Create tile: last item under the list, a full-width `+` tile styled like `.image-dropzone` but with a solid border (`2px solid var(--color-border)`). Label "Create new Workflow". Reuse the dropzone rules: add a `.create-tile` modifier that only swaps `border-style`, don't copy the CSS.
- R6 Create flow: clicking the tile swaps it for an inline name input + Create button. Same validation as `WorkflowPicker.vue` (required, unique case-insensitive). Submit calls `store.createWorkflow`, which copies current lanes and makes the copy active. Extract the name validation into a small shared helper (e.g. in `projectTypes.ts`) so picker and modal use one copy.
- R7 Rename default: `DEFAULT_WORKFLOW_NAME = 'Development Workflow'`. Add an idempotent startup migration: `UPDATE workflows SET name = 'Development Workflow' WHERE id = 'default' AND name = 'Default' AND NOT EXISTS (SELECT 1 FROM workflows w2 WHERE w2.project_path = workflows.project_path AND w2.name = 'Development Workflow')`.
- R8 Leave the titlebar `WorkflowPicker` dropdown as is.

## Implementation notes
- Update tests that assert `'Default'` (`electron/storage/stateRepository.test.ts:423`, `src/shared/projectTypes.test.ts:357`). Add one test for the R7 migration: a stored `Default` row becomes `Development Workflow`, and a board that already has a `Development Workflow` keeps its `Default` row.
- `feature-map.md` §3.1: change "every board starts with **Default**" to **Development Workflow**, and add the clickable workflow label + modal to the filter bar notes.

## Acceptance criteria
- [ ] Clicking the workflow title left of "Filter tickets…" opens the Workflows modal.
- [ ] The modal lists every workflow in a scrollable list, active one checked. With many workflows the list scrolls and the modal stays inside the window.
- [ ] Clicking another workflow switches to it and closes the modal. Switching is disabled with a tooltip while an agent runs.
- [ ] A "Create new Workflow" tile sits below the list. It looks like the "Drag or paste images here" box with a solid border.
- [ ] The tile asks for a name (required, unique), creates the workflow from the current lanes, and makes it active.
- [ ] New and existing boards show "Development Workflow" where they used to show "Default". A board that already has a "Development Workflow" keeps its "Default" name.
- [ ] Escape, backdrop click and Close dismiss the modal.
- [ ] `bun run test` and `bun run build` pass.

## Out of scope
- Renaming, deleting and reordering workflows (follow-up from #133).
- Changing the titlebar `WorkflowPicker` dropdown.
- Per-workflow descriptions or metadata.

## Decisions
- "Workflow title" = the `.workflow-label` text left of "Filter tickets…" (#133 R8 calls it the title). The titlebar picker already opens a dropdown, so it stays.
- Rename by data migration, keyed on `id = 'default'`, so only the built-in workflow changes, never a user-created one. Skipped when the name would clash.
- Create in the modal uses an inline name field, like the picker. No second modal.
