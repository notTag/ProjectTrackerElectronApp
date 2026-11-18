# PRD — #99 Standard title format for agent sessions and tabs

## Why a PRD
- Small change, but it touches one shared helper pair used by 5 callers in 3 files (shared types, Pinia store, BoardView), and the tab title is load-bearing: liveness checks and the orchestrator find tabs by their exact title. The callers and the liveness fallback have to agree.

## Problem
- Ticket agent runs get two names, and neither one includes the lane:
	- Tab title: `ticketTabTitle()` (`src/shared/projectTypes.ts:880`) → `#99 The title of each agent session and…`
	- Session name (`claude --name`): `ticketSessionName()` (`src/shared/projectTypes.ts:735`) → `Ticket #99`
- So parallel tabs/sessions for one ticket in different lanes look identical.

## Target format
- Tab title: `<NUMBER>-<LANE>-<TITLE>` → `99-PRD-The title of each agent session…`
- Session name: `<NUMBER>-<LANE>` → `99-PRD`

## Callers (verified 2026-11-17)
- `ticketShellCommand` (`projectTypes.ts:722`) → `sessionName: ticketSessionName(ticket)`. `lane` is in scope.
	- It has two callers: `buildAutoRunLaunch` (auto run) and `BoardView.vue:1002 ticketCommand` (manual run, uses `laneOfTicket(ticket)`). Both get the change through the one helper.
- `buildAutoRunLaunch` (`projectTypes.ts:927`) → `title: ticketTabTitle(ticket)`. `lane` is in scope.
- `stores/projects.ts:1214` resume → `ticketTabTitle(ticket)`. Look up the ticket's current lane from the board.
- `views/BoardView.vue:1281` `openTicketInShell` → `ticketTabTitle(ticket)`. Use `laneOfTicket(ticket)` (already used by `ticketCommand`).
- `stores/projects.ts:1157` liveness → `agentRun?.tabTitle ?? ticketTabTitle(ticket)`. The fallback switches to the new helper with the ticket's current lane. Stored `tabTitle` still wins, so tabs opened before this change still match.
- Unaffected:
	- `orchestratorPromptParts` (`projectTypes.ts:1105`) reads `launch.title`, so it picks up the new title automatically.
	- `electron/terminalLaunch.ts usableTabTitle`: the 200-char cap and control-char refusal still hold, since the new title is ≤ 41 code points with no control chars.
	- `electron/openIn.ts` passes the title through unchanged.

## Decisions
- D1 — One sanitizer, two formatters, all in `projectTypes.ts`:
	- `laneTitleToken(lane)`: the lane's display `name`. Control chars → space, trim, whitespace runs → `-`, case kept. If that leaves it empty, fall back to the lane `id`.
	- `ticketSessionName(ticket, lane)` → `${number}-${laneTitleToken(lane)}`. It keeps its name and gains a `lane` param.
	- `ticketTabTitle(ticket, lane)` → `${number}-${laneTitleToken(lane)}-${title}`. It keeps its name and gains a `lane` param.
	- Changing the signatures (rather than adding new functions) makes the compiler point out every caller left behind.
- D2 — Unassigned: when `lane.id === UNASSIGNED_LANE_ID`, the token is the literal `Unassigned`, per the ticket's acceptance criteria. This applies even though that column's display name is `No status` (`UNASSIGNED_LANE_NAME`) or a user rename.
- D3 — Truncation: the `<NUMBER>-<LANE>-` prefix is never cut. Only the ticket-title part is cut, so the whole title stays within `TAB_TITLE_MAX_CODE_POINTS` (40) plus `…`. Counting is by code points, so an emoji is never split (existing logic).
	- If the prefix alone fills the budget, the title part is dropped and the result is `<NUMBER>-<LANE>` with no trailing `-` or `…`.
	- Empty or whitespace-only ticket title → `<NUMBER>-<LANE>`, with no trailing `-`.
- D4 — Ticket-title cleanup is unchanged: control chars → space, whitespace runs → one space, trim. Spaces inside the title stay; only the lane is dashed.
- D5 — Lane source: auto run uses the lane being launched (`lane` param). Manual run, open in shell, resume and the liveness fallback use the ticket's current lane (`laneOfTicket` / board lookup), since that is the lane the run is for.
- D6 — No live retitling. Each lane move starts a new run with a new tab/session, and that run carries the new lane name. Tabs that are already open keep their title.

## Requirements
- R1: Add `laneTitleToken` and change `ticketSessionName` and `ticketTabTitle` to take a `lane` (D1–D4). Update the header comments: the "number leads" rationale still holds.
- R2: `ticketShellCommand` passes `lane` to `ticketSessionName`.
- R3: `buildAutoRunLaunch` passes `lane` to `ticketTabTitle`.
- R4: Resume (`projects.ts:1214`) and the liveness fallback (`projects.ts:1157`) resolve the ticket's current lane from the project board. Reuse `boardLaneById` (`projectTypes.ts:1190`, handles `unassigned`); don't write a new one.
- R5: `BoardView.vue openTicketInShell` passes `laneOfTicket(ticket)`.
- R6: Tests in `src/shared/projectTypes.test.ts`:
	- Session name: the `claude --name 'Ticket #7' …` expectations (lines ~577, 614, 726) become `--name '7-In-Development'` (the lane name these tests use).
	- `ticketTabTitle` describe (~line 961), adapted:
		- short: `33-PRD-Short title`
		- long: truncated at 40 code points + `…`, with the prefix intact
		- emoji at the cut is not split
		- control chars and newlines collapsed
	- New cases:
		- `Merge Request` → `Merge-Request`
		- unassigned → `Unassigned`
		- a lane name with control chars or tabs is sanitized
		- an empty lane name falls back to the id
		- a prefix that fills the budget gives `<NUMBER>-<LANE>`
		- an empty ticket title has no trailing `-`
- R7: `buildAutoRunLaunch` / orchestrator prompt tests that assert `tab "#N …"` are updated to the new title.

## Acceptance
- Auto run of #99 from PRD: the tab is `99-PRD-The title of each agent sess…` (≤ 40 code points + `…`) and the session is `99-PRD`.
- A ticket in Merge Request gives `N-Merge-Request-…` and `N-Merge-Request`.
- A ticket in No status gives `N-Unassigned-…`.
- Liveness still reports alive for a tab opened before the upgrade (stored `agentRun.tabTitle`).
- `bun run test` and the typecheck are green. No `ticketTabTitle(ticket)` or `ticketSessionName(ticket)` call is left without a lane.

## Out of scope
- Orchestrator tab/session names (`AUTORUN-ORCHESTRATOR-<LANE>`).
- Retitling open tabs on a lane move.
- User-configurable title templates.

## Open questions
- None.
