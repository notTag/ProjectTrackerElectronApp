# PRD — Ticket #43: Save To Agent Markdown

## Problem
A lane's Agent prompt lives only in the DB (`swim_lanes.agent_prompt`). The Agent markdown file has to be written by hand and its path pasted into the lane settings modal. The guidance can't be versioned with the repo, edited in an editor, or used by agents running outside Project Tracker.

## Goal
One click in the lane settings modal writes the lane's Agent prompt to a markdown file in the project and links that file to the lane.

## Non-goals
- Two-way sync between the file and the DB
- Importing an existing markdown file into the prompt
- A "save all lanes" action
- Committing the file to git
- Changing how `ticketAgentPrompt` (`src/shared/projectTypes.ts:394`) combines prompt + file. Both are still sent; dedup is a separate ticket

## User flow
1. Open ⚙ on a lane (including **No status**).
2. Type or edit the **Agent prompt**.
3. Click **Save to Agent Markdown** (directly under the textarea).
4. On success, the **Agent markdown file** field shows the path and a hint reads "Saved to <path>". On failure, an inline error shows and nothing changes in the DB.

## Requirements

### R1 — Button
- Sits directly under the Agent prompt textarea in the lane settings modal (`src/views/BoardView.vue` ~L950).
- Disabled when the prompt is empty after trim.
- Disabled while a save is in flight, so a double-click can't write twice.
- The textarea commits on `@change` (blur), so the disabled state must come from the live textarea value and not from `openLane.agentPrompt`. Otherwise the button stays disabled while the user types a first prompt. Use a local ref synced on `@input`, or switch the textarea to `@input`.
- The button sends the textarea's current text. Don't rely on the blur `change` landing first.

### R2 — Target path
- **Field empty:** `<projectPath>/agent-context/<PROJECT>-<LANE>-AgentContext.md`
  - Create `agent-context/` with `mkdir({ recursive: true })`. An existing directory is used as-is.
- **Field set:** write to that path and overwrite the file. Create parent directories if they're missing.
  - Relative path → resolve against the project path.
  - Require a `.md` extension. Without one, an explicit path could overwrite any file the user can write, e.g. a `.zshrc`.

### R3 — Filename sanitizing (pure fn, shared)
- New `agentMarkdownFileName(projectName, laneName)` in `src/shared/projectTypes.ts`.
- Per part: trim → whitespace runs → `-` → strip `/ \ : * ? " < > |` → strip leading dots → collapse repeated `-` → trim `-`.
- Empty after sanitizing → fallback (`project` / `lane`), so the result is never `--AgentContext.md`.
- The real project name here is `ProjectTracker/electron-app`. Stripping `/` gives `ProjectTrackerelectron-app`. See open question Q4.

### R4 — Confinement (default path)
- Main process resolves the final path and asserts it's inside `<projectPath>/agent-context/`, using `path.resolve` + an `isInsideAny`-style check (`electron/main.ts:176`).
- The project path is validated with the existing `assertScannedProjectPath` (`electron/main.ts:179`).
- Main looks up the project name from `stateRepository` by path. Don't trust a renderer-supplied name.

### R5 — IPC
- New handler `lane:save-agent-markdown` in `electron/main.ts`, following the `project:read-readme` pattern:
  - `assertTrustedSender(event)`
  - validate payload types: `{ projectPath: string, laneName: string, agentFilePath: string, content: string }`
  - returns `{ filePath: string }` (absolute)
- Preload (`electron/preload.cts`): `saveLaneAgentMarkdown: (projectPath, laneName, agentFilePath, content) => invokePlain('lane:save-agent-markdown', {...})`.
- Add the type to `src/env.d.ts` and the `src/services/projectTrackerApi.ts` wrapper.
- The renderer never touches the filesystem.

### R6 — Persist
- Write the file first. Only on success call `editLane(openLane, { agentFilePath: filePath })`. That goes through `store.updateLane` → `updateLaneInBoard` → save → `writeBoardChanges` → `upsertSwimLane`.
- Also persist the prompt text being saved, if it differs from the stored one, in the same `updateLane` patch.
- **No status lane:** already handled by the existing path. `updateLaneInBoard` sets `board.unassignedLane`. `positionedLanes` emits it at position -1, and `upsertSwimLane` sets `is_unassigned = 1` when `id === UNASSIGNED_LANE_ID` (`electron/storage/stateRepository.ts:380`). No new repository method and no new table.

### R7 — Feedback
- Success: a hint under the file field reads "Saved to <path>". It clears when the modal closes.
- Failure: show the main-process error message inline (EACCES, ENOENT, not `.md`, outside the project). DB untouched.

## Tests
- `src/shared/projectTypes.test.ts`: `agentMarkdownFileName`
  - spaces → `-`
  - strips each forbidden char
  - `../` traversal in a lane name produces no path separators
  - empty → fallback
  - `ProjectTracker/electron-app` + `PRD` → expected name
- `electron/storage/stateRepository.test.ts`: saving a board whose `unassignedLane` has `agentFilePath` set, with no prior unassigned row, creates a row with `is_unassigned = 1` and that path. Reload returns it on `board.unassignedLane`.
- Optional: extract the path resolution + confinement into a small pure fn in `electron/` (like `ticketWorktree.ts`) and unit-test it there.
- `feature-map.md` §3.9: add the **Save to Agent Markdown** bullet under Agent prompt.

## Acceptance criteria
- [ ] Button under the Agent prompt textarea; disabled when the prompt is empty or a save is in flight
- [ ] Empty file field → writes `<project>/agent-context/<PROJECT>-<LANE>-AgentContext.md`, creates the dir if missing, sets and persists `agent_file_path`
- [ ] Set file field → overwrites that file, creates parents if missing
- [ ] Names sanitized per R3; the default path can't escape `agent-context/`
- [ ] Write happens in main via `lane:save-agent-markdown`, exposed in preload
- [ ] Saving from No status creates its `swim_lanes` row (`is_unassigned = 1`)
- [ ] Success shows the path; failure shows the error and leaves the DB unchanged
- [ ] Tests from the Tests section pass (`bun run test`); `feature-map.md` §3.9 updated

## Decisions (defaults taken from the ticket's open questions)
- Q1 directory = `agent-context/`
- Q2 overwrite silently (the button is an explicit action)
- Q3 the prompt is not cleared after saving

## Open questions
- Q4: the project name contains `/` (`ProjectTracker/electron-app`). Should `/` become `-` (`ProjectTracker-electron-app-…`) instead of being stripped? Recommend `-`, since it reads better. The ticket says strip.
- Q5: `.md` extension requirement on explicit paths (R2). This is a new constraint, not in the ticket. Keep it?

## Files touched
- `src/views/BoardView.vue` — button, live-prompt ref, hint/error
- `src/shared/projectTypes.ts` (+ test) — `agentMarkdownFileName`
- `electron/main.ts` — IPC handler
- `electron/preload.cts`, `src/env.d.ts`, `src/services/projectTrackerApi.ts` — bridge
- `electron/storage/stateRepository.test.ts` — unassigned-row test
- `feature-map.md` §3.9
