# PRD — Ticket #72: Separate orchestrator agent + per-agent model

## Context
One agent drives a whole Auto Run. `confirmAutoRunLane` (`src/views/BoardView.vue:771`) passes the dialog's single `agent` to `buildAutoRunLaunch` for every ticket and to `buildOrchestratorLaunch` (`src/shared/projectTypes.ts:806`), so the orchestrator (#47) always runs the same CLI as the ticket agents. No model can be picked anywhere: `agentShellCommand` (`projectTypes.ts:583`) and `runAgentHeadless` (`electron/agentRun.ts:47`) build `command + args + prompt` with no model flag.

Goal: a cheap/fast model (or a different CLI) watches tabs as orchestrator while a stronger one does the ticket work.

## Acceptance criteria (from ticket)
- Lane has an orchestrator agent setting beside its Auto Run agent. Absent = same as the ticket agent (today's behavior)
- Auto Run confirm dialog shows the orchestrator agent when 2+ tickets run, starts on the lane default, changeable for that run only (same pattern as `autoRunConfirmAgentId`)
- Ticket agent, lane Auto Run agent, orchestrator agent each take an optional model. Empty = no flag, same command as today
- Model reaches the CLI in all three paths: terminal (`agentShellCommand`), headless Run (`agentRun.ts`), Full auto handoffs (`src/stores/projects.ts:454`)
- Each `Agent` declares how it takes a model (`modelArgs`). No `modelArgs` → model field hidden
- New lane/ticket fields get SQLite columns with defaults; older rows load unchanged
- Unit tests in `projectTypes.test.ts`: flag added when set, omitted when empty, orchestrator falls back to ticket agent

## Code today (verified 2026-11-13 on `3a794ca`)
- `Agent` (`projectTypes.ts:386`): `id, name, command, headlessArgs, promptArgs?`. Built-ins (`:396-435`): `DEFAULT_AGENT` claude, `CODEX_AGENT`, `HERMES_AGENT` (prompt rides on `chat -q`), `OPENCODE_AGENT` (prompt rides on `--prompt`)
- `SwimLane.autoRunAgentId?` (`:229`), `orchestratorPrompt?` (`:226`). Column pattern: `auto_run_agent_id TEXT` / `orchestrator_prompt TEXT NOT NULL DEFAULT ''` in `electron/storage/schema.ts` `SCHEMA_SQL` + `ADDED_COLUMNS` (`:140`, `:154`). Lane upsert `stateRepository.ts:404-410`, row map `:548`
- `Ticket.agentId?` (`:303`) — **not persisted**: no `agent_id` column, not in the tickets `INSERT` (`stateRepository.ts:673`). A ticket's agent pick is lost on reload today. `state.agents` (saved custom agents) is not persisted either
- Ticket paths: `ticketCommand` (`BoardView.vue:735`) → `ticketShellCommand` → `agentShellCommand`; `runTicketAgent` (`BoardView.vue:832`) → `store.runTicketAgent(projectPath, ticket, agentId, prompt)` (`projects.ts:746`) → preload `ticket:run-agent` → `main.ts:527` resolves agent by id → `runAgentHeadless`
- Auto Run: `askToAutoRunLane` (`BoardView.vue:765`) seeds `autoRunConfirmAgentId`; dialog select at `:1463`; lane modal agent select at `:1562`
- Full auto: `startFullAutoHandoffs` (`projects.ts:441`) uses `toLane.autoRunAgentId`, calls `autoRunLane` with no orchestrator — so only the lane's Auto Run model matters there

## Decisions (defaults, no blockers)
- D1. `Agent.modelArgs?: string[]`. Built-ins:
	- Claude Code `['--model']`, Codex `['-m']`, opencode `['-m']` (opencode wants `provider/model`; free text covers it)
	- Hermes: none → field hidden. Its model flag is unverified; add later once checked
- D2. Model is free text. Trim; empty → no flag. Values starting with `-` are dropped (treated as empty) so a model can never read as another flag
- D3. Flag position, so it never splits a prompt flag from its value:
	- Terminal: `command, ...modelArgs, model, ...promptArgs, shellQuote(prompt)` — model `shellQuote`d like the prompt
	- Headless: `...headlessArgs, ...modelArgs, model, prompt` — argv array, no quoting needed
- D4. One helper, e.g. `agentModelWords(agent, model?) : string[]` → `[]` when no `modelArgs` or empty model. `agentShellCommand(agent, prompt, model?)` and `runAgentHeadless(agent, prompt, model, ...)` both use it
- D5. New fields
	- `SwimLane.autoRunModel?`, `SwimLane.orchestratorAgentId?`, `SwimLane.orchestratorModel?`
	- `Ticket.model?` and `Ticket.agentId` gets persisted too (a model with no saved agent is meaningless)
	- Columns: lanes `auto_run_model TEXT NOT NULL DEFAULT ''`, `orchestrator_agent_id TEXT`, `orchestrator_model TEXT NOT NULL DEFAULT ''`; tickets `agent_id TEXT`, `model TEXT NOT NULL DEFAULT ''`. Empty / NULL map to `undefined`
- D6. Orchestrator fallback, in one pure fn (e.g. `orchestratorAgentChoice`):
	- `orchestratorAgentId` set → that agent + `orchestratorModel`
	- absent → the run's ticket agent; model = `orchestratorModel` if set, else the run's ticket model (true "same as")
- D7. Confirm dialog: per-run agent + model for tickets (seeded from `autoRunAgentId` / `autoRunModel`), and when 2+ tickets would run, orchestrator agent + model (seeded via D6 from lane). Nothing saved to the lane. Model input hidden when the selected agent has no `modelArgs`; switching agent keeps the typed model only if the new agent takes one
- D8. Auto Run tickets use the lane's agent + model (as today with agent), not the ticket's own. The ticket's model covers its own Run / Open In buttons
- D9. Orchestrator only runs in a terminal tab → terminal path only

## Requirements
- R1. Types (`projectTypes.ts`): D1 + D5 fields; `modelArgs` on built-ins
- R2. Command building: D3/D4. `ticketShellCommand` + `buildAutoRunLaunch` take a model; `buildOrchestratorLaunch` takes agent + model (caller resolves via D6)
- R3. Headless: `store.runTicketAgent` + preload + `ticket:run-agent` payload gain `model?: string`. `main.ts` validates `typeof model === 'string'` (or absent), resolves agent by id as now, passes model to `runAgentHeadless`. Renderer still never picks a binary or raw args
- R4. Full auto: `startFullAutoHandoffs` passes `toLane.autoRunModel` to `buildAutoRunLaunch`
- R5. UI (`BoardView.vue`)
	- Ticket modal: model input beside agent select (`:1369`), saved via `editTicket(… { model })`
	- Lane modal: model input beside Auto Run agent (`:1562`); orchestrator agent select ("Same as ticket agent" option = absent) + model input
	- Confirm dialog: D7. Placeholder text "CLI default"
- R6. Storage: D5 columns in `SCHEMA_SQL` + `ADDED_COLUMNS`; upsert + row mapping in `stateRepository.ts`
- R7. Docs: `feature-map.md` — lane modal orchestrator agent/model, ticket modal model, confirm dialog
- R8. Tests
	- `projectTypes.test.ts`: model flag present when set (terminal, quoted; per built-in order incl. opencode `-m X --prompt 'p'`); omitted when empty/whitespace/`-`-prefixed; omitted for agent without `modelArgs`; orchestrator falls back to ticket agent + model; orchestrator override; Full auto launch carries lane model
	- `agentRun` (or main) arg building: model in argv before prompt
	- `stateRepository.test.ts`: new columns round-trip; older DB migrates to empty; ticket `agentId` now survives reload

## Out of scope
- Validating a model id before launch (CLI errors visibly in its tab)
- Model dropdown / `<datalist>` suggestions
- Per-lane model override for a ticket's own Run button
- Persisting `state.agents` (saved custom agents)
- Hermes model support

## Risks
- Persisting `Ticket.agentId` changes behavior: picks now stick across reloads (fixes an existing gap, but noticeable)
- A model valid for one CLI is bogus for another when the agent is switched; the CLI reports it in-tab

## Open questions
None. D5 (persisting ticket `agentId`) and D7 (per-run model fields in the dialog) are the main calls; easy to trim in review.

## Branch / worktree
- Branch: `t72-the-agent-for`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t72`
