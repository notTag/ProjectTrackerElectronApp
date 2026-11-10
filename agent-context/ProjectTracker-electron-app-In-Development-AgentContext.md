1. Verify if there is an existing worktree, branch, pull request or merge request for the current ticket. Ask the running agents if there are any agents working on this task. 2. Use the /worktree skill for all work in this lane. 
3. Upon completion of work, verify all original tasks have been completed. 
4. Run all tests and test locally (when possible) 
5. Upon completion of steps 1-5, move the ticket to the Merge request swimlane and update it's status. 
6. Send a message to the orchestrator agent saying what task number you just completed, what branch and what worktree. 
7. When your work is completely finished and you have written your final summary, stop any background processes you started, then run sleep 3 && kill $PPID as your very last action to end this session and close the terminal tab, and never use kill -9 (or any other signal flag), because the plain SIGTERM lets the MCP servers and child processes shut down cleanly.