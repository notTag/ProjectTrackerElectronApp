# PRD — Ticket #143: Ticket Dashboard section in the Display modal

## Problem
The board filter bar always shows every control: the filter text box, the swim lane filter, Assigned to me, and the No status / GitHub Issues column toggles. A user who never uses some of them can't hide them.

## Goal
A **Ticket Dashboard** section in the Display settings modal (⚙ Settings → Display) with a checkbox per filter bar control. Unchecking one hides it from the filter bar. The **Clear** button shows only while a filter is set, including any text in the box.

## Current behaviour (verified in code)
- Filter bar template: `src/views/BoardView.vue:1644-1697` (`.board-filters`).
  - Text box `filterQuery` (`:134`, input `:1646`), lane popover `filterLaneIds` (`:138`, menu `:1655`), Assigned to me `showOnlyMine` (`:136`, button `:1677`), column toggles `v-for="lane in toggleableLanes"` (`:1685`, computed `:273` = No status + GitHub Issues lane when present).
  - Clear: `<button v-if="filtersActive">` `:1696`.
- `filtersActive` `:548` = `filterQuery.trim() || laneFilterNarrows || showOnlyMine`. `clearFilters` `:552` resets those three. So Clear already appears and disappears with the filters. Gap: text that is only spaces doesn't count, so the box has text but no Clear.
- Display modal template ends `:1970`. Sections: Columns, Ticket Card (`:1933`), Swim lane Settings. Each is `.label-with-tip` eyebrow + `InfoTip` + `ul.card-field-list` of checkboxes.
- Prefs: `BoardPreferences` `src/shared/projectTypes.ts:2030`. Per user, per board. Hidden lists (`hiddenModalFields`, `hiddenLaneModalFields`) so things added later show by default. `getBoardPreferences` spreads saved prefs over `createDefaultBoardPreferences` (`:2059`), so old saves read a new key as its default. `toggleInList` `:2088` and the `toggle*` helpers sit next to it.
- `preferences` / `savePreferences` `BoardView.vue:217-219`.
- ⌘⇧F `:713` uses `filterQueryInput.value?.focus()`. If the box isn't rendered the ref is null and the shortcut does nothing. No crash.
- No main-process validation of `boardPreferences` keys (fff: no hits outside `src/`).

## Decisions
1. **Store a hidden list: `hiddenFilterControls: BoardFilterControl[]`, default `[]`.** Same reasoning as `hiddenModalFields`: a control added later shows by default.
2. **Control ids:** `query` (Ticket filter box), `lanes` ("All swim lanes" filter), `mine` (Assigned to me), `noStatus` (No status toggle), `githubIssues` (GitHub Issues toggle). They go in a `BOARD_FILTER_CONTROLS` list of `{ id, label }` in `projectTypes.ts`, next to `TICKET_CARD_FIELDS`.
3. **Hiding a control also clears its filter.** A hidden box with text in it, or a hidden "Assigned to me" left on, would narrow the board with nothing on screen to explain it. Hiding `query` empties the text, `lanes` empties the lane picks, `mine` turns it off. The view does this in its toggle handler, not the pure helper.
4. **Hiding a column toggle hides only the button.** The column's own show/hide stays as it is and can still be changed in the Columns section of the same modal.
5. **Clear doesn't touch the column toggles.** They are saved Display settings with their own section, not session filters. Clear keeps resetting text, lanes and Assigned to me. `filtersActive` uses `filterQuery.value !== ''` instead of `.trim()`, so any text in the box (spaces included) shows Clear.
6. **Section name and position:** "Ticket Dashboard", first in the modal, because the filter bar is the first thing on the board. InfoTip: "Show/Hide filter bar controls".
7. **The GitHub Issues row always shows in the modal**, even before issues are imported. The button itself still only appears once the lane exists.
8. The workflow label, the "X of Y" count, Clear and the view switch aren't toggleable. They weren't asked for.

## Requirements
- R1: `projectTypes.ts`: `BOARD_FILTER_CONTROLS`, type `BoardFilterControl`, `BoardPreferences.hiddenFilterControls`, default `[]`, `toggleFilterControl(preferences, control)` using `toggleInList`.
- R2: `BoardView.vue`: `showsFilterControl(id)` = `!preferences.hiddenFilterControls.includes(id)`. `v-if` on the text box, the lane `.filter-menu`, the Assigned to me button, and each column toggle (`noStatus` for `UNASSIGNED_LANE_ID`, `githubIssues` for `GITHUB_IMPORT_LANE_ID`).
- R3: `toggleFilterControlOnBoard(id)`: when it hides a control, reset that control's filter (Decision 3), close the lane popover if `lanes`, then `savePreferences(toggleFilterControl(...))`.
- R4: `filtersActive` → `Boolean(filterQuery.value || laneFilterNarrows.value || showOnlyMine.value)`.
- R5: Display modal: a "Ticket Dashboard" section before Columns, same markup as the Ticket Card section, one checkbox per `BOARD_FILTER_CONTROLS` entry, followed by `<hr />`.
- R6: `feature-map.md`: 3.3 says each control can be hidden from Display and that Clear shows for any text. 3.5 lists the new section first.

## Out of scope
- Toggling the workflow label, count, Clear or the view switch.
- Making Clear reset column visibility.
- Changing the Dashboard view's (`ProjectToolbar.vue`) filters.

## Acceptance
1. Display shows a "Ticket Dashboard" section with five checked boxes: Ticket filter box, Swim lane filter, Assigned to me, No status toggle, GitHub Issues toggle.
2. Unchecking any box hides that control from the filter bar right away. Checking it again brings it back. The setting survives a restart and is per board.
3. Hiding a control that has a filter set clears that filter, and the board and count update.
4. Hiding a column toggle doesn't change whether its column shows.
5. Clear shows whenever the box has any text, lanes are picked, or Assigned to me is on, and hides when none of those is true (typing then deleting the text shows it, then hides it).
6. With the text box hidden, ⌘⇧F does nothing and throws no error.
7. Boards with old saved prefs (no `hiddenFilterControls`) show every control.
8. `bun run test` and typecheck pass.

## Tests
- `src/shared/projectTypes.test.ts`: `toggleFilterControl` hides then shows a control. `getBoardPreferences` on saved prefs without the key returns `hiddenFilterControls: []`.

## Verify
- Run the app on an isolated DB copy (run-app / CDP memory). Hide each control and screenshot the filter bar. Type text, pick a lane, then hide those controls and confirm the board un-narrows. Type then clear text and watch Clear appear and disappear. Restart and confirm the hidden controls stay hidden.

## Files
- `src/shared/projectTypes.ts`: list, type, pref key, default, toggle helper
- `src/shared/projectTypes.test.ts`: two tests
- `src/views/BoardView.vue`: `v-if`s, toggle handler, `filtersActive`, modal section
- `feature-map.md`: 3.3 and 3.5

## Branch / worktree
- Branch: `t143-add-a-ticket`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t143`

## Open questions
None. Decisions 3–5 are defaults and can be changed.
