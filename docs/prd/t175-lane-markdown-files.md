# PRD — Ticket #175: Lane markdown files are additional context only (agent + orchestrator)

## Work location
- Branch: `t175-lane-markdown-files`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t175`
- PRD file: `docs/prd/t175-lane-markdown-files.md`

## Context
- #168 stopped the Orchestrator box from writing its file. The Agent box still autosaves into `SwimlaneAgentPrompt/<lane>/AgentPrompt.md`:
  - `scheduleAgentMarkdownSave` / `saveAgentMarkdown` / `flushMarkdownSave` `src/components/board/LaneSettingsModal.vue:~240-305` → `store.saveLaneMarkdown` `src/stores/projects.ts:397` → `lane:save-agent-markdown` `electron/ipcHandlers.ts:862` → `saveAgentMarkdown` `electron/agentMarkdown.ts:76`
- Ticket agent prompt: `ticketAgentPrompt` `src/shared/projectTypes.ts:687`. The file is never read: only `Follow the guidance in <path>.` when the box is empty (L692).
- Orchestrator pattern to copy:
  - `lane:read-orchestrator-context` `electron/ipcHandlers.ts:891-922`: resolve path → `realpathSync` → inside real scan dirs → `readOrchestratorContext` → `{ filePath, content }` or `null`
  - store `readLaneOrchestratorContext` `src/stores/projects.ts:404`, used at `src/views/BoardView.vue:393`
  - appended by `withAdditionalContext` `src/shared/projectTypes.ts:1349` as `Additional context (from <path>):`
- Ticket agent launch sites (all renderer, all call `ticketAgentPrompt` through `buildAutoRunLaunch` or directly):
  - Auto Run `src/views/BoardView.vue:382`
  - Full auto handoff `src/stores/projects.ts:796`
  - Ticket modal prompt `src/components/board/TicketModal.vue:348`
- `laneHasAgentWork` `src/shared/projectTypes.ts:1050` = `agentPrompt || agentFilePath`. Gates full auto handoff (L1441) and the orchestrator lane list "agent work: yes/no" (L1313). Once every lane has a default path this is always true → must change (R7).
- `resolveAgentMarkdownPath` `electron/agentMarkdown.ts:46`: `.md` only; re-derives app-generated paths from the current lane name (`isGeneratedPath`).
- `writeMissingLaneMarkdown` `electron/agentMarkdown.ts:96`: no-overwrite, but returns early on empty content.
- Lane Store save reads the agent file via `readLaneMarkdown` `electron/ipcHandlers.ts:524`.
- `TicketGraph.vue:366` shows "Also follows: <file>" whenever `agentFilePath` is set.

## Goal
The lane's markdown files are only ever extra context. The boxes save to the DB; the files are read, never written (except creating an empty one). A user can keep the instructions in the file alone.

## Requirements

### R1. Agent prompt box saves to DB only
- Typed text keeps the existing blur/commit path into the lane's `agentPrompt` (`commitTypedPrompts`, `lanePromptPatch`). No file write.
- Remove autosave:
  - `LaneSettingsModal.vue`: `scheduleAgentMarkdownSave`, `saveAgentMarkdown`, `pendingMarkdownSave`, `flushMarkdownSave`, `MARKDOWN_AUTOSAVE_DELAY_MS`, `agentMarkdownSavedKey`, `createLaneMarkdownSaveState` + `LaneMarkdownSaveState`, the `saveState` prop, the "Saved to <path>" status
  - `src/views/BoardView.vue:103,545` save-state creation + prop
  - `store.saveLaneMarkdown`, `projectTrackerApi.saveLaneMarkdown`, preload `saveLaneMarkdown` `electron/preload.cts:102`, `webBridge.ts:128`, `bridgeApi.ts:140`
  - `lane:save-agent-markdown` handler + `saveAgentMarkdown` + its tests (`electron/agentMarkdown.test.ts`, `electron/web/server.test.ts:252`)
- `onAgentFilePathChange` → just `editLane(lane, { agentFilePath })`.
- Keep whatever the error/status slot is still used for (path refused, see R3); drop the rest.

### R2. Agent file = additional context, read in main at launch
- Generalize the orchestrator read handler instead of copying it:
  - `lane:read-orchestrator-context` → `lane:read-markdown-context` with `{ kind: 'agent' | 'orchestrator', projectPath, laneName, filePath }`
  - same guards: `assertScannedProjectPath`, resolve, `realpathSync`, inside real scan dirs, else `null`
  - returns `{ filePath, content }` when content has text, else `null`
- Store: `readLaneMarkdownContext(projectPath, lane, kind)` replaces `readLaneOrchestratorContext`; never throws (failure → `undefined`, launch still runs).
- `TicketPromptContext` gets `agentFileContext?: { filePath: string; content: string }` (same shape as orchestrator's `OrchestratorAdditionalContext`, reuse the type).
- `ticketAgentPrompt` stays pure:
  - drop `laneFileReference` / "Follow the guidance in …"
  - right after the lane prompt (slot 2), add the file block via the existing `withAdditionalContext` header: `Additional context (from <path>):\n<content>`
  - box empty + file text → prompt starts with the file block only
  - file missing/blank → nothing added
- Launch sites read once per lane before building launches, pass into `promptContext`:
  - Auto Run `BoardView.vue:382` (already awaits the orchestrator read there — read both)
  - full auto handoff `stores/projects.ts:796` (per `toLane`)
  - `TicketModal.vue:348` (make the prompt build async)

### R3. `.md` and `.txt` accepted
- `resolveAgentMarkdownPath`: extension in `['.md', '.txt']`, error text `… must end in .md or .txt.`
- Scan-dir + realpath guard unchanged: typed paths outside scan dirs still refused (read → `null`).

### R4. Empty file created automatically, path shown
- `writeMissingLaneMarkdown`: allow `''` content (drop the `content === ''` early return). Still never overwrites (`existsSync`).
- New main helper `ensureLaneMarkdownFiles(projectPath, lane)` → for each kind whose field is empty: create the empty default file, return its absolute path; patch `agentFilePath` / `orchestratorFilePath` with it.
- Called from:
  - `lane:create` after `createSwimLane`
  - new IPC `lane:ensure-markdown-files` `{ projectPath, laneId }`, called when the Lane settings modal shows a lane (covers existing lanes); returns updated state
- Field typed by the user is never touched; an existing file is never overwritten.
- Stored path is used as typed: once the field holds a path, rename does not re-derive it (drop the `isGeneratedPath` re-derive for non-empty fields). Reason: re-deriving after rename points at a new empty file and silently drops the user's text in the old folder. Empty field still derives `SwimlaneAgentPrompt/<lane>/…`.
- `lane-store:add` keeps using `writeMissingLaneMarkdown` (now also writes the empty file when the entry has no markdown).

### R5. ⓘ info icons on both file labels
- Same ⓘ tooltip component as the prompt boxes (#102), right of the label text:
  - "Agent markdown file" `LaneSettingsModal.vue:399`
  - "Agent Orchestrator markdown file" `LaneSettingsModal.vue:492`
- Wording (both): "Additional context, added after the prompt at launch. It does not replace the prompt. .md or .txt."
- Update the Agent prompt ⓘ tip (`LaneSettingsModal.vue:56`): remove the autosave + "pointed at that file" sentences; say the file is extra context added after this text.

### R6. Old app-written copies skipped
- Shared pure helper in `projectTypes.ts`: `isAppWrittenPromptCopy(kind, content, lane)`
  - orchestrator: contains `{{ticket_numbers}}` (move existing check from `agentMarkdown.ts:65`)
  - agent: `content.trim() === lane.agentPrompt.trim()` and non-empty
- Agent check applied in `ticketAgentPrompt` (pure, covers every launch site) and in `lane-store:save` before storing agent markdown.
- Orchestrator check stays in main read.

### R7. "Agent work" no longer means "has a path"
- `laneHasAgentWork(lane, agentFileHasText?)` → `agentPrompt.trim() || agentFileHasText`.
- Full auto planner (L1441) and orchestrator lane list (L1313): caller passes a set of lane ids whose agent file has text, read via R2 before planning. Without it: prompt-only check.
- `TicketGraph.vue:366`: "Additional context: <file>" instead of "Also follows"; still shown when the path is set.

### R8. Docs + tests
- `feature-map.md`:
  - 3.x Agent section L469-474: drop "Autosave to markdown" block; describe DB save, file as extra context, empty default file, `.md`/`.txt`, ⓘ icon, path kept on rename
  - Orchestrator file L488: `.md`/`.txt`, empty file created, ⓘ icon
  - 4.4 prompt order L610: item 2 → `Additional context (from <path>):` + file text
- Tests:
  - `projectTypes.test.ts`: file appended after box text; box empty + file → only file block; blank context → nothing; agent copy equal to prompt → skipped; `laneHasAgentWork` with/without file text
  - `agentMarkdown.test.ts`: `.txt` accepted, `.sh` refused; `writeMissingLaneMarkdown('')` creates empty file; existing file not overwritten; stored path kept after rename
  - `ipcHandlers` / `server.test.ts`: `lane:read-markdown-context` agent kind reads file, outside scan dir → `null`; `lane:create` fills both paths and creates empty files; old save endpoint gone
  - evals snapshots: update for removed "Follow the guidance" line

## Out of scope
- Watching files for changes, previewing file content in the modal.
- Migrating/deleting old autosaved `AgentPrompt.md` files (R6 skip covers them).
- Writing files for lanes never created/opened (default-board lanes get files on first modal open).

## Acceptance (from ticket)
- Typing in the Agent box writes only the DB; no file write except the empty-file creation.
- File text appended after box text; file-only works; blank/missing file skipped, run starts.
- Empty default file per lane, path in the field, never overwritten, changeable.
- `.md` and `.txt` accepted; outside scan dirs refused.
- ⓘ icons on both file labels with the wording above.
- Orchestrator: DB save unchanged (#168), empty file + path + `.txt` + ⓘ.
- Old copies not added twice.
- Autosave code removed; feature-map + tests updated.

## Open questions
None
