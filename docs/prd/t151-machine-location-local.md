#--- PRD #151: Auto Run machine location — Local (default) ---#

Problem
	Auto Run ▶ always runs every ticket tab on this Mac; nothing in the modal says so
	Machine location is being split by machine type (2026-11-27)
		#151 Local: the Machine select + the seams the other machine types plug into; Local = today's behavior
		#167 SSH host from ~/.ssh/config (holds the former #151 SSH PRD)
		#162 VPS / managed box
	This ticket changes no launch behavior

Today (verified)
	Modal: src/views/BoardView.vue askToAutoRunLane ~l.1466, confirmAutoRunLane ~l.1478, template ~l.2416
		rows: agent + model, orchestrator agent + model, terminal (TERMINAL_TARGETS), worktree hint
	IPC: 'lane:auto-run' electron/ipcHandlers.ts:537 → repositoryRootOf → freshMainRef → ensureTicketWorktree
	electron/ticketWorktree.ts
		git(): execFile('git', ['-C', path, …]) with GIT_TERMINAL_PROMPT=0 + 60 s timeout
		local fs calls besides git: existsSync(worktree/.git), readFileSync/appendFileSync on info/exclude

Scope
	1. Machine select in the Auto Run modal
		row next to "Each opens in its own <terminal> tab", label Machine
		one option: Local, selected, always
		no lane field, no DB column, no payload change: Local is what absent means (#167 adds lane.autoRunHost)
	2. Machine seam in ticketWorktree.ts, zero behavior change
		repositoryRootOf / freshMainRef / ensureTicketWorktree take a runner instead of calling execFile + fs directly
			run(args) → stdout, for git
			pathExists(path), readText(path), appendText(path, text), for .git check + info/exclude
		localRunner = today's execFile + node:fs code, default argument → ipcHandlers.ts call sites unchanged
		#167 passes an ssh runner; #162 whatever VPS uses
	3. docs/feature-map.md Auto Run section: Machine row (Local only)

Acceptance criteria
	Auto Run modal shows Machine: Local; nothing else selectable
	Every Auto Run launch (worktrees on and off) issues the same git argv, tab commands and ticket writes as before
	Existing ticketWorktree.test.ts + projects.test.ts pass unchanged
	New test: ensureTicketWorktree with a fake runner records the expected git argv for new branch, existing branch, reused worktree
	bun run test + typecheck green
	manual: isolated DB copy, Auto Run 1 ticket with worktrees on → same tab + worktree as main

Out of scope
	SSH hosts, remote paths, agentRun.host, ssh Resume, remote prompt changes → #167
	VPS → #162; clone #163; remote report-back #164; remote orchestrator #165
	Machine in lane settings, ticket modal, Full auto handoffs
