# PRD — Ticket #17: Agent run indicator on cards

## Problem
▶ Run starts an agent in the background. The status bar reports the result once, then the next action overwrites it. The card is the only lasting signal. Today it shows a running dot and a green ✓ for successes. Failures show nothing, and nothing ever clears the ✓.

## Goal
Glancing at the board answers "which agent runs finished, did they work, and have I looked yet?"

## Requirements
1. Running: card shows the pulsing dot while `store.agentRunning[ticket.id]` is true. Running beats any saved run.
2. Finished: ✓ green if `agentRun.succeeded === true`, ✕ red if `=== false`. `undefined` (legacy run) → no badge.
3. Lane-scoped: done badge only while `agentRun.laneId === ticket.laneId`.
4. Unseen only: done badge hidden once `agentRun.seenAt` is set. Runs without `seenAt` count as unseen.
5. Seen = the ticket modal is open while an unseen run exists. Set `seenAt` (ISO string) through `store.updateTicket`.
6. Lane header shows the unseen finished-run count next to `.lane-count`. Hidden at 0. `aria-label` such as "2 unseen agent results".
7. Every badge has `role="img"` + `aria-label` + `title`: "Agent running" / "Agent succeeded" / "Agent failed". Colour is never the only signal (✓ vs ✕ glyphs).

## Design decisions
- **Helper**: `agentRunBadge(ticket, running): 'running' | 'succeeded' | 'failed' | null` in `src/shared/projectTypes.ts`. It is pure and needs no Vue, so it can be tested. It replaces `agentFinishedInCurrentLane` (`BoardView.vue:411`). Lane count = `ticketsInLane(id).filter(t => { const badge = agentRunBadge(t, false); return badge === 'succeeded' || badge === 'failed' })`. Passing `running = false` means a re-run of an unseen ticket still counts. Acceptable.
- **Where to mark seen**: use a `watch` on the open ticket's id + `agentRun` in BoardView, not the card's `@click`. The modal opens from two places: the card click (`BoardView.vue:566`) and the graph view's `@ticket` event (`BoardView.vue:518`). The watch also covers a run that finishes while its modal is already open: the user is looking at the output, so the run is marked seen at once.
- **Write guard**: only write when the run is unseen (`agentRun && agentRun.seenAt === undefined`), so opening a ticket doesn't write every time. Patch `{ agentRun: { ...agentRun, seenAt } }`. `updateTicket` shallow-merges, so the whole run object must be passed.
- **`updatedAt` side effect**: `updateTicket` always bumps `updatedAt`, so after the first open the modal shows "Updated <now>". Accepted for v1, because it happens once per run. If it bothers anyone, add an option to skip the timestamp bump. Not a blocker.
- **Re-run resets seen**: `runTicketAgent` builds a new `agentRun` object without `seenAt`, so a new result is unseen. No change needed in the store.
- **Styles**: add `.agent-status-failed` next to `.agent-status-done` in `src/styles.css` (red glyph plus glow, matching the green). Add a small lane-header pill next to `.lane-count`.

## Tests (`src/shared/projectTypes.test.ts`)
- running=true → 'running', even with a seen or failed run saved
- no agentRun → null
- succeeded undefined → null
- seenAt set → null
- laneId ≠ ticket.laneId → null
- succeeded true/false, unseen, same lane → 'succeeded' / 'failed'

## Manual verification
- Run a failing agent → ✕ red on the card; the lane count goes up.
- Open the ticket → the badge and the count clear; reopening it doesn't write (`updatedAt` stays the same).
- Open via graph view → also clears.
- Drag the ticket to another lane → the badge hides. Drag it back while unseen → the badge returns.
- Switch to another board and back → the badges still match the saved data.

## Out of scope
OS notifications / dock badge, cancelling runs, terminal-launched runs (Run in Terminal/Warp/Ghostty — the app can't see when they finish).

## Open questions
None.
