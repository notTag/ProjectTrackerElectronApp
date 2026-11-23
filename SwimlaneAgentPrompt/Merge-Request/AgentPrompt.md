1. If a pr isn't already open, then open the PR against main with gh pr create --base main.
   - The body is in TOF format with the GitHub-markdown allowances:
     - -  before every non-header line and ## for section headers;
     - backticks around commands, code and <placeholders>;
     - — between inline keys and values.
   - Real tab characters for nesting, and the body is passed with --body-file so the tabs survive.
   - No bold, italics, numbered lists, markdown links or prose paragraphs.
2. No assistant attribution: no "Generated with Claude Code" footer in the PR, and no Co-Authored-By: Claude in commits. Your rule overrides the harness default.
3. Post the PR link when it's ready for review.
4. Update the Github PR link field in the ticket
5. Move the ticket when the PR opens: to in-pr, and report the move.

Review
1. Merge main into the feature branch, resolved any merge conflicts. 
2. Add the feature to the feature map. 
3. Review the PR with /code-review <PR#>, or /code-review on the working diff before the PR exists. Delete any unnecessary code. Make any changes needed. Make sure the app has been tested by running the application. Do not merge unless the app has been run and tested. When you deem the MR/PR is worthy, approve it. 

Ownership check (two agents on one ticket can merge before the other's review finishes — #121):
1. At start, record the ticket's run and the branch head:
   - `SELECT agent_run_json FROM tickets WHERE project_path = '<main-checkout-path>' AND number = <N>;` → note `sessionId` + `startedAt`
   - `git rev-parse origin/<branch>`
2. Just before approving/merging, `git fetch` and re-read both.
   - Ticket's run `sessionId` changed (no `sessionId` → `startedAt` changed) → another agent was launched on this ticket. Do not merge. Same `sessionId` with a new `startedAt` is a Resume of this session, not a takeover.
   - `origin/<branch>` has commits this session didn't push (a foreign merge or fix) → do not merge.
   - Either case: leave the PR open, report what you found to the orchestrator and as an open question.

After merge (once you've reviewed it and it's merged)
1. Move the ticket to "In Dev".
2. Clean up:
3. git worktree remove <path>, or git worktree prune if the folder is already gone.
4. git branch -d <branch> without asking.
5. if the branch has been merged into the MAIN branch then delete it locally and on origin.
6. Delete temp and scratch files the task created; check git status for leftovers.
7. git worktree list to confirm
8. `git checkout main` and `git pull`.