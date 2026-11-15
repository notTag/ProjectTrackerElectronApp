# PRD — Ticket #63: Mid-session failure recovery

## Context
An agent run can die partway (wifi drop, sleep, API 5xx / rate limit, tab closed, app quit) and nothing notices or recovers. Headless runs end as a plain failed run; re-running starts from scratch. Terminal-tab runs (Auto Run, full-auto handoff) are fire-and-forget: if the session dies, the ticket sits in its lane with no badge and the full-auto chain stalls silently. Partial work survives on disk (worktree, branch, Claude Code session transcript), so `claude --resume <id>` can pick up where it stopped.

## Acceptance criteria
- Each launch (headless and terminal tab) gets an app-picked session id (`--session-id <uuid>`), stored on `agentRun` with `laneId`, `startedAt`, `status: 'running'` BEFORE the agent starts
- Headless transient failure (non-zero exit + output matches connection/timeout/overloaded/rate-limit) auto-retries up to 2× with backoff 30 s, 2 min, resuming the same session: `claude --resume <id> -p "Continue the task. Your previous attempt was interrupted."`. Non-transient (CLI missing, ENOENT) never retries
- Terminal-tab run: `status: 'running'`, same lane, no live tab after stale threshold (45 min, or immediately on app start when the tab is gone) → `status: 'interrupted'`
- Interrupted / failed → "interrupted" badge on card, "Resume" button in modal next to ▶ Run
  - Resume opens a terminal tab in the ticket's worktree running `claude --resume <session-id>` + short "you were interrupted, check git status and continue" prompt
  - Run (restart) stays for a clean re-run
- Full auto: interrupted run pauses the chain (no handoff), notice "Full auto paused on #N: agent interrupted"; chain resumes normally once the resumed agent moves the ticket
- App quit / crash: on launch, every `running` record older than app start is reconciled (headless → `interrupted`; terminal → tab-by-title check, else `interrupted`)
- Codex / Hermes / opencode get Restart only, Resume hidden. `Agent` gains optional `resumeArgs`; built-ins opt in
- Tests: transient classifier, retry count/backoff, stale-run reconciliation, Resume command builder (shell-quoted, uuid-validated)

## Code today (verified 2026-11-13 on `3a794ca`)
- `TicketAgentRun` (`src/shared/projectTypes.ts:251`): `at`, `laneId`, `output`, `succeeded?`, `seenAt?`. Written only AFTER a run finishes
- `agentRunBadge` (`projectTypes.ts:267`): `'running' | 'succeeded' | 'failed'`, lane-scoped (a run from another lane shows nothing). `running` comes from in-memory `store.agentRunning`, not the record
- `Agent` (`projectTypes.ts:386`): `id, name, command, headlessArgs, promptArgs?`. Built-ins: `DEFAULT_AGENT` (claude, `-p --permission-mode acceptEdits`), Codex, Hermes, opencode. Saved agents replace a built-in whole
- Headless: store `runTicketAgent` (`src/stores/projects.ts:746`) → IPC `ticket:run-agent` (`electron/main.ts:527`) → `runAgentHeadless` (`electron/agentRun.ts:40`): `execFile`, cwd = project root, 30 min timeout, resolves `{succeeded, output}`; ENOENT already detected (`agentRun.ts:57`)
- Terminal: `ticketShellCommand` → `agentShellCommand` (`projectTypes.ts:573/583`) builds `command [promptArgs] '<prompt>'`. `buildAutoRunLaunch` (`:641`) → IPC `lane:auto-run` (`main.ts:482`) prefixes `cd '<worktree>' && ` when worktrees on. Tab titles via `ticketTabTitle`; runners keyed in `COMMAND_RUNNERS` (`main.ts:135`), AppleScript in `electron/terminalLaunch.ts`
- Full auto: handoffs fire from lane moves only (`handoffsBetween`, `projects.ts:67`; `startFullAutoHandoffs`). A dead agent never moves the ticket → no handoff already happens; what's missing is the notice
- Claude CLI flags confirmed in `claude --help`: `--session-id <uuid>`, `-r/--resume [id]`, `--fork-session`
- Tests live beside code: `electron/agentRun.test.ts`, `src/shared/projectTypes.test.ts`, `electron/terminalLaunch.test.ts`

