# #173 — Headless run that exits 0 while blocked is marked succeeded

## Problem
- `electron/agentRun.ts:66` (`runAgentProcess`): exit code 0 → `{ succeeded: true }`, whatever the agent printed
- `runTicketAgent` (`src/stores/projects.ts:1242`) stores `status: 'succeeded'` and passes `result.succeeded` as `completesTicket` to `updateTicket` (`:1286`) → Next Lane auto-move fires
- CLIs like `claude -p` exit 0 when they stop for missing permissions ("blocked, need permissions")
- Seen on #146, 2026-11-27: run 7272b91d blocked, ticket auto-moved Merge Request → In Dev Env with PR still open

## Goal
A headless run that says it is blocked is recorded as blocked, does not complete the ticket, and shows that on the board.

## Approach — explicit end-of-run marker
- Exit code alone can't tell "done" from "gave up politely". Output heuristics ("blocked", "permission") false-positive on real work. So the app asks the agent to say which one it is.
- Main side, one place (`runAgentHeadlessWithRetry`, the only headless entry point):
  - Append a fixed instruction to the prompt (first attempt and `CONTINUE_PROMPT` resume):
    `When you stop, end your reply with one final line: "RUN STATUS: done" if this task is complete, or "RUN STATUS: blocked — <reason>" if you could not finish it.`
  - On exit 0, read the last non-empty stdout line:
    - `RUN STATUS: blocked…` (case-insensitive) → `succeeded: false`, `blocked: true`
    - `RUN STATUS: done` or no marker → `succeeded: true` (unchanged)
- A blocked run is never retried (not transient; retrying a missing permission is the same block twice)

## Requirements
- R1 `AgentRunResult` gains `blocked?: boolean`. `runAgentProcess` sets it from the marker on exit 0 only. Non-zero exit stays `failed`.
- R2 Prompt suffix appended in `runAgentHeadlessWithRetry` to both `firstArgs` and `resumeArgs` prompt words. One exported const (`RUN_STATUS_INSTRUCTION`) so tests can match it.
- R3 Retry loop skips blocked attempts (`isTransientFailure` not consulted when `blocked`).
- R4 `AgentRunStatus` and `AgentRunBadge` gain `'blocked'` (`src/shared/projectTypes.ts:272`, `:305`). `agentRunBadge` returns `'blocked'` for `status === 'blocked'`.
- R5 `runTicketAgent` (`projects.ts:1275-1290`):
  - `status: result.blocked ? 'blocked' : result.succeeded ? 'succeeded' : 'failed'`
  - `completesTicket` = `result.succeeded` (false when blocked) → no Next Lane move, no checklist-driven completion
  - Error banner: `Agent on #N is blocked — see the ticket's last run.`
- R6 `canResume` (`projectTypes.ts:883`) treats `blocked` like `failed`/`interrupted`, so Resume works after the user grants the permission.
- R7 Board/ticket UI: blocked badge styled like failed but labeled "Blocked" (amber, not red). Same spots that render the `failed` badge.
- R8 `hasUnseenAgentResult` counts blocked as a result (falls out of R4).

## Acceptance criteria
- Agent exits 0 with last line `RUN STATUS: blocked — need gh permission` → run `status: 'blocked'`, `succeeded: false`, ticket stays in lane, Next Lane move does not fire
- Agent exits 0 with `RUN STATUS: done` or no marker → behaves as today (succeeded, auto-move fires)
- Blocked run is not retried even if its output mentions "network"
- Ticket card + modal show a Blocked badge; Resume button available
- Headless prompt passed to the CLI ends with the RUN STATUS instruction (first run and resume)
- Tests in `electron/agentRun.test.ts` (node `-e` fake agent printing the marker, as existing tests do) + `projectTypes` badge/canResume test

## Out of scope
- Terminal (tab) runs: their completion comes from the user, not an exit code
- Parsing Claude `--output-format json` `permission_denials` (Claude-only; marker works for every CLI)
- Changing the default `acceptEdits` permission mode

## Decisions (defaults, full auto)
- No marker → succeeded. Keeps agents that ignore the instruction working as today. Upgrade path: treat missing marker as "unknown, don't auto-move" if blocked runs keep slipping through.
- Marker only counted on the last non-empty stdout line, so a prompt echo or quoted instruction mid-output can't trip it.
- New status `blocked` instead of reusing `failed`: the user's next step differs (grant access + Resume vs. debug).
