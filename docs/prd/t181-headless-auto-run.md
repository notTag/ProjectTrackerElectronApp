# PRD — Ticket #181: Headless option in the Auto Run dropdown

## Problem

The Auto Run confirm dialog ("Each opens in its own [Ghostty] tab.") only lists
terminals (Warp / Terminal / Ghostty / iTerm2). Running a lane's tickets
always opens N terminal tabs plus an orchestrator tab. There is no way to run
them in the background, even though single tickets already run headless via
the ticket modal's Run button.

## Goal

Add **Headless** to that dropdown. Picking it runs every runnable ticket in the
lane as a background headless agent run — the same path as a ticket's Run
button — with no terminal tabs and no orchestrator.

## Current code (verified on `main` @ 9ba09e7)

| Piece | Location | Notes |
|---|---|---|
| Dropdown | `src/components/board/AutoRunConfirmModal.vue:86-94` | options = `TERMINAL_TARGETS`; picks emitted as `AutoRunPicks.terminalId` |
| Terminal list | `src/shared/openInTargets.ts:30` | `TERMINAL_TARGETS` also used as main-process allowlist — do **not** add Headless there |
| Confirm handler | `src/views/BoardView.vue:371` `confirmAutoRunLane` | resolves terminal, builds launches (`buildAutoRunLaunch`), orchestrator, calls `store.autoRunLane` |
| Lane launch | `src/stores/projects.ts:1119` `autoRunLane` | `autoRunning[runKey]` guard, writes `mode: 'terminal'` agentRun, IPC `lane:auto-run`, records branch/worktree placement |
| Main lane launch | `electron/ipcHandlers.ts:628` `'lane:auto-run'` | worktree loop: `repositoryRootOf` → `freshMainRef` → `ensureTicketWorktree` (sequential), then opens tabs |
| Single headless run | `src/stores/projects.ts:1242` `runTicketAgent` | writes `mode: 'headless'` running record, IPC `ticket:run-agent`, saves result (`succeeded` → move-on-complete) |
| Main headless run | `electron/ipcHandlers.ts:672` `'ticket:run-agent'` | runs in `assertScannedProjectPath(projectPath)` only — no cwd param; model comes from payload |
| Prompt for headless | `TicketModal.vue:348` | `ticketAgentPrompt(ticket, lane, promptContext(ticket))` — raw prompt, not the shell command `buildAutoRunLaunch` produces |

## Requirements

- **R1 — Dropdown.** "Headless" is listed after the terminals (value e.g.
  `'headless'`, a renderer-only sentinel). When picked, the sentence reads
  "Each runs headless in the background." instead of "Each opens in its own … tab."
- **R2 — Launch.** Headless pick → each runnable ticket runs through the
  headless path with the lane prompt (`ticketAgentPrompt`), the dialog's chosen
  agent **and model** (not `ticket.model`), and a `mode: 'headless'` agentRun
  record. No terminal tabs.
- **R3 — No orchestrator.** Orchestrator section hidden (or disabled) while
  Headless is picked; no orchestrator launch is built.
- **R4 — Worktrees.** Lane worktree setting (`autoRunUsesWorktrees(lane)`)
  honored: with worktrees on, each ticket gets `.worktrees/tN` on its ticket
  branch (same `ensureTicketWorktree` + `freshMainRef` logic, sequential), its
  `branchName` / `worktreePath` recorded on the ticket, and the run executes
  there (`agentRun.cwd` = worktree path).
- **R5 — Guards + notices.** Same filter/selection narrowing (`autoRunSplit`),
  skipped-ticket notice, selected-ticket unchecking, and `autoRunning` double-
  launch guard as terminal Auto Run. Start notice:
  "Auto Run started N headless run(s)[, one worktree each]." Per-ticket
  "Agent running on #N…" notices must not clobber it.
- **R6 — Results.** Each ticket ends like a manual Run: running badge →
  succeeded/failed, last-run output saved, move-on-complete fires on success.
- **R7 — Scope of choice.** Per-run pick only. Lane default terminal
  (`autoRunTerminalId`, Lane Settings) and full-auto handoffs unchanged.

## Design (minimal)

1. **Main: cwd on `ticket:run-agent`.** Optional `cwd` in payload. Validate:
   must equal the normalized project path or be a directory under
   `<repositoryRoot>/.worktrees/` (use `ticketWorktreePath` /
   `TICKET_WORKTREE_DIRECTORY`). Reject anything else — renderer input is
   untrusted. Default = project path (existing behavior).
2. **Main: worktree prep without tabs.** Extract the worktree loop from
   `'lane:auto-run'` into a helper and expose it as a new IPC
   (e.g. `lane:prepare-worktrees`, payload `{ projectPath, tickets: [{ number, branchName }] }`
   → `{ worktreePaths }`). `'lane:auto-run'` calls the same helper. Wire through
   `bridgeApi.ts`, `preload.cts`, `projectTrackerApi.ts`, `webBridge.ts`.
3. **Store: `runTicketAgent` options.** Add optional `{ model, cwd }` so the
   auto-run path passes the dialog's model and the worktree cwd; record
   `cwd` in the running record. Manual Run unchanged.
4. **Store: `autoRunLaneHeadless(path, laneId, entries, useWorktrees)`.**
   Takes the `autoRunning` guard → (worktrees on) prepare worktrees, record
   branch/worktree placement → set aggregate notice → start every
   `runTicketAgent` in parallel (`Promise.allSettled`) → release guard.
   Hold the guard until all runs settle (prevents a second Auto Run on the
   same lane mid-flight). [~80% confidence holding vs. releasing after launch is
   right — releasing early would allow re-launch while runs are still going;
   `agentRunning[ticket.id]` already blocks per-ticket duplicates either way.]
5. **BoardView.** In `confirmAutoRunLane`, branch on `picks.terminalId === 'headless'`:
   build `{ ticket, prompt, branchName }` per runnable ticket (branch set into the
   ticket before `ticketAgentPrompt` when worktrees on, mirroring
   `buildAutoRunLaunch`), skip orchestrator, call `autoRunLaneHeadless`.
6. **Resume.** A headless run started in a worktree must resume in
   `agentRun.cwd`. Check `resumeTicketAgent` passes cwd through once (3) exists.

## Acceptance

- Pick Headless → Run → no tabs open; every ticket shows the running badge,
  then succeeded/failed with output on the ticket.
- Lane worktrees on → each ticket gets branch + worktree path recorded and the
  run executes in `.worktrees/tN` (verify `agentRun.cwd`).
- Second Auto Run on the same lane while headless runs are in flight is refused.
- Terminal picks behave exactly as before (existing tests green).
- `ticket:run-agent` rejects a `cwd` outside the project / its `.worktrees/`.
- Unit tests: headless branch of auto-run launch (store), cwd validation (ipc).
- Manual check: run app on isolated DB copy, Auto Run a throwaway lane headless.

## Out of scope

- Headless as lane default or full-auto handoff mode.
- Concurrency cap, live streaming output, orchestrator for headless runs.

## Assumptions

- Headless is a per-run choice in the dialog only.
- No orchestrator (it watches terminal tabs).
- All runnable tickets start in parallel, no cap.

## Open questions

- None.

## Work location

- Branch: `t181-add-a-headless`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t181`
