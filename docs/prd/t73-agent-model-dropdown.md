# PRD — Ticket #73: Per-agent model dropdown

## Context
#72 added a model per agent (ticket, lane Auto Run, orchestrator). Every model field is a free-text `<input>` (`src/views/BoardView.vue`), so the user has to know and type exact ids (`opus`, `gpt-5-mini`, `anthropic/claude-sonnet-5-5`). The field already shows only when `agentTakesModel(agentId)` (`BoardView.vue:741`) is true, i.e. the agent has `modelArgs`.

`Agent` (`src/shared/projectTypes.ts:396`) knows *how* to pass a model (`modelArgs`) but not *which* models exist. Built-ins with `modelArgs`: Claude Code (`--model`, :412), Codex (`-m`, :422), opencode (`-m`, :446). Hermes has none → field hidden.

Switching agent already clears the model (#72, comment at `BoardView.vue:747`), so the suggestion list must follow the agent in effect for that field.

## Model fields (all get the dropdown)
| Where | Line | Agent in effect |
|---|---|---|
| Ticket modal — Model | ~1416 | `openTicket.agentId` |
| Auto Run confirm — Model | ~1518 | `autoRunConfirmAgentId` |
| Auto Run confirm — Orchestrator model | ~1530 | `autoRunConfirmOrchestratorAgentId \|\| autoRunConfirmAgentId` |
| Lane settings — Model | ~1638 | `openLane.autoRunAgentId` |
| Lane settings — Orchestrator model | ~1661 | `openLane.orchestratorAgentId ?? openLane.autoRunAgentId` |

The agent-id expression each field passes to `agentTakesModel` is exactly the one its list should use.

## Acceptance criteria
- Orchestrator model has a dropdown of models for the agent in effect. Claude Code offers Fable 5.2, Opus 5.5, etc. (from ticket)
- Orchestrator model (lane settings + Auto Run confirm) lists the effective orchestrator agent's models
- Changing the orchestrator agent switches the options to that agent's models (value cleared, as #72 already does)
- Orchestrator agent "Same as ticket agent" → options = the ticket/lane agent's models
- Ticket and lane Model fields use the same per-agent dropdown
- A model typed that isn't in the list still saves and runs (`agentModelWords` unchanged)
- Agent without `models` → plain input, no empty dropdown. Agent without `modelArgs` → field hidden (unchanged)
- Unit test: built-ins expose the expected `models`; a saved agent can declare its own

## Decisions
- D1. `Agent.models?: string[]` — suggested model ids. Saved agents can declare their own. A saved agent that shadows a built-in replaces it whole (existing `availableAgents` rule, `projectTypes.ts:455`), so its `models` replace the built-in's too
- D2. Built-in lists:
  - Claude Code: `fable`, `opus`, `sonnet`, `haiku`, `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`. Confirm the aliases against `claude --help` / Claude Code docs during dev
  - Codex, opencode: current ids taken from each CLI's docs during dev, not guessed. opencode ids are `provider/model`
  - Hermes: none (no `modelArgs`)
- D3. Native `<input list>` + `<datalist>`, not `<select>`. The browser shows a dropdown of suggestions and free text still works (new models, custom agents, opencode `provider/model`). No new dependency
- D4. One `<datalist id="agent-models-<agentId>">` per agent in `availableAgents` that has `models`, rendered once in the template. Each model input gets `:list="agentModelListId(agentId)"`, which returns the id or `undefined` when the agent has no models. Five `:list` bindings, one helper, no new component
- D5. Empty value = CLI default (unchanged). Orchestrator without its own agent keeps the "Same as ticket model" placeholder

## Requirements
- R1. `projectTypes.ts`: add `models?: string[]` to `Agent` + update the doc comment; add `models` to `DEFAULT_AGENT`, `CODEX_AGENT`, `OPENCODE_AGENT`
- R2. `BoardView.vue`: `agentModelListId(agentId?)` next to `agentTakesModel`, built on `findAgent(agents.value, agentId).models`
- R3. `BoardView.vue`: render the datalists (`v-for` over `agents` with `models?.length`); add `:list` to the five inputs, passing the same agent-id expression each already passes to `agentTakesModel`
- R4. `projectTypes.test.ts`: built-ins carry the expected `models`; saved agent with a built-in's id and its own `models` wins; Hermes has none

## Verification
- `bun run test` (or the repo's test script) + typecheck pass
- Manual in the app: open each of the 5 fields → dropdown shows the right agent's models; switch orchestrator agent → list changes, value clears; type an unlisted model → saved and passed to the CLI; pick Hermes → field hidden

## Out of scope
- Querying CLIs live for model lists (`claude`/`codex` have no stable list command) → hardcoded, updated when models ship
- Settings UI for editing an agent's models (edit the saved agent JSON for now)
- Model validation or rejecting unknown ids
- Hermes model support

## Open questions
None.

## Branch / worktree
- Branch: `t73-orchestrator-model-should`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t73`
- PRD file: `docs/prd/t73-agent-model-dropdown.md`