## Decisions (defaulted, full auto)
- D1. App generates the session id up front (`crypto.randomUUID()` in the renderer store) → resume works even when the run dies before printing
- D2. Auto-retry headless only. Terminal runs get manual Resume (a human may be in that tab)
- D3. Max 2 auto retries; then it's a normal failed run
- D4. Session flags are per-agent data, not code: `Agent.sessionArgs?: string[]` and `Agent.resumeArgs?: string[]`, with a `{sessionId}` token replaced at build time. Only `DEFAULT_AGENT` sets them (`['--session-id','{sessionId}']`, `['--resume','{sessionId}']`). No `resumeArgs` → no session id passed, Resume hidden. JSON-safe, so saved agents can opt in too
- D5. Store `cwd` on the run record. Claude looks up sessions per working directory (`~/.claude/projects/<cwd-slug>`), so Resume must run where the session started: headless = project root, Auto Run with worktrees = worktree path [~80% confidence newer CLIs resume across dirs — storing cwd is cheap either way]
- D6. Restart (▶ Run) always mints a fresh session id. `--session-id` rejects an id already in use, so reuse would fail
- D7. The 30 min `execFile` timeout (`error.killed`) is NOT transient: a stuck run retried is a stuck run twice. Shows `failed` with Resume available
- D8. `status` is new and authoritative; `succeeded` keeps being written for old readers. Records without `status` fall back to today's `succeeded` logic
- D9. Lane move = run over. Reconciler only looks at records whose `laneId === ticket.laneId`; a moved ticket's old `running` record is ignored (badge is already lane-scoped)
- D10. Tab liveness via AppleScript title lookup for Terminal, iTerm2, Ghostty. Runners with no tab query (Warp, others) → treated as "unknown": stale threshold only, never "gone on app start"
- D11. Reconcile cadence: once on app start, then every 60 s in the renderer (tab check is one IPC call batching all candidate titles)

## Requirements
- R1. Types (`projectTypes.ts`)
  - `TicketAgentRun` adds `sessionId?: string`, `startedAt?: string`, `status?: 'running' | 'succeeded' | 'failed' | 'interrupted'`, `mode?: 'headless' | 'terminal'`, `cwd?: string`, `attempts?: number`
  - `AgentRunBadge` adds `'interrupted'`; `agentRunBadge` maps `status: 'interrupted'` → `'interrupted'`, `status: 'running'` → `'running'` (persisted, survives reload)
  - `Agent` adds `sessionArgs?`, `resumeArgs?` (D4)
  - `isUuid(id)` (strict v4 regex) — gate before any id reaches argv or a shell string
- R2. Command builders (`projectTypes.ts`)
  - `agentShellCommand(agent, prompt, sessionId?)` inserts expanded `sessionArgs` when both are present
  - `agentResumeCommand(agent, run, prompt)` → `cd '<cwd>' && claude --resume <id> '<prompt>'`; throws on non-uuid id or agent without `resumeArgs`. Everything via existing `shellQuote`
  - `RESUME_PROMPT` constant: "You were interrupted mid-task. Check `git status` and the ticket, then continue where you left off."
  - `canResume(ticket, agent)` = status `interrupted|failed` + uuid `sessionId` + agent has `resumeArgs`
- R3. Headless (`electron/agentRun.ts`)
  - `isTransientFailure(output, error)`: false on ENOENT / `error.killed`; true when output matches (case-insensitive) `ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|connection error|network|overloaded|rate limit|429|5\d\d|timed out`
  - `RETRY_DELAYS_MS = [30_000, 120_000]`; `runAgentHeadlessWithRetry(agent, prompt, sessionId, cwd, home, { sleep, onRetry })` — attempt 1 uses `sessionArgs`, retries use `resumeArgs` + `-p` + continue prompt. `sleep` injectable for tests. Returns `{ succeeded, output, attempts }`
  - Agent without `resumeArgs` → single attempt (no session to resume)
  - IPC `ticket:run-agent` accepts `sessionId`, validates with `isUuid`, rejects otherwise; `onRetry` sends a renderer event so the store can show "Agent on #N interrupted — retrying in 30 s (1/2)"
