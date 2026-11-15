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
5.5. Merge main into the feature branch, resolved any merge conflicts. 
6. Review the PR with /code-review <PR#>, or /code-review on the working diff before the PR exists. Delete any unnecessary code. Make any changes needed. Make sure the app has been tested by running the application. Do not merge unless the app has been run and tested. When you deem the MR/PR is worthy, merge it. 

After merge (once you've reviewed it and it's merged)
7. Move the ticket to "In Dev".
8. Clean up:
- git worktree remove <path>, or git worktree prune if the folder is already gone.
- git branch -d <branch> without asking.
- if the branch has been merged into the MAIN branch then delete it locally and on origin.
- Delete temp and scratch files the task created; check git status for leftovers.
- git worktree list to confirm
9. `git checkout main` and `git pull`.