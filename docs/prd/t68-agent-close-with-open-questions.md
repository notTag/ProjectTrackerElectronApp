# PRD — Ticket #68: Agent session killed with open questions

## Context
The #19 agent (In Development lane) finished with `Open Questions: 2`, then ran `sleep 3 && kill $PPID` and closed its own tab. The user had to interrupt the kill to keep the questions on screen.

Root cause: every "close the tab when done" instruction is unconditional. The global response footer already makes the agent print `Open Questions: N` on every reply, so the agent always knows whether it is blocked on the user. No prompt checks that number before closing.

Original report (agent output for #19):
```
Open questions:
1. Please run the manual check: a notice and an error should each clear after about 30 seconds on Board and on Dashboard, × should still close them right away, and a new message should get its own full 30 seconds.
2. The orchestrator didn't receive the completion message, so it needs to be told about #19 some other way.

PR: https://github.com/notTag/ProjectTrackerElectronApp/pull/74 open
Repos:
  ~/Code/Projects/ProjectTracker/electron-app/.worktrees/t19 (pwd) — t19-notifications-should-dismiss · wt:.worktrees/t19 · clean
Open Questions: 2

  No result recorded for 1 call
$ sleep 3 && kill $PPID
Interrupted · What should Claude do instead?
```

## Acceptance criteria
- [ ] An agent with one or more open questions does NOT close its tab or end its session. It stops with the questions as the last thing on screen.
- [ ] An agent with `Open Questions: 0` still closes its tab as today (plain SIGTERM via `kill $PPID`, never `kill -9`).
- [ ] Both lane context files make the close step conditional on zero open questions: In Development step 7 and the PRD close-tab line.
- [ ] `FULL_AUTO_INSTRUCTION` "Then exit." is conditional the same way: exit only when nothing waits on the user. "Work without stopping to ask" must not mean "drop questions you still have".
- [ ] A unit test on `ticketAgentPrompt` checks that the full-auto text includes the open-questions condition.

## Where the unconditional close lives (verified 2026-11-13 on `3a794ca`)
The ticket names three places. There are actually five, because lane prompts are stored twice: as the repo file (`agent_file_path`, sent as "Follow the guidance in …") and as the lane's own `agent_prompt` text in the DB (sent as the "Instructions:" section). Both reach the agent, so both must change or the unconditional copy still wins.

| # | Location | Text today |
|---|----------|-----------|
| 1 | `agent-context/ProjectTracker-electron-app-In-Development-AgentContext.md` step 7 | "…then run sleep 3 && kill $PPID as your very last action to end this session and close the terminal tab, and never use kill -9…" |
| 2 | `agent-context/ProjectTracker-electron-app-PRD-AgentContext.md` last line | "- Close the terminal tab this ran in when you are done." |
| 3 | `src/shared/projectTypes.ts:503` `FULL_AUTO_INSTRUCTION` | "…Move it once, when this lane's work is done, to the next lane as instructed above. Then exit." |
| 4 | DB `swim_lanes.agent_prompt`, lanes `in-development` and `prd` (this project) | Same text as files 1 and 2 |
| 5 | DB `swim_lanes.agent_prompt`, lane `idea` (this project, no agent file) | "- Close the terminal tab this ran in when you are done." |

Other code facts:
- `ticketAgentPrompt` (`src/shared/projectTypes.ts:533`) joins lane prompt → lane file reference → metadata → description → version → full auto → output with `\n\n`.
- Existing test `src/shared/projectTypes.test.ts:763` pins the full-auto section with `/^Full auto is on\. .*Then exit\.$/`. It must be updated with the new wording.
- `agent_file_path` points at the main checkout (`~/Code/Projects/ProjectTracker/electron-app/agent-context/…`), so file edits made in the worktree only reach agents after the PR merges. DB edits take effect right away.

## Decisions (defaults, no blockers)
- D1. One shared condition, worded the same everywhere so agents see one rule: close/exit only when the final footer shows `Open Questions: 0`. Otherwise do not close, do not kill, and leave the questions as the last thing on screen.
- D2. Wording to use (the dev may tighten it but keep the three parts: condition, close action, else-branch):
  - In Development step 7:
    > 7. When your work is completely finished and you have written your final summary, check its `Open Questions` count. If it is 0, stop any background processes you started, then run sleep 3 && kill $PPID as your very last action to end this session and close the terminal tab. Never use kill -9 (or any other signal flag): plain SIGTERM lets the MCP servers and child processes shut down cleanly. If it is 1 or more, do not close the tab or end the session: stop with the open questions as the last thing on screen.
  - PRD (and Idea) close line:
    > - When you are done, close the terminal tab this ran in only if your final footer shows `Open Questions: 0`. If any questions are open, leave the tab open and stop with them as the last thing on screen.
  - `FULL_AUTO_INSTRUCTION`, replace "Then exit." with:
    > Not stopping to ask does not mean dropping questions: anything only the user can answer goes in your open questions. Exit only when your final footer shows `Open Questions: 0`; otherwise stop with the open questions as the last thing on screen and leave the session open.
- D3. Also update the DB lane prompts (rows 4 and 5 above) for this project, same wording. Without it the AC fails: the agent would still get an unconditional "close the tab" in its Instructions section. Follow the global CLAUDE.md DB rules: `.backup` to the scratchpad first, update by lane `id` + `project_path`, one `BEGIN…COMMIT`, `PRAGMA integrity_check`, delete the backup. Only touch the close-tab sentence; leave the rest of each prompt as it is.
- D4. Full-auto ticket move stays as is. This ticket only changes whether the session exits, not whether the ticket moves when questions remain. If that turns out wrong, it's a separate ticket.

## Implementation
1. Edit files 1 and 2 with the D2 wording.
2. Edit `FULL_AUTO_INSTRUCTION` (`projectTypes.ts:503`) with the D2 wording. Keep it one string constant; no new helpers.
3. Tests in `src/shared/projectTypes.test.ts`, `describe('full auto')`:
   - Update the `:763` regex so it no longer requires the section to end in `Then exit.` (e.g. `/^Full auto is on\. /` plus the checks below).
   - New test: the full-auto section contains `Open Questions: 0` and says to stop with the questions on screen otherwise (e.g. `toContain('Open Questions: 0')` and `toMatch(/otherwise stop with the open questions/)`). The off prompt still contains neither.
4. Update the DB lane prompts per D3.
5. `bun test` (or the project's test script) green.

## Out of scope
- The orchestrator not getting #19's completion message (open question 2 in the log). Separate bug, separate ticket.
- Detecting open questions in the app (parsing agent output, a terminal-side guard). Prompt wording only for now. Revisit if agents still ignore the condition.
- Re-running or re-checking #19's manual check (open question 1).
- Lane prompts in other projects' boards. Only this project's lanes change.

## Effort
About 30 minutes. Two markdown edits, one string constant, one test update plus one new test, one DB update.

## Branch / worktree
- Branch: `t68-bug-agent-session`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t68`

## Open questions
None.
