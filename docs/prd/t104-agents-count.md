# PRD: Agents count = live ticket agents (#104)

## Problem
Metrics "Agents" (panel table, dashboard total, `CardMetrics` tile) counts every `claude` / `codex` / `hermes` process whose cwd sits in a project. Live check 2026-11-18, electron-app: 18 counted, of which only 12 were ticket agents. The rest: Auto Run orchestrators, `codex app-server` daemons (ppid 1). Manual `claude` sessions and agent child processes inflate it too. Users read the number as "tickets with an agent running", so it must count exactly that.

## Today (main @ `e48b8f1`)
- `electron/metrics.ts`
	- `parseAgentPids(psOutput, AGENT_PROCESS_NAMES)` — `ps -axo pid=,comm=`, match argv[0] basename
	- `parseLsofCwds(lsofOutput)` — `n<path>` lines only, pid dropped
	- `countAgentsByProject(cwds, projectPaths)` — +1 per cwd, longest project-path prefix wins (worktrees included)
	- `runningAgentsByProject(projectPaths)` — glues the three
- `electron/ipcHandlers.ts:591` → `ProjectMetrics.agentsRunning` (`null` when listing fails)
- Display: `src/components/MetricsPanel.vue:110-177`, `src/components/CardMetrics.vue:12,30` — no change needed

## How ticket agents are identifiable
- Every terminal ticket agent is launched with `--name 'Ticket #N'` (`ticketShellCommand` → `ticketSessionName`, `src/shared/projectTypes.ts:731-735`)
- Orchestrators: `--name 'AUTORUN-ORCHESTRATOR-<LANE>'` → no `Ticket #`
- Codex daemon: `codex app-server …` → no `--name`
- Observed live argv has an extra leading `--name t104` (from the terminal wrapper) before `--name Ticket #104` → match ANY `--name Ticket #N`, not the first `--name`
- Same ticket often has 2-3 live processes (old sessions from earlier lanes still open, e.g. #103 x3) → dedupe

## Decisions
- D1. Identify ticket agents by args, not comm: `ps -axo pid=,args= -ww` (`-ww` = no truncation)
	- Ticket agent = args contain `--name Ticket #<N>` followed by whitespace or end
	- `AGENT_PROCESS_NAMES` check stays as a cheap first filter on argv[0] basename (args' first word)
- D2. Count = distinct ticket numbers per project, not processes
	- Ticket numbers are unique per project only → dedupe key `(projectPath, N)`
- D3. Project attribution unchanged: lsof cwd + longest-prefix match (worktrees under `<project>/.worktrees` belong to the project)
	- `parseLsofCwds` must keep the pid so cwd pairs with that pid's ticket number (`p<pid>` line precedes its `n<path>`)
- D4. Excluded, by construction: orchestrators, `codex app-server`, manual unnamed sessions, child `claude`/`codex` processes, headless (`-p`) runs (no `--name`, `electron/agentRun.ts:126`)
- D5. Failure path unchanged: `ps`/`lsof` error → `agentsRunning: null` → "—"
- D6. No orchestrator count, no UI change. Shown-separately orchestrators = future ticket if wanted

## Implementation sketch (`electron/metrics.ts` only)
- `TICKET_SESSION_PATTERN = /--name Ticket #(\d+)(?=\s|$)/`
	- Build the literal from `ticketSessionName`'s prefix if cheap; else a `ponytail:` comment pointing at `projectTypes.ts:735` so a rename breaks the test, not silently the count
- `parseTicketAgentPids(psOutput): Map<pid, ticketNumber>` — replaces `parseAgentPids`
- `parseLsofCwds(lsofOutput): { pid, cwd }[]`
- `countAgentsByProject(agents: { cwd, ticketNumber }[], projectPaths)` — `Set` per project, return sizes
- `runningAgentsByProject` — same two exec calls; lsof `-p` gets only ticket-agent pids; zero pids → all-zero counts without calling lsof (as today)

## Tests (`electron/metrics.test.ts`, replace the "agent process discovery" cases)
- ps parsing, fixture taken from real argv:
	- `claude --name t104 --name Ticket #104 --session-id … Instructions:…` → 104
	- `claude --model opus --name AUTORUN-ORCHESTRATOR-IDEA …` → excluded
	- `/…/codex app-server daemon …` and `codex app-server --listen …` → excluded
	- plain `claude` (manual) and `claude -p …` (child/headless) → excluded
	- `Ticket #10` must not match `Ticket #104` (word boundary) and vice versa
	- install path prefix on argv[0] still matches (`/Users/x/.local/bin/claude --name Ticket #7`)
- lsof parsing keeps pid↔cwd pairing, cwd with spaces
- count: two pids same ticket same project → 1; same number in two projects → 1 each; worktree + nested project cases kept from current test

## Acceptance
- [ ] N ticket agent tabs open for a project (distinct tickets) → Agents shows N
- [ ] Orchestrator tabs, `codex app-server`, manual `claude` sessions in the repo → number unchanged
- [ ] Two live sessions for the same ticket → counts 1
- [ ] Process listing failure → "—"
- [ ] `bun run test` + typecheck green
- [ ] Run-app check before merge: open Metrics panel on isolated DB copy, compare against `ps -axo args= -ww | grep -c -- '--name Ticket #'` deduped

## Known ceilings (accepted)
- Agents without `sessionNameArgs` (Codex, Hermes, opencode, custom) launched in a terminal get no name → not counted. Upgrade path: count `agent_run`/launch records the app owns, or give those CLIs a name flag
- Headless runs not counted (no name). Upgrade path: union with tickets whose `agent_run_json.status = 'running'`
- A manual session the user names `Ticket #N` counts as that ticket's agent — fine, it is one

## Out of scope
- Duplicate `AUTORUN-ORCHESTRATOR-IDEA` launch (two live at once, ttys032 + ttys034) — separate bug ticket

## Open questions
- None
