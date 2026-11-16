# PRD — Ticket #81: Per-swimlane prompt folder

## Context
- "Save to Agent Markdown" (#43) writes the default file flat: `<project>/agent-context/<PROJECT>-<LANE>-AgentContext.md`
  - `resolveAgentMarkdownPath` — `electron/agentMarkdown.ts:18`
  - `agentMarkdownFileName` — `src/shared/projectTypes.ts:648`; `AGENT_CONTEXT_DIRECTORY` — `:635`; sanitizer `fileNamePart` — `:640`
  - IPC `lane:save-agent-markdown` — `electron/main.ts:834` (project name from main's state; path confined to scan dirs); preload `electron/preload.cts:80`
- Orchestrator prompt (#50) is DB-only (`swim_lanes.orchestrator_prompt`), appended inline by `laneInstructionsSection` (`projectTypes.ts:974`). No file, no save button.
- Goal: one folder per lane holding both prompts, so a lane's guidance is versionable + editable together:
  - `SwimlaneAgentPrompt/<SWIMLANE_TITLE>/AgentPrompt.md`
  - `SwimlaneAgentPrompt/<SWIMLANE_TITLE>/AgentOrchestratorPrompt.md`

## Acceptance criteria
- [ ] Default agent file path (field empty) = `<project>/SwimlaneAgentPrompt/<lane>/AgentPrompt.md`; dirs created recursively (`saveAgentMarkdown` already `mkdirSync({recursive:true})`), existing dirs used as-is
- [ ] `<lane>` = lane name through existing `fileNamePart` rules (spaces/`/`/`\` → `-`, forbidden chars + leading dots stripped, fallback `lane`); no project prefix
- [ ] Lane cog modal: "Save to Orchestrator Markdown" button under the Orchestrator prompt textarea + "Orchestrator markdown file" field; same behavior as the agent pair (disabled when empty / in flight, success hint, inline error, DB untouched on failure)
- [ ] Default orchestrator file path = `<project>/SwimlaneAgentPrompt/<lane>/AgentOrchestratorPrompt.md`
- [ ] New `SwimLane.orchestratorFilePath?: string`; column `orchestrator_file_path TEXT NOT NULL DEFAULT ''` via `ADDED_COLUMNS`; round-trips through `stateRepository` upsert (`:650`) + row mapper (`:161`); old DB migrates to `''`
- [ ] `orchestratorPrompt(...)` Lane instructions section adds `Follow the guidance in <path>.` when the file path is set; empty text + empty path → output byte-for-byte unchanged
- [ ] Default paths can't escape `<project>/SwimlaneAgentPrompt/`; explicit paths still require `.md` + scanned-dir confinement
- [ ] Existing explicit `agent_file_path` values (e.g. `.../agent-context/...-PRD-AgentContext.md`) keep working untouched
- [ ] Unassigned (No status) lane gets both
- [ ] Tests: `agentMarkdown.test.ts` new default paths + traversal (`../../etc` lane name stays inside); `projectTypes.test.ts` orchestrator file reference + unchanged-when-empty; `stateRepository.test.ts` column round-trip + legacy migration; `bun run test` + typecheck pass
- [ ] Field hint text updated (`agent-context/` → `SwimlaneAgentPrompt/<lane>/`); `feature-map.md` §3.9 updated

## Implementation notes
- Generalize, don't duplicate: `resolveAgentMarkdownPath` target gets `kind: 'agent' | 'orchestrator'` → `AgentPrompt.md` / `AgentOrchestratorPrompt.md`; the explicit path comes from `agentFilePath` or `orchestratorFilePath` per kind (one `filePath` field on the target is simplest)
- `saveAgentMarkdown` reused as-is (append-not-overwrite, idempotent re-save)
- IPC payload adds `kind`; main validates it is exactly `'agent'` or `'orchestrator'`, else `Invalid save request.`; preload / `env.d.ts` / api wrapper pass it through
- Replace `AGENT_CONTEXT_DIRECTORY` with `SWIMLANE_PROMPT_DIRECTORY = 'SwimlaneAgentPrompt'`; `agentMarkdownFileName(project, lane)` → `laneFolderName(laneName)`; `projectName` drops out of the target (main no longer needs it for the path, still needs the project lookup for the "Unknown project" guard)
- `laneHasAgentWork` unchanged (orchestrator file is not agent work)
- Orchestrator file line goes inside `laneInstructionsSection`: section renders when text OR path is set; reference line after the text

## Decisions (defaults, full auto)
- D1 Root dir literally `SwimlaneAgentPrompt/` (per ticket), replaces `agent-context/` for new saves
- D2 No auto-migration of existing `agent-context/` files or DB paths; explicit paths win. Moving this repo's 7 files = separate chore
- D3 Lane rename → path stays pinned: the first save stores the absolute default path in `agentFilePath`, so later saves keep the old folder. Clear the field to re-derive from the new name
- D4 Orchestrator file referenced, not inlined — same as agent file in `ticketAgentPrompt`
- D5 (2026-11-16, agreed with the #82 agent) Orchestrator half moves to #82: `orchestratorFilePath` field + column, IPC `kind`, button/field, `orchestratorPrompt` file reference. #81 ships the folder layout + shared helpers (`SWIMLANE_PROMPT_DIRECTORY`, `AGENT_PROMPT_FILE_NAME`, `ORCHESTRATOR_PROMPT_FILE_NAME`, `laneFolderName`, `resolveAgentMarkdownPath({ filePath, fileName })`) that #82 plugs into

## Out of scope
- Migrating/moving existing `agent-context/` files
- Two-way file ↔ DB sync, importing files into prompts
- "Save all lanes" action
- Committing files to git

## Open questions
None — defaults D1–D5. Orchestrator ACs above (button/field, default orchestrator path, `orchestratorFilePath` column, `orchestratorPrompt` reference, their tests) ship in #82 per D5.

## Branch / worktree
- Branch: `t81-each-swimlane-s`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t81`
- PRD file: `docs/prd/t81-swimlane-prompt-folders.md`
