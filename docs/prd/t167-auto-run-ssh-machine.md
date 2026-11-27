#--- PRD #167: Auto Run machine location — SSH host ---#

Problem
	Auto Run ▶ always opens every ticket tab on this Mac
	Want: pick a remote host from ~/.ssh/config, agents run there over ssh, tabs still open in the local terminal
	Split 2026-11-27 from #151, which now ships the Machine select with Local only (the default mode)
	Depends on #151: Machine select, lane.autoRunHost slot, injected git runner in ticketWorktree.ts
	Siblings: #162 VPS, #163 clone on remote, #164 remote report-back, #165 remote orchestrator

Today (verified)
	Modal: src/views/BoardView.vue askToAutoRunLane ~l.1466, confirmAutoRunLane ~l.1478, template ~l.2416
		reads lane.autoRunModel on open; autoRunModel is edited in lane settings (l.2736), not written on confirm
	Store: autoRunLane src/stores/projects.ts ~l.1024
		writes agentRun (status running, cwd, terminalId, tabTitle, sessionId) BEFORE launch
		catch path clears notice, sets error, resets the runs it wrote
		after launch writes branchName + worktreePath + agentRun.cwd from returned worktreePaths
	IPC: 'lane:auto-run' electron/ipcHandlers.ts:537
		validates projectPath, tickets (isAutoRunTicketLaunch), targetId via Object.hasOwn(COMMAND_RUNNERS)
		worktrees: repositoryRootOf → freshMainRef → ensureTicketWorktree per ticket (electron/ticketWorktree.ts)
		tab command: cd <shellQuote(worktree)> && <ticket.command>
	Lane fields persisted: schema.ts swim_lanes columns + migration list l.190, stateRepository.ts l.183 / l.782, IPC lane whitelist ipcHandlers.ts:244
	Resume: resumeTicketAgent projects.ts ~l.1284 → agentResumeCommand(agent, run) → openIn(projectPath, …) locally
	Reconcile: reconcileAgentRuns checks tab liveness by title in the LOCAL terminal → works unchanged for remote tabs
	shellQuote: src/shared/projectTypes.ts; no ssh code anywhere yet

