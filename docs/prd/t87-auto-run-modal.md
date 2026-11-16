# PRD — Ticket #87: "Auto Run" Modal re-work

## Context
The Auto Run confirm dialog (▶ on a lane) starts the ticket model on "CLI default" whenever the lane has no saved model, and stacks the Orchestrator section's Agent and Model fields vertically. Goal: start Claude Code runs on Opus 5.5 and put the orchestrator fields on one row.

## Code today (verified 2026-11-16 on `f9a3efb`)
- `DEFAULT_AGENT` (`src/shared/projectTypes.ts:451`): `modelArgs: ['--model']`, `models` already includes `claude-opus-5-5` (`:463`). No `defaultModel` field on `Agent` yet. No agent validation/normalization exists, so a new optional field needs no sanitizer change
- `changeAutoRunConfirmAgent` (`src/views/BoardView.vue:833`): sets `autoRunConfirmModel = ''`; clears the orchestrator model only when the orchestrator follows the ticket agent
- `askToAutoRunLane` (`BoardView.vue:867`): `autoRunConfirmModel = lane.autoRunModel ?? ''`
- `confirmAutoRunLane` (`BoardView.vue:876`): reads `autoRunConfirmModel` and passes it to the launches. No change needed: the seeded default flows straight through to `--model`
- Dialog template (`BoardView.vue:1619-1650`): top `ModelField` with `placeholder="CLI default"`. `.auto-run-orchestrator` section holds two `<label>`s (Agent `<select>`, Model `ModelField`)
- CSS (`src/styles.css`): `.auto-run-orchestrator` (`:1682`) is `flex-direction: column`. `.auto-run-orchestrator label` (`:1352`) shares the column-label rule with the ticket/lane modals (caption above field). Keep that rule; only the two labels' container changes

## Acceptance criteria
- Orchestrator Agent + Model sit side by side on one row
- Top model starts on `claude-opus-5-5` for Claude Code when the lane has no saved model
- Lane's saved `autoRunModel` still wins
- Switching the top agent resets the model to the new agent's default (Claude Code → `claude-opus-5-5`; no default → empty / CLI default)
- Launched tickets run with `--model claude-opus-5-5` when the default was used
- Narrow window: orchestrator fields wrap instead of overflowing

## Decisions
- D1. `Agent.defaultModel?: string`, set to `'claude-opus-5-5'` on `DEFAULT_AGENT` only. Saved agents may declare their own. No special-casing of the `claude-code` id
- D2. Pinned id `claude-opus-5-5`, not the `opus` alias (alias drifts on next release)
- D3. Seeding
	- `askToAutoRunLane`: `lane.autoRunModel || agent.defaultModel || ''`, where `agent = findAgent(agents.value, lane.autoRunAgentId)` (reuse the lookup already on the line above)
	- `changeAutoRunConfirmAgent`: `findAgent(agents.value, autoRunConfirmAgentId.value).defaultModel ?? ''`
	- `||` not `??` for the lane value: an empty saved model means "none saved" and should fall back
	- "CLI default" stays selectable in `ModelField` so a run can still opt out
- D4. Orchestrator side effect (accepted): with orchestrator on "Same as ticket agent" and empty model, it follows the ticket model, so it now also runs `claude-opus-5-5`. Same as today's "Same as ticket model" semantics; no extra code
- D5. Layout = CSS only: wrap the two orchestrator `<label>`s in `<div class="auto-run-orchestrator-fields">` with `display: flex; flex-wrap: wrap; gap: 10px`; each label `flex: 1 1 12rem; min-width: 0` so they share the row and wrap when narrow. Eyebrow stays above the row
- D6. Dialog only. Lane settings, ticket modal, Full auto handoffs keep current model behavior

## Requirements
- R1. `projectTypes.ts`: `defaultModel?: string` on `Agent` with a one-line why-comment (model the dialog starts on when a lane saves none); `defaultModel: 'claude-opus-5-5'` on `DEFAULT_AGENT`
- R2. `BoardView.vue`: D3 in `askToAutoRunLane` + `changeAutoRunConfirmAgent`
- R3. `BoardView.vue` + `styles.css`: D5 wrapper + rules
- R4. Test, `projectTypes.test.ts`: `DEFAULT_AGENT.defaultModel === 'claude-opus-5-5'` and `DEFAULT_AGENT.models` contains it (guards a typo'd default the dropdown can't show)
- R5. `feature-map.md` 3.11 (`:453`): note the dialog starts on the agent's default model (Claude Code → Opus 5.5) unless the lane saves one, and the orchestrator Agent/Model sit on one row

## Verification
- `bun run test` + typecheck pass
- Manual, isolated DB copy (see memory: run app before merge)
	- Lane with no saved model → top model `claude-opus-5-5`
	- Lane with saved model → that model
	- Switch agent to Codex → empty / CLI default; back to Claude Code → `claude-opus-5-5`
	- Orchestrator Active → Agent + Model on one row; shrink window → wraps, no horizontal overflow
	- Launch → tab command contains `--model claude-opus-5-5`

## Out of scope
- Default models in lane settings, ticket modal, Full auto handoffs
- Defaults for Codex / opencode / Hermes
- Removing "CLI default"
- Rest of the dialog (terminal row, worktree hint)

## Open questions
None.

## Branch / worktree
- Branch: `t87-auto-run-modal`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t87`
