# PRD — Ticket #69: Orchestrator agent should always open

## Problem
Auto Run skips the orchestrator tab when only one ticket runs. `buildOrchestratorLaunch` (`src/shared/projectTypes.ts:806`) returns `undefined` when `entries.length < 2`. A one-ticket run then gets no progress lines, no "needs you" detection, no final summary, and nothing closes the ticket tab when it is done.

## Code today (verified 2026-11-13 on `3a794ca`)
- `buildOrchestratorLaunch` — `src/shared/projectTypes.ts:805-814`. Comment on line 805 ("One ticket needs no watcher...") + guard `if (entries.length < 2) return undefined`. Return type `TerminalTab | undefined`
- Caller — `src/views/BoardView.vue:791`. Returns early on `launches.length === 0` (line 782), so the builder never sees 0 entries from here
- Store → main — `store.autoRunLane(..., orchestrator)` → `electron/main.ts:494` `orchestratorTab(orchestrator)`; `orchestratorTabs = orchestratorLaunch ? [orchestratorLaunch] : []`. Count-agnostic, no change needed
- Prompt — `orchestratorPrompt` (`projectTypes.ts:755`). Builds a ticket list, so one ticket reads as a one-item list. "Watch these tickets until each one is done" / "When every ticket is done" read fine for one ticket. No wording change needed
- Lane settings hint — `src/views/BoardView.vue:1554`: `Extra instructions for the Auto Run orchestrator (runs when 2+ tickets auto-run)`. Becomes wrong after this change (not listed in the ticket)
- Test — `src/shared/projectTypes.test.ts:1071` `sends no orchestrator for a one-ticket run` asserts `toBeUndefined()`

## Requirements
- R1. Remove the `entries.length < 2` guard and its comment in `buildOrchestratorLaunch`
- R2. Return type becomes `TerminalTab`. No 0-entry guard: the only caller already returns early on 0, and `autoRunLane` in main throws on an empty ticket list. Keep the store/IPC `orchestrator` parameter optional (main still validates it)
- R3. Hint at `BoardView.vue:1554` → `Extra instructions for the Auto Run orchestrator (runs on every Auto Run)`
- R4. Flip the test at `projectTypes.test.ts:1071`: rename to `sends an orchestrator for a one-ticket run`, assert title `AUTORUN-ORCHESTRATOR-IN-DEVELOPMENT` and that the command contains the one ticket's line (`#<N> <title>`)
- R5. Drop now-needless `?.` on `launch` in the neighbouring test (`launch?.title` → `launch.title`) since the result is no longer optional

## Acceptance criteria
- [ ] Auto Run with 1 selected ticket opens 2 tabs: the ticket tab + `AUTORUN-ORCHESTRATOR-<LANE>`
- [ ] That orchestrator's prompt lists the single ticket, closes its tab when done, prints the final summary
- [ ] Runs with 2+ tickets unchanged (existing tests pass untouched apart from R5)
- [ ] Lane settings hint no longer says "2+ tickets"
- [ ] `bun run test` and typecheck pass

## Out of scope
- Full-auto lane handoffs (`src/stores/projects.ts:460`) — still launch with no orchestrator at any ticket count
- Orchestrator prompt content changes

## Open questions
None

## Branch / worktree
- Branch: `t69-change-orchestrator-agent`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t69`
