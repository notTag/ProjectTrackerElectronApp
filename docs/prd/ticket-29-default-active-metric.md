# PRD — Ticket #29: Dashboard opens with "Active" selected

## Problem
The Dashboard (`src/views/DashboardView.vue`) opens with no metric tile selected (`activeMetric = ref<MetricFilter>(null)`), so every project shows. The user mostly cares about active work, so the first view should be the "Active" tile with the list filtered to `status === 'active'`.

## Goal
Opening the Dashboard shows the "Active" tile selected and the list filtered to active projects, using the same state a click on that tile produces.

## Current behaviour (verified in code)
- `setMetricFilter(metric)` toggles `activeMetric` and syncs filters. For `'active'` it sets `selectedPriorities = []` and `selectedStatuses = ['active']`.
- `clearFilters()` resets query, statuses, priorities and `activeMetric` to empty/null.
- `App.vue` renders a bare `<RouterView />` with no `<KeepAlive>`. DashboardView is destroyed when you open a board and rebuilt when you come back, so all its local filter state (query, statuses, priorities, metric) is already lost on every return trip.

## Decisions (open questions resolved)
1. **On every mount, not only the first launch.** The view remounts and loses all its filter state anyway, so "reset to Active" fits how the view already behaves. Keeping a selection across navigation would mean moving the filter state into the Pinia store. That is a separate change, and the ticket only asks for a better default.
2. **No active projects: keep Active selected and show the empty list.** No fallback to all projects. The rule stays the same whatever the data says, and the tile count shows `0`, so the empty list is easy to understand. Not falling back also avoids a flash from Active to All while `store.load()` is still in flight.
   - Onboarding never lands on an empty list: `mergeScannedProjects` makes the first project ever added `'active'`, and every later project starts as `'unknown'`.

## Requirements
- R1: When DashboardView mounts, `activeMetric === 'active'`, `selectedStatuses` equals `['active']` and `selectedPriorities` equals `[]`.
- R2: The default goes through `setMetricFilter('active')` at setup. There is no second code path that sets these refs.
- R3: Clicking "Active" again clears the selection (the existing toggle).
- R4: Clicking any other tile, the status/priority toolbar filters, or "Clear filters" works as it does today.
- R5: Going to a board and back resets the Dashboard to Active (from decision 1).

## Implementation
One line in `DashboardView.vue`, placed after the `setMetricFilter` declaration (it is a `const` arrow function, so a call above its declaration would hit the TDZ):

```ts
setMetricFilter('active')
```

Calling it at setup, not in `onMounted`, means the first render is already filtered, so the list does not flicker.

## Testing
- The repo has no Vue component tests yet. All existing vitest suites cover `electron/` and `src/shared/`, and there is no `@vue/test-utils` setup. Adding that harness for a one-line change is not worth it, so check this by hand.
- Manual check:
  1. Fresh launch: the Active tile is highlighted, the toolbar status filter shows Active, and only active projects are listed.
  2. Click Active: the selection clears and all projects show.
  3. Click Ongoing or High: the filters switch correctly.
  4. Click Clear filters: everything clears.
  5. Open a board and go back: Active is selected again.
- Run `bun run test` and `bun run build` to confirm nothing else regressed.

## Out of scope
- Remembering the last chosen tile across restarts or navigation (would need the filter state in the store or persisted).
- Changing how the metric tiles are counted.
