# PRD — Ticket #131: Dynamic Graph view

## Summary
Turn the graph view from a read-only lane state diagram into an editor for the workflow. Tickets leave the canvas. Lane nodes can be dragged anywhere, new lanes can be added from the graph, and each node gets a connector dot on its left and right edge. Dragging from one dot to another lane's dot draws an arrow and sets the origin lane's Next Lane.

## Current state (verified on `t131-dynamic-graph-view` @ ea114d3)
- `src/components/TicketGraph.vue` (255 lines), from #71: lanes in one fixed row, Next Lane arcs above (forward) and below (backward) the row, dashed per-ticket override edges with "N tickets" labels, ticket chips stacked under each lane with a ▶ badge when armed. Layout is a hand-rolled `computed`, no graph library.
- Props: `projectName`, `lanes` (visible lanes), `boardLanes` (all lane columns), `tickets`, `ticketOpen`. Emits `ticket(id)`, `selection`, `editLane(lane, patch)` (patch typed to the two prompt fields only).
- Mounted at `src/views/BoardView.vue:1675` behind the `boardView` switch (`'lanes' | 'graph'`).
- Next Lane is `SwimLane.nextLaneId` (`swim_lanes.next_lane_id`), from #67. Written through `store.updateLane(projectPath, laneId, patch)`.
- Add lane: `store.addLane(projectPath, name)` (`src/stores/projects.ts:323`); the swimlane view's "+" uses `laneDraftName` / `saveLaneDraft` in `BoardView.vue`.
- Lane columns live in `electron/storage/schema.ts`; new columns go in the column-migration list there (see `waits_for_pull_request_merge`, line 189).
- feature-map.md §3.12 documents the graph view.

## Decisions (defaults, non-blocking)
- D1 — No tickets on the canvas. Ticket chips, the ▶ armed badge, and the dashed per-ticket override edges are removed. Override edges are derived from tickets, and drawing them would put ticket-level arrows next to the editable lane arrows. The lane sidebar drops its "Ticket overrides" list for the same reason. A ticket count on the lane node is kept ("Swim lane · 3") because it's a number, not a ticket.
- D2 — Free-form node positions. A lane node is dragged with the pointer (pointer events, no library) anywhere on the canvas. Dragging starts on the node body; a plain click with no movement still selects the lane.
- D3 — Positions persist per lane: new optional `SwimLane.graphPosition?: { x: number; y: number }`, stored in a new `swim_lanes.graph_position_json TEXT` column (added to the schema and the migration list). Saved once on drop, not on every pointer move.
- D4 — A lane with no saved position gets the current row layout as its default spot (`LEFT_MARGIN + index × COLUMN_WIDTH`, one row), so existing boards look the same until someone drags a node.
- D5 — Moving a node in the graph does not reorder the swimlane columns. Board order stays owned by the swimlane view.
- D6 — Canvas grows to fit the farthest node plus a margin; `.graph-scroll` scrolls as today. Nodes can't be dropped at negative coordinates (clamped to 0).
- D7 — Add swimlane from the graph: a "+ Add swim lane" button in the graph toolbar/sidebar (project view) opens the same name prompt the swimlane view's "+" uses and calls `store.addLane`. The new lane appears at the next default slot (D4), right of the rightmost node.
- D8 — Connector dots: every lane node shows a small dot centered on its left edge and one on its right edge. Pointer-down on either dot starts a connection from that lane; an arrow follows the pointer. Releasing over any dot of a different lane node sets the origin lane's `nextLaneId` to that lane. Releasing anywhere else (empty canvas, the origin's own dots or body) cancels with no change.
- D9 — 1:1 only. A lane has at most one outgoing arrow. Connecting a lane that already has a Next Lane replaces it. Multiple lanes may still point at the same target (that's today's model).
- D10 — Edges are drawn from the origin node's right dot to the target node's left dot as a cubic bezier, using the existing arrow marker. Above/below arc routing from #71 goes away since nodes are no longer in a fixed row.
- D11 — Removing a connection: clicking an arrow selects it (highlighted); Delete/Backspace or an × button at its midpoint clears the origin lane's Next Lane. The Lane settings Next Lane dropdown keeps working as before and the graph updates live from it.
- D12 — Writes go through `store.updateLane`. `TicketGraph`'s `editLane` patch type widens to `Partial<Pick<SwimLane, 'agentPrompt' | 'orchestratorPrompt' | 'nextLaneId' | 'graphPosition'>>`; `BoardView`'s handler is unchanged.
- D13 — Lanes outside the visible set (hidden or filtered) aren't drawn and can't be connection targets; the "Next Lane: X (hidden)" sidebar line from #71 stays. Start, terminal, and unreachable state markers from #71 stay.
- D14 — Component rename `TicketGraph.vue` → `LaneGraph.vue` is out of scope; keep the file name to keep the diff focused.

