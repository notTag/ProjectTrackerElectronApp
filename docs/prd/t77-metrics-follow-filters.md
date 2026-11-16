# PRD — Ticket #77: Metrics follow the Dashboard filters

## Context
The Dashboard 📊 Metrics popover (`src/components/MetricsPanel.vue`, mounted at `src/views/DashboardView.vue:391`) always reports every project, whatever filters the list has.

Root cause: `DashboardView.vue:89`
```ts
const metricsProjectPaths = computed(() => store.projects.map((project) => project.path))
```
uses `store.projects` (all), not `filteredProjects` (`DashboardView.vue:91`, what the list shows).

Since #29 the Dashboard opens with the **Active** tile selected (`setMetricFilter('active')`), so after this fix the popover opens showing only active projects by default. That is intended: it matches the list.

## Verified facts (code read on `84e6a72`)
- `filteredProjects` already applies every list filter: search `query`, `selectedStatuses` (metric tiles write into this), `selectedPriorities`, the `thirdparty` tile, and hidden exclusion unless `'hidden'` is in `selectedStatuses`.
- `MetricsPanel` watches `projectPaths.join('\n')` (`MetricsPanel.vue:71-76`) and reloads when open → no new wiring needed for refresh.
- `load()` clears `rows` first and guards stale responses with `latestRequest` (`MetricsPanel.vue:38-51`). Out-of-order results are already safe. Per-keystroke reloads would still blink the table to "Loading…" and run git/gh for every project on every key.
- `getMetrics([])` is safe: `closedTicketMetrics` returns `[]` for no paths (`electron/storage/stateRepository.ts:616`). Empty `rows` already hides Totals (`showTotals`, `MetricsPanel.vue:102`). The table still renders an empty header with no message.
- No Vue component test setup (no `@vue/test-utils` / jsdom). Tests are plain vitest on pure fns (`src/shared/*.test.ts`).

## Scope
In
- Dashboard Metrics popover rows + Totals = the same project set the list shows
- All filters behind `filteredProjects`: metric tiles, status, priority, search, hidden

Out
- Board view MetricsPanel (already `[projectPath]`)
- Metric tile counts (stay global; they are the filter controls)
- Per-card Metrics tab (single project)
- "Metrics · N projects" header label (optional nicety in the ticket; skip unless cheap — the list beside it already shows the count)

## Requirements
- R1. `metricsProjectPaths` derives from `filteredProjects.value` (one-line change at `DashboardView.vue:89`; move it below `filteredProjects` to avoid a use-before-declare read).
- R2. Debounce the `projectPaths` watcher in `MetricsPanel` by ~300 ms (plain `setTimeout`/`clearTimeout`, clear on unmount). Opening the panel and the ↻ button still load immediately. Board scope never changes paths, so it is unaffected.
- R3. Empty filter result → popover shows "No projects match the current filters." instead of an empty table. No Totals, no stale rows, no error. Skip the IPC call when `projectPaths` is empty (set `rows = []` directly).
- R4. Hidden projects appear only when the hidden filter is on (inherited from `filteredProjects`; no extra code).

## Acceptance criteria
- Select "Active" → popover lists only active projects; Totals sum only those
- Change status/priority filter or type in search → popover rows match the visible list (one reload after typing stops, not one per key)
- Clear filters → popover shows all non-hidden projects (same as list)
- Hidden projects excluded unless the hidden filter is on
- Filter with 0 matches → empty-state text, no rows, no Totals, no error
- Board view metrics unchanged

## Tests
- Extract the `filteredProjects` predicate into a pure fn (e.g. `projectMatchesFilters(project, filters)` in `src/shared/`, beside existing shared helpers) and unit-test it: Active filter → only active paths; hidden excluded by default, included with `'hidden'`; empty result. `DashboardView` then calls it, so the paths passed to MetricsPanel come from the tested fn. No new test deps.
- `bun run test` + `bun run typecheck` green.
- Manual (required before merge): run the app on an isolated DB copy, open the popover, toggle Active / status / priority / search / hidden, confirm rows follow the list and a 0-match filter shows the empty state.

## Risks
- Debounce leaves the old rows visible ≤300 ms after a filter change. Acceptable; `load()` clears them as soon as it fires.
- Large unfiltered sets still cost one git/gh pull per project. Unchanged from today.

## Work location
- Branch: `t77-the-metrics-shown`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t77`

## Open questions
None.
