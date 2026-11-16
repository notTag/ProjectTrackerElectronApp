# PRD — Ticket #82: Save To Agent Orchestrator Markdown

## Problem
A lane's **Orchestrator prompt** (`swim_lanes.orchestrator_prompt`, #50) lives only in the DB. It can't be versioned with the repo, edited in an editor, or reviewed in a PR. The **Agent prompt** already has a file twin (#43): an "Agent markdown file" path plus a **Save to Agent Markdown** button. The orchestrator prompt needs the same pair.

## Goal
One click in the lane ⚙ modal writes the lane's Orchestrator prompt to a markdown file, links that file to the lane, and makes the orchestrator launch prompt point at it.

## Ownership vs #81
- #82 owns: `orchestratorFilePath` field, column, repo mapping, IPC, button + file input, prompt reference
- #81 owns: the directory layout (`SwimlaneAgentPrompt/<lane>/…`) and the shared default-path helper
- #81's PRD (`docs/prd/t81-swimlane-prompt-folders.md`, branch `t81-each-swimlane-s`) also lists the orchestrator button/field/column in its acceptance criteria. That overlaps this ticket. Per the #82 ticket text, the split above wins (D4). Whichever branch merges second drops its duplicate and rebases onto the other's code; it never ships a second column, channel or button

## User flow
1. Open ⚙ on any lane (including **No status**).
2. Type or edit the **Orchestrator prompt**.
3. Click **Save to Agent Orchestrator Markdown** (directly under that textarea).
4. Success → **Agent Orchestrator markdown file** shows the path; hint reads "Saved to <path>" or "Appended to <path>". Failure → inline error, DB untouched.

## Requirements

### R1 — Field + storage
- `SwimLane.orchestratorFilePath?: string` in `src/shared/projectTypes.ts` (next to `orchestratorPrompt?`, L226). Optional, so older lanes and fixtures load as empty
- `electron/storage/schema.ts`: `orchestrator_file_path TEXT NOT NULL DEFAULT ''` in the `swim_lanes` CREATE and an `ADDED_COLUMNS` entry (L147, same shape as `orchestrator_prompt` at L163)
- `electron/storage/stateRepository.ts`: row map (~L399, `orchestratorFilePath: String(row.orchestrator_file_path)`) and upsert column list + `excluded.` assignment (~L886-894)
- `electron/main.ts` `LANE_PATCH_FIELDS` (L258): add `orchestratorFilePath: true`. Not in `REQUIRED_TEXT_KEYS` (L267): the field is optional
- `LaneWritePatch` type picks it up from `SwimLane` (verify; add if it is an explicit pick list)

### R2 — UI (`src/views/BoardView.vue`)
- Under the Orchestrator prompt textarea (~L1731), mirror the Agent block (~L1690-1715):
  - Button **Save to Agent Orchestrator Markdown** (`Saving…` while in flight)
  - Disabled when the live orchestrator text is empty after trim, or a save is in flight
  - The textarea commits on `@change` (blur), so the live text must come from a draft ref synced on `@input`, not from `openLane.orchestratorPrompt`. The button sends the draft, not the last blurred value
  - Input **Agent Orchestrator markdown file**: `@input` → draft, `@change` → `editLane(openLane, { orchestratorFilePath })`
  - Hints: error (`field-error`) else saved message else a static hint naming the default path
- Own draft + status refs (`orchestratorMarkdownDraft`, `orchestratorMarkdownStatus`), reset on lane change the same way `laneMarkdownStatus` is (~L701-740). Reuse `ipcErrorMessage`
- Smallest diff: generalize the existing draft/status helpers by kind if that's shorter than a second copy; otherwise a parallel pair is fine

### R3 — Path resolution (`electron/agentMarkdown.ts`)
- Generalize `resolveAgentMarkdownPath` with `kind: 'agent' | 'orchestrator'`; don't copy it. The target carries one `filePath` (the explicit path for that kind)
- Explicit path → `path.resolve(projectPath, filePath)`, must end in `.md` (error text names the right field: "Agent Orchestrator markdown file must end in .md.")
- Empty → default from the same helper the agent kind uses:
  - #81 merged first: `<project>/SwimlaneAgentPrompt/<lane>/AgentOrchestratorPrompt.md`
  - #82 merges first: `<project>/agent-context/<PROJECT>-<LANE>-AgentOrchestratorContext.md` (add `orchestratorMarkdownFileName` next to `agentMarkdownFileName`, L648, sharing `fileNamePart`). #81 then moves both kinds together
- Sanitized lane names can't contain separators or leading dots, so a default path can't escape its directory

### R4 — IPC + bridge
- Add a `kind` field to the existing `lane:save-agent-markdown` channel (`electron/main.ts:834`) — smaller diff than a second channel, and the shape #81's PRD also picked
  - Main validates `kind` is exactly `'agent'` or `'orchestrator'`, else `Invalid save request.`
  - Keep every guard: `assertTrustedSender`, all-strings payload check, `assertScannedProjectPath`, project name from `stateRepository` (never the renderer), `isInsideAny(filePath, scanDirectories)`
  - Writes through `saveAgentMarkdown` unchanged: blank/missing file → write; existing content → append after a blank line; same text re-saved → no-op. Returns `{ filePath, appended }`
- Pass `kind` through `electron/preload.cts` (~L1303), `src/env.d.ts` (~L1387), `src/services/projectTrackerApi.ts` (~L1630). Existing agent caller passes `'agent'`
- Store: `saveLaneOrchestratorMarkdown(projectPath, lane, orchestratorPrompt, orchestratorFilePath)` next to `saveLaneAgentMarkdown` (`src/stores/projects.ts:315`), or one action with `kind` — pick the smaller diff

### R5 — Persist after write
- Only after the write resolves: one `updateLane` patch `{ orchestratorPrompt: <sent text>, orchestratorFilePath: saved.filePath }`
- Write fails → no `updateLane` call; field and DB unchanged

### R6 — Orchestrator prompt (`src/shared/projectTypes.ts`)
- `laneInstructionsSection` (L975): render when `orchestratorPrompt` OR `orchestratorFilePath` is set (both trimmed)
- Layout: `Lane instructions` / `LANE_INSTRUCTIONS_PRECEDENCE` / text (if any) / `Follow the guidance in <path>.` (if any). The precedence line stays, so a file can never override report-only
- Both empty → `orchestratorPrompt(...)` output byte-for-byte unchanged
- `ticketAgentPrompt` unchanged; `laneHasAgentWork` (L886) unchanged — an orchestrator file is not ticket agent work

### R7 — No status lane
- Works through the existing `unassignedLane` path (`updateLaneInBoard` → `upsertSwimLane` with `is_unassigned = 1`). No new repo method

## Tests
- `electron/agentMarkdown.test.ts`: orchestrator kind — default path (per layout that's on main when built), `../../etc` lane name stays inside the default dir, non-`.md` explicit path rejected, explicit relative path resolved against project; agent kind still produces today's path
- `src/shared/projectTypes.test.ts`: `orchestratorPrompt` with file only, text + file (order + precedence line), neither (unchanged output); `ticketAgentPrompt` unaffected by `orchestratorFilePath`
- `electron/storage/stateRepository.test.ts`: `orchestratorFilePath` round-trip on a normal lane and on the No status lane; a legacy DB without the column migrates to `''`
- `evals/static/lint.test.ts`: its per-file checks (non-empty, known lane ids, no real DB path) apply to orchestrator files too, so cover them, don't exclude. Pre-#81 the `agent-context/*.md` readdir already picks up `*-AgentOrchestratorContext.md`; post-#81 the glob must include `SwimlaneAgentPrompt/*/AgentOrchestratorPrompt.md` (likely already done by #81 — verify)
- `bun run test` + typecheck pass

## Docs
- `feature-map.md` §3.9 (L389): bullet under Orchestrator prompt for the button + file field, and that the orchestrator launch prompt references the file

## Acceptance criteria
- [ ] Lane modal shows **Save to Agent Orchestrator Markdown** + **Agent Orchestrator markdown file** under the Orchestrator prompt
- [ ] Button disabled for empty prompt / in-flight save; sends live textarea text
- [ ] Empty path → writes the default file (layout per #81 if merged), creates dirs, persists `orchestrator_file_path`
- [ ] Set path → writes there with #43 append rules; `.md` required; must be inside a scanned dir
- [ ] Failure shows inline error; DB untouched
- [ ] Orchestrator prompt references the file when set; output unchanged when neither set; ticket agent prompt unchanged
- [ ] Works on the No status lane
- [ ] Tests above; `feature-map.md` §3.9; eval lint covers orchestrator files
- [ ] `bun run test` passes
- [ ] App run on an isolated DB copy: save on a lane + No status, reopen modal, path persists, file on disk

## Out of scope
- Directory restructure + migrating existing files (#81)
- Two-way sync / importing a file back into the prompt
- Inlining file contents into the prompt (referenced by path, like the agent file)
- Save-all-lanes; git commit of the file

## Decisions (defaults, full auto)
- D1 Labels: "Save to Agent Orchestrator Markdown" / "Agent Orchestrator markdown file" (ticket title wording; #81 PRD's shorter label is superseded)
- D2 Reuse `saveAgentMarkdown` write semantics (append, idempotent re-save) for parity with #43
- D3 Build after #81 merges if possible; otherwise whichever lands second rebases onto the shared path helper
- D4 #82 owns the orchestrator field/storage/IPC/button even though #81's PRD lists them; if #81 already shipped any of it, #82 keeps that code and only fills gaps (labels, tests, lint, docs)
- D5 One IPC channel with `kind`, not a second channel

## Open questions
None — defaults D1–D5.

## Work tracking
- Branch: `t82-add-a-save`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t82`
- PRD file: `docs/prd/t82-save-orchestrator-markdown.md`
- Related: #81 (branch `t81-each-swimlane-s`, worktree `.worktrees/t81`, now In Development), #43, #50