- R4. Store (`src/stores/projects.ts`)
  - `runTicketAgent`: write `{ sessionId, startedAt, laneId, cwd, mode: 'headless', status: 'running' }` via `updateTicket` BEFORE the IPC call; on result write final `status`/`succeeded`/`output`/`attempts`
  - Auto Run / full-auto launch: same pre-write per ticket (`mode: 'terminal'`, `cwd` = returned worktree path or project root) before `lane:auto-run`; `buildAutoRunLaunch` passes the session id into the command
  - `reconcileAgentRuns(appStartedAt)`: candidates = `status: 'running'` and same lane. Headless + `startedAt < appStartedAt` → interrupted. Terminal → ask main for tab liveness; `gone` and (`startedAt < appStartedAt` or age > 45 min) → interrupted; `unknown` and age > 45 min → interrupted; `alive` → leave
  - Marking interrupted on a full-auto ticket (`isFullAuto`) sets notice "Full auto paused on #N: agent interrupted". Nothing else needed to pause (no move → no handoff)
  - `resumeTicketAgent(ticket)`: new session record keeps the same `sessionId`, `status: 'running'`, `mode: 'terminal'`, fresh `startedAt`; opens one tab via existing open-in/terminal runner with `agentResumeCommand`, title `ticketTabTitle`
- R5. Main (`electron/main.ts`, `electron/terminalLaunch.ts`)
  - IPC `terminal:tabs-alive({ targetId, titles })` → `('alive'|'gone'|'unknown')[]`. AppleScript per runner listing tab titles (Terminal `custom title`, iTerm2 session `name`, Ghostty title); unsupported runner or osascript error → all `unknown`
  - Renderer receives app start time (`appStartedAt`) from main once (e.g. in `project-state:get`)
- R6. UI (`src/views/BoardView.vue`)
  - `AGENT_BADGES.interrupted`: amber, label "Interrupted", glyph ⏸
  - Modal: "Resume" button beside ▶ Run when `canResume`; disabled while running. Run label unchanged
- R7. Tests
  - `agentRun.test.ts`: classifier table (each pattern true; ENOENT, killed, plain non-zero false); retry: transient ×3 → 3 attempts, delays `[30000,120000]`, attempts 2–3 argv contain `--resume <id>`; non-transient → 1 attempt; success on attempt 2 stops
  - `projectTypes.test.ts`: `agentResumeCommand` quoting (cwd with spaces/quotes), rejects non-uuid (`'; rm -rf ~'`), rejects agent without `resumeArgs`; `agentShellCommand` with session id; `agentRunBadge` interrupted/running/legacy record
  - Reconciler as a pure fn `runsToInterrupt(tickets, liveness, now, appStartedAt)` in `projectTypes.ts`, table-tested for every branch in R4

## Out of scope
- Outage detection / network reachability monitoring
- Mid-tool-call resume or replaying partial API responses (granularity = transcript)
- Live heartbeat/IPC from inside the terminal agent (hooks); revisit if 45 min is too coarse
- Resume for non-Claude agents beyond the `resumeArgs` extension point
- Rolling back half-done git work; resumed agent reads `git status` and decides
- Auto-retry of terminal runs; configurable threshold/retry counts (constants until someone asks)

## Risks
- Claude Code retitles its terminal tab while running. Title lookup could then report `gone` for a live tab → false "interrupted". Mitigation: Terminal/Ghostty custom titles set by the app usually stick; if testing shows drift, fall back to `unknown` for that runner. Verify per runner during dev
- Long legit terminal runs on `unknown`-liveness runners (Warp) past 45 min get flagged interrupted. Harmless: badge only, and the agent's eventual lane move supersedes it (D9). Full-auto notice may be a false alarm there
- Resume from a different cwd than the session's → "session not found". Covered by D5

## Open questions
None. All decisions defaulted above; D4/D10 are the main review calls.

## Branch / worktree
- Branch: `t63-mid-session-failure`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t63`
