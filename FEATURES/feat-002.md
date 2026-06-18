# [002] On-demand GitHub refresh button per project

- Status: open
- Created: 2026-06-11
- Priority: low
- Bump: minor

## What
Add a "Refresh GitHub" button to each project card. When clicked, the app reads
the project's detected GitHub repo URL, calls the GitHub REST API once, and writes
the returned repo state (default branch, open issues, stars, forks, last push)
back into the card. The GitHub link itself moves out of the expanded project
details and onto the always-visible project card.

This is the pull-on-demand alternative to [001]'s webhook listener: no local
server, no secrets, no push events — the user clicks when they want fresh data.

## Why
The local scanner only sees filesystem state. A manual fetch surfaces remote
activity (open issues, last push, stars) without standing up a webhook listener
or storing a webhook secret. Putting the link and refresh control on the card
keeps GitHub context one click away instead of buried in the details tab.

## Done When
- [x] Each project card shows its GitHub link (moved off the details tab).
- [x] A "Refresh GitHub" button on the card pulls live repo data on demand.
- [x] Fetched data (default branch, open issues, stars, forks, last push) renders on the card.
- [x] Fetched data persists in the app's saved state and survives rescans.
- [x] Fetch errors (404, rate limit) surface as a readable message.
