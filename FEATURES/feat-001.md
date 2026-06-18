# [001] GitHub webhook listener for live per-project data

- Status: open
- Created: 2026-06-09
- Priority: low
- Bump: minor

## What
Run a local listener that receives GitHub webhook events and updates per-project
data in near-real-time. Projects linked to a GitHub repo react to push, PR, and
issue events; the listener writes the resulting state (latest commit, open
PRs/issues, last push, default branch) into the app's SQLite store.

## Why
The local scanner only sees filesystem state. Receiving GitHub events keeps each
project's data fresh — surfacing remote activity (pushes, PRs, issues) without
the user manually checking every repo.

## Done When
- [ ] A project can be linked to a GitHub repo.
- [ ] Linked projects display live GitHub data in the dashboard UI.
- [ ] Data refreshes on incoming webhook events (and/or a fallback trigger).
- [ ] Fetched data is persisted in the local SQLite database.
- [ ] GitHub auth token / webhook secret is stored and handled securely.
