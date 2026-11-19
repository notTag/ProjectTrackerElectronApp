# PRD — Ticket #107: Swim lane filter becomes a multi-select

## Problem
The board filter bar's lane filter is a single `<select>`: "All swim lanes" or exactly one lane. The user wants to see several lanes at once (e.g. Idea + PRD + In Development).

## Goal
Pick any set of lanes from a checkbox popover. The board shows only those columns, in board order. Picking none shows all lanes, same as today's "All swim lanes".

## Current behaviour (verified in code)
- `src/views/BoardView.vue:106` `filterLaneId = ref('')`. Single id, component state only, not persisted.
- `:203` `visibleLanes` drops hidden lanes (`laneIsHidden`), then narrows to `filterLaneId`.
- `:245` `laneCanMove` returns false while `filterLaneId` is set.
- `:419` `filtersActive` and `:423` `clearFilters` read and reset `filterLaneId`.
- `:1411` `<select v-model="filterLaneId">` over `laneColumns` (No status + board lanes).
- `:1627` lane add zone `v-if="!filterLaneId"`.
- Readers of `visibleLanes` (`visibleTicketCount`, `movableVisibleLanes`, Auto Run, bulk drag of checked tickets, graph view) already follow the filter. They need no change.
- An existing popover in this file can be copied: the ticket modal fields menu (`modalFieldsMenuOpen` `:136`, `modalFieldsMenuRef` + `closeModalFieldsMenuOnOutsideClick` `:182`, template `:1805` with `aria-expanded` and `.filter-popover role="group"`). It uses the `filter-popover` styles from `src/styles.css:354`.
- `handleBoardKeydown` `:576`: an Escape nobody claims runs `router.push('/')` and leaves the board. The fields menu claims Escape at `:590`. The lane popover has to do the same.
- `ProjectToolbar.vue`'s filter menus close on outside click but have no Escape handling. Don't copy that gap.
- No existing test references `filterLaneId` (fff search). There are no BoardView component tests to update.

## Decisions
1. **Hold the selection as `filterLaneIds = ref<string[]>([])`. Empty means all lanes.**
2. **Clean up stale ids with a computed, not a watcher.** `activeFilterLaneIds = computed(() => filterLaneIds.value.filter(id => laneColumns.value.some(lane => lane.id === id)))`. Every reader uses the computed. If a lane is deleted, or the route switches project while BoardView stays mounted, the leftover ids are ignored, so the board can't go blank and the trigger can't say "2 lanes" when only 1 is real. The raw ref can keep dead ids. Nothing persists it, so that does no harm.
3. **Columns stay in board order, not the order they were picked.** `shownLanes.filter(lane => activeFilterLaneIds.value.includes(lane.id))`.
4. **Hidden lanes are still listed in the popover**, as in today's `<select>`. Checking one doesn't show it, because the hidden-lane toggle wins. If every checked lane is hidden, the board is empty. That matches what today's single filter does when you pick a hidden lane.
5. **Lane drag and the `+` add-lane zone are off whenever any lane filter is set**, even with 2+ lanes showing. Reordering against a subset is ambiguous. The `laneCanMove` comment should say "a filtered board", not "one lane".
6. **The popover closes on outside click and on Escape.** Escape is claimed in `handleBoardKeydown` before the modal branch, so it doesn't leave the board.

## Requirements
- R1: State is `filterLaneIds: string[]` plus the computed `activeFilterLaneIds`. Remove `filterLaneId`.
- R2: `visibleLanes` = shown lanes, narrowed to `activeFilterLaneIds` when that is non-empty (board order).
- R3: `laneCanMove`, the lane add zone `v-if` and `filtersActive` test `activeFilterLaneIds.length`.
- R4: `clearFilters` sets `filterLaneIds = []`.
- R5: Replace the `<select>` with a `.filter-menu` > `button.filter-trigger` + `.filter-popover`, one checkbox per `laneColumns` entry.
  - Trigger label: "All swim lanes" when none are picked, the lane name when 1, "N lanes" when 2 or more (from `activeFilterLaneIds`).
  - `active` class on the trigger when any lane is picked.
  - `aria-expanded` on the trigger. `role="group"` and `aria-label="Swim lanes shown"` on the popover.
  - Checkbox toggle: add or remove the id (same toggle as `toggleStatusFilter` in `ProjectToolbar.vue`).
- R6: The popover closes on a `pointerdown` outside its menu ref. Register and unregister the listener alongside the fields-menu one.
- R7: When the popover is open, Escape closes it, calls `preventDefault`, and stops there. This branch goes in `handleBoardKeydown` next to the fields-menu branch.
- R8: Keyboard: Tab reaches the trigger, Enter/Space toggles it, Tab moves through the checkboxes and Space toggles each one. Native button and checkbox elements give this with no extra code.
- R9: Update `feature-map.md`:
  - `:268`: "**All swim lanes** select: limits the board to a single column" → a multi-select popover.
  - `:279` and `:287`: "single column" → "while any lane filter is set".

## Out of scope
- Saving the filter across restarts or navigation. Today's filter isn't saved either.
- Changing how Auto Run, bulk drag or the graph view treat filtered-out lanes.
- Adding Escape handling to `ProjectToolbar.vue`'s menus.

## Acceptance
1. Pick 2 or more lanes: only those columns show, in board order, and the ticket count is the sum of the shown lanes.
2. Pick none: all non-hidden lanes show.
3. A hidden lane (No status / GitHub Issues toggles) stays hidden even when it is checked.
4. Toolbar **Clear** resets the lane filter to all lanes. The trigger reads "All swim lanes" and loses `active`.
5. Lane drag and the `+` zone are disabled while any lane is picked and come back once it is cleared.
6. Auto Run and bulk drag skip tickets in filtered-out lanes (unchanged).
7. Deleting a picked lane leaves the other picked lanes showing. If it was the only one picked, all lanes show again.
8. The popover closes on outside click. Escape closes the popover and leaves the user on the board.
9. Everything works by keyboard (R8).
10. `bun run test` and typecheck pass.

## Tests
- No BoardView component test harness exists. If `visibleLanes` or the trigger label logic moves to a pure helper (e.g. next to `boardLaneColumns`), add one small unit test: empty selection, a 2-lane subset in board order, a stale id ignored, a hidden lane excluded. Otherwise the manual verification below covers it.

## Verify
- Run the app on an isolated DB copy (see the run-app memory / CDP recipe). Pick 2 lanes and screenshot the board and the open popover. Press Escape and confirm you're still on the board. Clear and confirm all lanes come back. Delete a picked lane and confirm the board doesn't go blank.

## Files
- `src/views/BoardView.vue`: state, computeds, template, outside-click, Escape branch
- `feature-map.md`: lane filter wording
- `src/styles.css`: only if the trigger needs sizing in the board filter bar (reuse `.filter-menu` / `.filter-trigger` / `.filter-popover`)

## Branch / worktree
- Branch: `t107-update-the-swimlanes`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t107`

## Open questions
None.
