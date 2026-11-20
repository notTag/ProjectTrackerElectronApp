# PRD — #121 One agent per ticket per lane (no merge before review finishes)

Branch: `t121-bug-investigate-why` · Worktree: `.worktrees/t121`

## Problem

PR #144 (#102) merged 2026-11-19 16:48:54Z while a /code-review on it was still running. Not GitHub auto-merge. Two Merge Request agents were working the same ticket in the same worktree:

- Session A `934ee396` — Auto Run at 16:28:51. Reviewed, fixed, tested, CI green → merged 16:48:54. Legit by its own lights.
- Session B `2754c54a` — second manual Auto Run of the same lane at 16:46:00. #102 was still in the lane → launched again. B merged main in, pushed, started a review that finished 16:50:41 — after A's merge. Its findings became #119.
- A saw a foreign merge commit `4f0aaef` on its branch and merged anyway.

Root cause: nothing stops Auto Run (or Full auto handoff) launching a ticket that already has a running agent in that lane. Any lane can hit this, not just Merge Request.

## Verified code path

- `src/views/BoardView.vue` `autoRunTickets` → `ticketsToRun` (`src/shared/projectTypes.ts:2042`): every visible ticket in the lane (or the checked ones). No running-agent check. Feeds both the tooltip count and `confirmAutoRunLane`.
- `src/stores/projects.ts:962` `autoRunLane`: `autoRunning[runKey]` is a per-lane guard, held only until the tabs open (released in `finally`). It does not cover a ticket whose agent is still running. It also overwrites `ticket.agentRun`, so the first session's record (sessionId, tab) is lost.
- `src/stores/projects.ts:630` `startFullAutoHandoffs`: builds launches from `laneHandoffs` with no running-agent check. Same gap.
- Existing helper: `runningAgentRuns` (`src/shared/projectTypes.ts:894`) = `agentRun.status === 'running'` and `agentRun.laneId === ticket.laneId`.
- Stale records are already handled: `runsToInterrupt` (same file) marks terminal runs interrupted when the tab is gone and the run started before this app launch or is older than `STALE_RUN_MS`.
- The live Merge Request prompt is the DB row `swim_lanes.agent_prompt` (lane `in-pr`, no `agent_file_path`). It has drifted from the repo copy `SwimlaneAgentPrompt/Merge-Request/AgentPrompt.md`.

## Requirements

### R1 — Auto Run skips tickets already running in the lane
- One shared pure helper in `src/shared/projectTypes.ts`, next to `runningAgentRuns`, e.g. `splitRunnable(tickets, laneId, checkedIds) → { runnable, skipped }`.
  - Skipped = `agentRun.status === 'running'` AND `agentRun.laneId === laneId` AND not checked.
  - A checked ticket always runs. This is the escape hatch for a stale `running` record.
- `BoardView` `autoRunTickets` applies it after `ticketsToRun`, so the tooltip count and the launch list agree.
- If every ticket is skipped, nothing launches (the existing `launches.length === 0` return), and the notice says why.

### R2 — Full auto handoff skips the same tickets
- `startFullAutoHandoffs` filters `laneHandoffs` through the same helper (no checked ids, so no escape hatch) before building launches.
- Skipped handoffs are dropped, not deferred. The running agent owns the ticket.

### R3 — Notice names what was skipped
- e.g. `Skipped #102: agent already running in Merge Request`. Several tickets → `Skipped #102, #106: …`.
- When some tickets launched, add it to the existing `Auto Run opened N tabs…` notice. Don't replace that notice.

### R4 — Merge Request prompt: refuse to merge when another run took over
Add to the Merge Request lane prompt, before the merge/approve step:
- At start, note the ticket's `agent_run_json` `sessionId` + `startedAt` and the branch head (`git rev-parse origin/<branch>`).
- Just before merging, re-read both.
  - Ticket's run `sessionId`/`startedAt` changed → another agent was launched on this ticket. Don't merge.
  - `origin/<branch>` has commits this session didn't push (a foreign merge or fix) → don't merge.
- In either case, report what was found (open question / orchestrator message) and leave the PR open.
- Apply to both: the DB lane prompt (`swim_lanes.agent_prompt`, id `in-pr`, filter `project_path`) via one `UPDATE`, and the repo copy `SwimlaneAgentPrompt/Merge-Request/AgentPrompt.md`. Add the paragraph only. Don't sync the rest of the drifted text.

### R5 — Tests
- `src/shared/projectTypes.test.ts`, next to the `ticketsToRun` tests. Cases:
  - running in this lane, unchecked → skipped
  - running in this lane, checked → runnable
  - running with `agentRun.laneId` = another lane → runnable
  - status `done` / `failed` / `interrupted` → runnable
- `bun run test` + typecheck green.

## Decisions

- **No new timeout for stale `running` records.** `runsToInterrupt` already ends runs whose tab is gone. Checking the card forces a run for anything left over. Add a timeout only if stale records keep blocking runs.
- **Filter in the callers, not in `autoRunLane`.** Only `BoardView` knows which tickets are checked, and that's the escape hatch. Both callers share one helper, so there's still a single rule.
- **Not in scope:** keeping the first session's `agentRun` when a forced re-run overwrites it. A forced run is a deliberate takeover.

## Acceptance

1. Auto Run a lane, then Auto Run it again while its tabs run → second run launches only tickets with no running agent there. The notice lists the skipped ones.
2. Check a card whose run shows `running`, then Auto Run → it launches.
3. Full auto handoff into a lane where that ticket already has a running agent → not relaunched.
4. Merge Request agent whose ticket run was replaced, or whose branch got foreign commits → reports and does not merge.
5. Verify in the real app on an isolated DB copy (see memory: run app before merge / drive app via CDP).

## Open questions

None.
