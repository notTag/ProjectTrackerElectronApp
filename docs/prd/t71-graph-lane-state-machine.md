# PRD — Ticket #71: Graph view as a lane state machine (DFA)

## Summary
Turn the graph view into a state diagram of the board's workflow. Each swim lane is a state. Each lane's Next Lane is a transition arrow to the lane its tickets go to on completion. Tickets hang under the state they sit in. A ticket whose own Next Lane differs from its lane's default draws its own dashed transition.

## Dependency
- Blocked on #67 (Next Lane field, `t67-add-a-field`, In Development, not on `main` yet). #67 adds `SwimLane.nextLaneId?: string` and `effectiveNextLaneId(ticket, lane)` in `src/shared/projectTypes.ts`. This ticket reads both and adds no data.
- Start implementation after #67 merges: rebase `t71-the-graph-view` onto `main` first.
- #67's PRD lists "Next Lane on ... graph view edges" as out of scope. This ticket is that follow-up.

## Current state (verified on `main` @ 3a794ca)
- `src/components/TicketGraph.vue` (61 lines): three-level tree. Project node → lane nodes → ticket nodes, joined by SVG cubic paths. Fixed 860px-wide SVG, height from ticket counts. An arrow `<marker id="ticket-graph-arrow">` is defined but unused.
- Props: `projectName`, `lanes`, `tickets`, `ticketOpen`. Emits `ticket(id)` and `selection`.
- Mounted in `src/views/BoardView.vue:926` with `:lanes="visibleLanes"`. `visibleLanes` is `laneColumns` (`[unassignedLane, ...board.lanes]`) minus hidden lanes, narrowed by the lane filter. So the unassigned lane already reaches the graph when it isn't hidden; no new prop is needed.
- Sidebar (`.graph-details`): project selected → lane list with counts; lane selected → its tickets.
- feature-map.md §3.12 documents the tree.
- No lane-level next lane on `main` yet. Ticket-level target is `Ticket.moveToLaneId` + armed flag `moveOnComplete`.

## Decisions (defaults, non-blocking)
- D1 — Replace the tree, no toggle. The Project node and Project→lane edges go away. The project name stays as the sidebar heading when nothing is selected.
- D2 — States: one node per lane in the `lanes` prop, left to right in the order given (board order, unassigned first). Unassigned follows the existing hide toggle; no special casing in the graph.
- D3 — Transitions: lane A → lane B arrow when `A.nextLaneId === B.id` (uses the existing arrow marker). Forward arcs (B right of A) curve above the row, backward arcs (e.g. Merge Request → In Development) curve below, so cycles stay readable. A lane can't point at itself (#67 D4), so no self-loops.
- D4 — State markers, DFA style:
  - Start state: an entry arrow into the first lane in the row.
  - Terminal state: double border on a lane with `closesTicket` or with no Next Lane (tickets stop there).
  - Unreachable state: a lane with no incoming transition that isn't the start state is dimmed. Tickets can still be dragged there by hand, so it's a hint, not an error.
- D5 — Ticket overrides: a ticket whose `effectiveNextLaneId` differs from its lane's `nextLaneId` adds a dashed arrow from its lane to its own target, labeled with the ticket count ("2 tickets"). Same-source, same-target overrides merge into one dashed edge. Inherit-only tickets add no edge.
- D6 — Armed state: tickets with `moveOnComplete` show a small ▶ badge on their node, since only armed tickets actually move. Edges are drawn for every resolved target, armed or not.
- D7 — Tickets stay as nodes stacked under their state (same chip style as today); clicking one opens the Ticket side panel exactly as now (`emit('ticket', id)`).
- D8 — Edges to hidden, filtered-out, or missing lanes: no arrow. The source lane's sidebar shows "Next Lane: <name> (hidden)" when the lane exists on the board, nothing when it's missing.
- D9 — Sidebar:
  - Project: lane list with counts (as today) plus a "Transitions" list, one line per arrow: "In Development → Merge Request".
  - Lane: ticket count, Next Lane (or "None — tickets stop here"), incoming lanes, then the ticket list as today. Ticket overrides list as "#N → <lane>".
- D10 — Layout math stays in the component as a `computed`, no graph library. Horizontal scroll in `.graph-scroll` when lanes overflow; SVG width = lane count × column width.
- D11 — Pure helper `laneTransitions(lanes, tickets)` in `src/shared/projectTypes.ts` returns `{ from, to, kind: 'lane' | 'override', ticketIds }[]`, dropping targets not in `lanes`. Unit-tested; the component only draws it. Sidebar "(hidden)" names come from a lane-name lookup the view already has, passed as a prop only if needed.

## Requirements
- R1: `laneTransitions` helper (D3, D5, D8, D11) using `effectiveNextLaneId` from #67.
- R2: `TicketGraph.vue` renders states in a row, transition arcs above/below, override edges dashed with count labels (D2–D5).
- R3: Start, terminal and unreachable markers (D4).
- R4: Ticket nodes under each state, ▶ badge for armed tickets, click opens the ticket (D6, D7).
- R5: Sidebar additions (D9).
- R6: Styles in `src/styles.css` next to the existing `.graph-*` rules, light and dark themes.
- R7: Update feature-map.md §3.12 to describe the state diagram.

## Acceptance criteria
- AC1: With Next Lanes set Idea → PRD → In Development → Merge Request, the graph shows those four states joined by three arrows in that order.
- AC2: Setting a lane's Next Lane to an earlier lane draws an arc below the row back to it.
- AC3: A lane with no Next Lane, or with `closesTicket`, has a double border. The first lane has an entry arrow.
- AC4: A ticket with its own Next Lane different from its lane's draws a dashed arrow to it; two such tickets in the same lane to the same target show one edge labeled "2 tickets".
- AC5: Changing a lane's Next Lane in Swimlane settings updates the graph without a reload.
- AC6: Clicking a ticket node opens the Ticket side panel; clicking a state selects it in the sidebar, as today.
- AC7: Filters and hidden lanes behave as in the swimlane view; arrows into hidden lanes are dropped (D8).
- AC8: A board with no Next Lanes still renders: states in a row, every lane terminal, no arrows.
- AC9: `bun run test` passes, typecheck and build are clean.

## Tests
- `src/shared/projectTypes.test.ts` for `laneTransitions`: lane edge, backward edge, override merged by target, inherit-only ticket adds no edge, hidden/missing target dropped, unassigned lane as source.
- Component: none required; layout lives in the tested helper.

## Out of scope
- Editing Next Lane by dragging arrows in the graph.
- Animating tickets along edges or showing move history.
- Agent full-auto prompts reading Next Lane.
- Any change to #67's data model.

## Risks
- Wide boards (10+ lanes) make arcs cross. Horizontal scroll handles width; arc height scales with distance so nested arcs don't overlap. Revisit with a layered layout if it gets messy.
- If #67's review changes `effectiveNextLaneId`, this ticket follows whatever lands.

## Open questions
None blocking. D1 (replace the tree rather than add a toggle) is the main call and easy to flip.

## Effort
About half a day once #67 is merged: one helper with tests, one component rewrite, CSS.

## Branch / worktree
- Branch: `t71-the-graph-view`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t71`
- PRD file: `docs/prd/t71-graph-lane-state-machine.md` (on this branch)