## Requirements
- R1: Drop ticket chips, armed badges, override edges, and the sidebar ticket-overrides list from `TicketGraph.vue` (D1).
- R2: `graphPosition` on `SwimLane`, `graph_position_json` column + migration, read/write in the state repository (D3).
- R3: Draggable lane nodes with saved positions and row-layout fallback (D2, D4–D6).
- R4: "+ Add swim lane" from the graph (D7).
- R5: Left/right connector dots, drag-to-connect with a live arrow, drop on another lane's dot sets `nextLaneId` (D8, D9).
- R6: Bezier edges between dots; select + delete an edge to clear Next Lane (D10, D11).
- R7: Styles in `src/styles.css` next to the existing `.graph-*` rules, light and dark themes. Dots get a hover/active state and a crosshair-style cursor; nodes get a grab cursor.
- R8: Update feature-map.md §3.12.

## Acceptance criteria
- AC1: Graph view shows no ticket nodes, no armed badges, and no dashed override edges.
- AC2: Dragging a lane node moves it; after switching to Swimlane view and back, or restarting the app, it's still where it was dropped. Swimlane column order is unchanged.
- AC3: A board where no lane has a saved position looks like today's row of lanes.
- AC4: "+ Add swim lane" in the graph creates a lane that appears both as a new graph node and as a new swimlane column.
- AC5: Every lane node has one dot on its left edge and one on its right. Dragging from a dot shows an arrow following the pointer.
- AC6: Dropping that arrow on a dot of lane B sets the origin lane's Next Lane to B; the Lane settings modal shows B, and the graph draws the arrow.
- AC7: Connecting a lane that already has a Next Lane replaces the old arrow (never two outgoing arrows).
- AC8: Dropping on empty canvas or on the origin lane changes nothing.
- AC9: Selecting an arrow and pressing Delete (or clicking its ×) clears the origin lane's Next Lane; the lane becomes terminal (double border).
- AC10: A click on a node without dragging still selects it in the sidebar; the sidebar's prompt-rule editing from #79 still works.
- AC11: `bun run test` passes; `bun run typecheck` and `bun run build` are clean.

## Tests
- `electron/storage/stateRepository.test.ts`: `graphPosition` round-trips; a lane without the column value loads with no `graphPosition`.
- `src/shared/projectTypes.test.ts` (or a small pure helper next to the graph): default position fallback (D4) and canvas bounds (D6), if extracted as a pure function.
- `src/stores/projects.test.ts`: `updateLane` with `nextLaneId` / `graphPosition` patches persists via the API (likely covered already; add if not).
- Manual (CDP, isolated DB): drag a node, connect two lanes, delete an arrow, add a lane, restart, confirm persistence.

## Out of scope
- 1:N Next Lanes (a lane with several outgoing arrows). Future ticket; D9 keeps the data model single-valued so that change is a schema change plus edge-list UI.
- Auto-layout (dagre etc.), zoom/pan, snapping to a grid, multi-select drag.
- Showing tickets or per-ticket overrides anywhere in the graph.
- Renaming or deleting lanes from the graph (Lane settings modal still owns that).
