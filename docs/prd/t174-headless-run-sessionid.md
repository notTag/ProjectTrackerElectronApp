# PRD — #174 Headless Run overwrites the ticket's agent sessionId

## Why a PRD
- Small diff, but it touches the store entry point shared by every headless run and has to reuse the #121 single-owner rule (`splitRunnable`) rather than invent a second one. Guard placement, the ticket the guard reads, and the UI hint all have to agree.

## Problem
- `runTicketAgent` (`src/stores/projects.ts:1242`) only guards on in-memory `agentRunning[ticket.id]`, which tracks headless runs started by this app process only.
- A persisted `agentRun` with `status: 'running'` (terminal tab, Auto Run, Full auto) is ignored → the fn writes a fresh `runningRecord` (`mode: 'headless'`, new `sessionId`) and then a final `succeeded`/`failed` record.
- The terminal run's `sessionId`, `tabTitle`, `terminalId`, `mode: 'terminal'` and `status: 'running'` are lost.
- Knock-on effects:
	- #121 ownership check in the live session sees a changed `sessionId` → reports a takeover, refuses to merge (seen on #146, 2026-11-27, headless run 7272b91d over session 3dc9c55f)
	- `runningAgentRuns` / `splitRunnable` (`src/shared/projectTypes.ts:901`, `:2213`) no longer see the ticket as running → Auto Run / Full auto can start a second agent on it
	- `runsToInterrupt` / tab liveness only track `mode: 'terminal'` → the live tab is no longer tracked
- Only caller: TicketModal ▶ Run (`src/components/board/TicketModal.vue:346`, button `:648`), disabled only on `agentRunning`.

## Goal
- A ticket with a live agent in its current lane keeps that agent's record. Headless Run on it is refused, writes nothing, and the user can see why.

## Requirements
- R1 Guard in `runTicketAgent`, before any state change (`agentRunning`, `notice`, `updateTicket`):
	- Read the stored ticket: `this.board(projectPath).tickets.find((entry) => entry.id === ticket.id) ?? ticket` (the modal's object may be stale)
	- `const { skipped } = splitRunnable([storedTicket], storedTicket.laneId)` (no checked ids → no override)
	- `skipped.length > 0` → `this.notice = skippedRunsNotice(skipped, <lane name>)`, return. No `updateTicket`, no `api.runTicketAgent`.
	- Lane name: the board's lane for `storedTicket.laneId`, fall back to the id
	- Keep the existing `agentRunning` check as-is (covers the window before the first `updateTicket` lands)
- R2 TicketModal ▶ Run:
	- `disabled` also when `ticket.agentRun?.status === 'running' && ticket.agentRun.laneId === ticket.laneId` (same rule as `runningAgentRuns`; reuse it: `runningAgentRuns([ticket]).length > 0`)
	- `title` in that case: `An agent is already running on this ticket in this lane`
	- Label stays `▶ Run` (`Running…` stays reserved for this app's own headless run)
- R3 No new escape hatch. A stale `running` record is cleared by `runsToInterrupt` (tab gone + started before app, or older than `STALE_RUN_MS`) → Run re-enables. Auto Run's checked-card override is unchanged.

## Out of scope
- Storing headless runs in a separate field: new column + UI for a case #121 forbids (two agents on one ticket)
- Changing the #121 ownership check itself
- Confirm dialog / force-run from the modal

## Acceptance criteria
1. Ticket has `agentRun` `{ status: 'running', mode: 'terminal', laneId: <ticket lane> }` → ▶ Run disabled with tooltip; calling `store.runTicketAgent` is a no-op: `api.runTicketAgent` not called, `agent_run_json` unchanged (same `sessionId`, `mode`, `tabTitle`), notice = `Skipped #N: agent already running in <lane>`.
2. Terminal run finished / failed / interrupted, or `running` in another lane → headless Run works as today.
3. Unit tests in `src/stores/projects.test.ts`, next to the existing `runTicketAgent` tests (`:345`):
	- running terminal record in same lane → API not called, `agentRun.sessionId` unchanged, notice set
	- running record in a different lane → API called (regression guard for criterion 2)
4. Verify in the real app on an isolated DB copy (run-app-before-merge): seed a ticket with a running terminal `agentRun`, open modal → button disabled + tooltip; flip record to `succeeded` → button enabled, Run works.

## Risks / notes
- #173 (branch `t173-bug-headless-run`) edits the end of the same fn (`projects.ts:1275-1290`, blocked status). This change is at the top → textual conflict unlikely; rebase on whichever merges first.
- A tab closed earlier this session keeps Run disabled until `STALE_RUN_MS` passes or the app restarts. Acceptable: same behaviour Auto Run already has for unchecked cards.

## Checklist mapping
- Guard runTicketAgent with splitRunnable → R1
- Disable ▶ Run + tooltip → R2
- Unit test → AC3
- Verify in running app → AC4