Decisions (from ticket)
	D1 hosts = ~/.ssh/config Host aliases only; no passwords/keys stored; auth = whatever ssh does
	D2 host validated in main process against parsed aliases + strict pattern; everything sent remote goes through shellQuote
	D3 repo must already exist at the remote path (clone → #163)
	D4 remote agents code + push only; no ticket moves / orchestrator messages (→ #164)
	D5 orchestrator tab stays local (→ #165)
	D6 Auto Run modal only; ticket-modal runs + Full auto handoffs stay local

Decisions (added in PRD)
	D7 Resume of a run with agentRun.host re-wraps the resume command in the same ssh builder
		otherwise Resume cd's into a path that doesn't exist locally
	D8 Remote prompt: drop the sqlite3 ticket-update + orchestrator-message instructions, replace with one line
		"Running on <host>: the tracker DB isn't reachable. Commit + push your branch, then stop."
		what actually runs on the remote
			remote login shell (via ssh -t) → cd <remote worktree> → bare agent binary from the remote's PATH
				claude / codex / hermes / opencode (projectTypes.ts l.484-532), plus --session-id, model, and the full prompt as one quoted arg
			the agent then runs git (commit, push) and whatever shell commands the prompt tells it to
			nothing else: no app, no DB, no orchestrator session, no local ~/.claude config
		remote must already have: agent CLI installed + logged in, git push credentials, the repo (D3)
		why the DB lines must go
			prompt embeds `sqlite3 "$HOME/Library/Application Support/Project Tracker/project-tracker.sqlite" …` (quotedTrackerDatabasePath)
			$HOME expands on the remote → Linux: file missing, sqlite3 errors + may leave an empty file behind [~70% confidence — needs one run]
			macOS remote with the app installed: writes THAT machine's DB → silent wrong-board update, worst case
			same for version, move-rules confirm, lane-move instructions
		why the orchestrator line must go
			"message the orchestrator" = cross-session SendMessage between sessions on one machine; remote session can't see the Mac's orchestrator
		agent session transcript lives on the remote (~/.claude/projects there) → reason D7 resumes over ssh
	D9 Machine + remote path remembered by writing the lane on confirm (only when changed)
		lane settings panel gets no Machine field (D6)

Data model
	SwimLane (projectTypes.ts)
		autoRunHost?: string
			absent / '' = Local
		autoRunRemotePaths?: Record<string, string>
			host alias → remote repo path
	swim_lanes columns
		auto_run_host TEXT NOT NULL DEFAULT ''
		auto_run_remote_paths_json TEXT
		add both to the migration list in schema.ts + upsert in stateRepository.ts + IPC lane whitelist
	TicketAgentRun
		host?: string
			absent = local
	Ticket.worktreePath holds the remote path for remote runs (agentRun.host says where)

Main process
	New electron/sshHosts.ts
		parseSshConfigHosts(text, readInclude) → string[]
			Host lines, case-insensitive keyword, multiple aliases per line
			skip any alias containing * ? or starting with !
			Include: follow relative to ~/.ssh, glob via the same skip rules, depth cap (e.g. 8) against loops
			dedupe, keep file order
		listSshHosts() reads ~/.ssh/config; missing file → []
		isSafeHostAlias(alias): /^[A-Za-z0-9._@-]+$/ and no leading '-'
		sshArgs / sshTabCommand(host, remoteCommand)
			ssh -t <host> <shellQuote(remoteCommand)>
		sshRun(host, remoteCommand) for git calls
			execFile('ssh', ['-o','BatchMode=yes','-o','ConnectTimeout=10', host, remoteCommand]), 60 s timeout like GIT_TIMEOUT_MS
			execFile, no local shell; remoteCommand already shellQuoted per arg
	New IPC 'ssh:hosts' → listSshHosts(); read-only
	'lane:auto-run' payload gains optional remote: { host, path }
		host: string, must be in listSshHosts() AND isSafeHostAlias → else "Unknown SSH host: <host>"
		path: non-empty string, absolute (starts with / or ~/) → else "Invalid remote repo path."
		no remote → current local code path, untouched
	Remote flow, before any tab opens
		reachability: sshRun(host, 'true') fails → "Cannot reach <host> over SSH: <stderr>"
		repo check: git -C <path> rev-parse --show-toplevel → fails → "<host>:<path> is not a git repository."
		worktrees on
			remote equivalents of freshMainRef + ensureTicketWorktree over sshRun, one ticket at a time
			fetch, symbolic-ref origin/HEAD fallback origin/main, check-ref-format, worktree prune, worktree add .worktrees/tN
			reuse existing .worktrees/tN when its .git exists (test -e)
			add /.worktrees/ to remote info/exclude like local excludeWorktreeDirectory
			pass sshRun as the git runner #151 injects into ticketWorktree.ts → one code path, not two copies
		ticket tabs: command = ssh -t <host> 'cd <remotePath> && <ticket.command>'
			remotePath = remote worktree (worktrees on) or repo path (off)
		orchestrator tab unchanged, local (D5)
		returns { worktreePaths } with remote paths

Renderer
	Modal: Machine <select> from #151 gains one option per host from ssh:hosts (fetched on modal open)
		Remote path <input> shown only when a host is picked; prefilled from lane.autoRunRemotePaths[host]
		Run disabled while a host is picked and path is empty
		hint line: remote → "Runs on <host> in <path>/.worktrees/tN …" mirroring today's hint
	Open: lane.autoRunHost not in fetched list → Local
	Confirm: editLane(autoRunHost, autoRunRemotePaths[host]) when changed; pass remote to store.autoRunLane
	Store autoRunLane: new optional remote arg → bridge payload; agentRun.host = remote.host; cwd = remote path
		catch path unchanged → no ticket left running
	preload.cts + webBridge.ts + bridgeApi.ts: add remote to lane:auto-run, add ssh:hosts
	Prompt context (D8) for remote launches
	Resume (D7): run.host set → command wrapped with sshTabCommand before openIn
	Card worktree chip: title shows <host>:<path> when agentRun.host set

Acceptance criteria
	Machine select lists Local (default) + every literal Host alias from ~/.ssh/config, Include files followed, wildcards + Host * skipped
	Lane remembers machine + per-host remote path; missing / removed host → Local
	Local launch: identical commands, payload, and ticket writes as today (existing tests unchanged + green)
	Remote launch opens each ticket tab in the chosen local terminal running ssh -t <host> 'cd <path> && <agent cmd>'
	Worktrees on: .worktrees/tN created on the remote from fresh origin main; ticket.worktreePath = remote path; agentRun.host = host
	Tab titles + session ids unchanged (reconcile + Resume keep working; Resume goes over ssh)
	Unreachable host or non-git remote path → whole run fails, clear error, no ticket left running, no tab opened
	Host not in config / unsafe alias rejected in main process even if the renderer sends it

Tests
	sshHosts.test.ts
		multiple aliases per line, case-insensitive Host, comments, Host * + wildcards + negations skipped
		Include relative + absolute, Include loop capped, missing file → []
		isSafeHostAlias rejects -oProxyCommand=…, a;b, $(x), spaces, backticks
		sshTabCommand quoting: path with spaces + single quotes, command containing single quotes round-trips
	ticketWorktree.test.ts: injected runner — remote mode issues the expected git argv
	ipc validation (terminalLaunch.test.ts or new test beside the handler, as #150 did): unknown host, unsafe host, bad path, missing remote → local path
	projects.test.ts: remote launch writes agentRun.host + remote cwd; failed launch resets running
	stateRepository.test.ts: new columns migrate on older DB (pattern l.301)
	bun run test + typecheck green
	manual: isolated DB copy, one real ssh host (or ssh localhost), 1 ticket, worktrees on

Out of scope
	VPS provisioning #162, clone on remote #163, remote ticket updates / orchestrator messages #164, remote orchestrator #165
	password / key management
	Machine field in lane settings, ticket modal, Full auto handoffs (D6)

Docs
	docs/feature-map.md Auto Run section: Machine select + remote behavior
