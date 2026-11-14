# PRD — Ticket #64: Orchestrator poll value field in each swimlane

## Context
Auto Run opens an orchestrator agent tab (`AUTORUN-ORCHESTRATOR-<LANE>`) that watches the run's tickets (#47). Its poll rate is hard-coded at 60 seconds in the generated prompt. The only way to change it is free text in the lane's "Orchestrator prompt" (#50). There is no way to turn the orchestrator off for a lane.

## Acceptance criteria
- The rate an orchestrator polls at comes from a value on each swimlane. Default: every 2 minutes.
- An "Active" checkbox next to the poll rate decides whether that lane uses an orchestrator at all.
- Lane cog modal: "Orchestrator poll (minutes)" number input + "Active" checkbox on one row, directly under the Orchestrator prompt textarea.
- New and existing lanes default to 2 minutes, Active checked. Values save on change and survive an app restart.
- Generated orchestrator prompt Loop line uses the lane value: `every <N> minutes (sleep <N*60>)`.
- Active unchecked → that lane's Auto Run launches no orchestrator tab (ticket tabs unchanged). Poll input disabled while unchecked.
- Invalid input (empty, 0, negative, non-integer) is not saved; field shows the stored value again.
- `bun run test` and typecheck pass.

## Code today (verified 2026-11-13 on `3a794ca`)
- `SwimLane` (`src/shared/projectTypes.ts:241` area): optional fields, absent = default. Last one is `agentSetsVersion?: boolean`
- Getter pattern: `autoRunUsesWorktrees` (`projectTypes.ts:656`) resolves an absent field to its default
- Prompt: Loop step 1 (`projectTypes.ts:791`) → `'1. On start, then every 60 seconds (sleep 60), gather the state above.'`
- `LANE_INSTRUCTIONS_PRECEDENCE` (`projectTypes.ts:745`) → `'These override the Loop above (e.g. poll interval, closing tabs), but never the report-only rule.'` Comment above it (`:743`) also says "poll interval"
- `buildOrchestratorLaunch` (`projectTypes.ts:806`): returns `undefined` when `entries.length < 2`, else `{ command, title }`
- Caller: `BoardView.vue:791` → `store.autoRunLane(..., orchestrator)`; `undefined` already means "no orchestrator tab", so no store change needed
- Storage: column `agent_sets_version` in `SCHEMA_SQL` (`electron/storage/schema.ts:69`) + `ADDED_COLUMNS` (`:157`); upsert column list `stateRepository.ts:404`, `excluded.` update `:412`, value `:425`, row mapping `:552` (`asBool`)
- Lane modal: Orchestrator prompt textarea `BoardView.vue:1546-1555`, placeholder `"e.g. Poll every 2 minutes. Flag PRs with failing checks."`, hint `"Extra instructions for the Auto Run orchestrator (runs when 2+ tickets auto-run)"`
- `editLane(lane, patch)` (`BoardView.vue:648`): saves a partial lane patch
- Tests: `projectTypes.test.ts:1070` `describe('buildOrchestratorLaunch')`; prompt-override tests at `:1045-1066` use `'Poll every 2 minutes.'` as sample text; `stateRepository.test.ts:43,116-126,193-207` cover lane round-trip + older-DB migration for `agentSetsVersion`

## Decisions (defaults, no blockers)
- D1. Two optional lane fields: `orchestratorPollMinutes?: number` (absent → 2), `orchestratorPollActive?: boolean` (absent → true). Export `DEFAULT_ORCHESTRATOR_POLL_MINUTES = 2` and getters `orchestratorPollMinutes(lane)` / `orchestratorPollActive(lane)`, same shape as `autoRunUsesWorktrees`.
- D2. Storage columns: `orchestrator_poll_minutes INTEGER NOT NULL DEFAULT 2`, `orchestrator_poll_active INTEGER NOT NULL DEFAULT 1`. Existing DBs pick up defaults via `ADDED_COLUMNS` → existing lanes get 2 / active with no data migration.
- D3. Whole minutes only, min 1. Native `<input type="number" min="1" step="1">`. Validation in the `@change` handler before `editLane`: `Number.isInteger(value) && value >= 1`, else reset `input.value` to the stored value and skip the save. Storage trusts its caller (same as other lane fields).
- D4. Prompt line: `` `1. On start, then every ${minutes} minutes (sleep ${minutes * 60}), gather the state above.` `` Always "minutes", even for 1 ("every 1 minutes") — skip the plural branch; reads fine to an agent.
- D5. The poll field now owns the interval: drop "poll interval" from `LANE_INSTRUCTIONS_PRECEDENCE` (keep "e.g. closing tabs") and its comment; change the textarea placeholder to `"e.g. Flag PRs with failing checks."`. Free-text prompt can still override the Loop — not blocked, just no longer advertised.
- D6. Inactive check goes first in `buildOrchestratorLaunch`, before the `entries.length < 2` guard. #69 (one-ticket runs) will touch that guard; keeping the Active check on its own line above it lets both merge cleanly.
- D7. Which lane's value: the lane whose Auto Run button started the run (same rule as #50 D5) — already the `lane` passed to `buildOrchestratorLaunch`.
- D8. Inactive state keeps the stored minutes; the input is `:disabled` only. Re-checking Active restores the old value.
- D9. Textarea hint stays; row placement is under the textarea, above the "Auto Run" section, wrapped in one flex row (`label` + `label.checkbox-label`).

## Implementation steps
1. `projectTypes.ts`: add the two `SwimLane` fields, constant, getters; use the minutes getter in Loop step 1; early-return `undefined` in `buildOrchestratorLaunch` when inactive; edit `LANE_INSTRUCTIONS_PRECEDENCE` text + comment.
2. `schema.ts`: two columns in `SCHEMA_SQL` swim_lanes + two `ADDED_COLUMNS` entries.
3. `stateRepository.ts`: add both to upsert column list, placeholders, `excluded.` updates, values (`orchestratorPollMinutes(lane)`, active `? 1 : 0`), row mapping (`Number(row.orchestrator_poll_minutes)`, `asBool(row.orchestrator_poll_active)`).
4. `BoardView.vue`: new row under the Orchestrator prompt textarea; number input `:value="orchestratorPollMinutes(openLane)"` `:disabled="!orchestratorPollActive(openLane)"`; checkbox `:checked="orchestratorPollActive(openLane)"` → `editLane(openLane, { orchestratorPollActive: checked })`; update placeholder.
5. Tests (below), then `bun run test` + typecheck.

## Tests
- `projectTypes.test.ts`
  - Default lane → prompt contains `every 2 minutes (sleep 120)`, no `sleep 60`
  - `orchestratorPollMinutes: 5` → `every 5 minutes (sleep 300)`
  - `orchestratorPollActive: false` with 2+ entries → `buildOrchestratorLaunch` returns `undefined`
  - Precedence text no longer contains "poll interval"
- `stateRepository.test.ts`
  - Both columns round-trip (e.g. 5 / false)
  - Older DB with both columns dropped → lanes load as 2 / active

## Out of scope
- Seconds or sub-minute polling
- App-side polling (orchestrator stays an agent, #47 D1)
- Changing a running orchestrator's rate
- Orchestrators for full-auto handoffs (`src/stores/projects.ts:460`)
- One-ticket runs getting an orchestrator — #69

## Open questions
None

## Branch / worktree
- Branch: `t64-add-an-orchestrator`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t64`
