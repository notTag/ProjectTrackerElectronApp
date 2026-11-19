## Context
BUG: When orch poll is infinite, the agent prompt needs to be updated to not loop.

Expected:
When the orch poll time is infinite, the agent prompt does not loop. It just waits for messages from other agents or completes it's task and stops.

Actual:
Currently, it's sets itself to loop every 1 minute when polling is infinite.

## Branch / worktree
- Branch: `t114-bug-when-orch`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t114`
- PRD: `docs/prd/t114-orchestrator-infinite-no-loop.md` (committed on the branch)

## Root cause
- `renderOrchestratorPrompt` (`src/shared/projectTypes.ts:1162`) always writes Loop step 1 as `every ${pollMinutes} minutes (sleep ${pollSeconds})`. It never checks `orchestratorPollActive(lane)`.
- At `∞` (`orchestratorPollActive: false`) `orchestratorPollMinutes` still returns the stored minutes (1 after stepping down from 1, see #101) → lane modal's Orchestrator prompt shows "every 1 minutes (sleep 60)" (screenshot).
- Today `∞` also means "no orchestrator" (`buildOrchestratorLaunch` returns `undefined` at `projectTypes.ts:1245`, #101 D1; tooltip "Off: Auto Run launches no Orchestrator agent for this lane."; confirm modal hides the Orchestrator section). The ticket redefines `∞` as "orchestrator runs, never polls".

## Fix
- `∞` = orchestrator launches, event-driven: no poll, no sleep loop.
- `renderOrchestratorPrompt`: branch Loop step 1 on `orchestratorPollActive(lane)`:
	- active → unchanged `1. On start, then every N minutes (sleep N*60), gather the state above.`
	- `∞` → `1. On start, gather the state above once. Then do not poll, sleep, loop or schedule wake-ups: end your turn and wait. Gather the state again only when a message from a ticket agent arrives.`
- Steps 2–5 unchanged; step 5 ("every ticket done → summary and exit") is the "completes its task and stops" path.
- `buildOrchestratorLaunch` (`projectTypes.ts:1245`): drop the `if (!orchestratorPollActive(lane)) return undefined` guard.
- `src/views/BoardView.vue`:
	- `orchestratorPollTooltip` (~1014) at `∞` → "The Orchestrator agent never polls: it waits for messages from the ticket agents."
	- Auto Run confirm modal: Orchestrator section (`v-if="orchestratorPollActive(autoRunConfirmLane)"` ~2295) always shown.
	- `∞` span `aria-label="Orchestrator off"` (~2465) → `"Orchestrator never polls"`; secondary text `'Orchestrator off'` (~2468) → `'Never polls'`.
- `steppedOrchestratorPoll` comment (`projectTypes.ts:1013`) "turns the orchestrator off" → "stops polling".
- `feature-map.md:459` tooltip sentence → new `∞` wording.
- No storage change, no migration: `∞` still ≡ `orchestratorPollActive: false`. Stepper logic unchanged.

## Tests (`src/shared/projectTypes.test.ts`)
- Replace "sends no orchestrator when the lane turned its orchestrator off" (~1741) → inactive lane returns a launch; prompt contains "do not poll", has no `sleep` and no `every 1 minutes`.
- Active lane prompt unchanged (`every N minutes (sleep N*60)`).
- `orchestratorPromptTemplate` for an inactive lane renders the wait step (modal preview).

## Acceptance criteria
- AC1. Lane at `∞`: Orchestrator prompt in the lane modal has no `every … minutes` / `sleep`; it says to wait for ticket-agent messages.
- AC2. Auto Run on a `∞` lane launches the orchestrator tab with that prompt; it gathers state once and then idles until a message arrives.
- AC3. Orchestrator exits after the final summary once every ticket is done (unchanged step 5).
- AC4. Lanes with a numeric poll behave exactly as before.
- AC5. Tooltip / aria text no longer says "off" for `∞`.
- AC6. `bun run test` + typecheck green.

## Pitfalls
- Lane prompt overrides (`orchestrator_prompt_override`) on In Development, Merge Request, In Dev Env contain their own hardcoded "every … (sleep …)" text. Overrides win over the template, so a `∞` lane with an override still loops until the user edits its text.
- No way left to launch Auto Run without an orchestrator. Accepted per ticket ("waits for messages"); a separate off switch can come back as its own ticket if wanted.
- Prompt line 2 says "never answer or message the ticket agents" — still correct: orchestrator only receives messages, it does not reply.

## Out of scope
- Rewriting existing lane prompt overrides / adding a `{{poll}}` token for them.
- A separate "orchestrator off" setting.

## Open questions
None
