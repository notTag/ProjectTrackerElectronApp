# PRD: Project metrics charts (#26)

Revised 2026-11-12. Supersedes the 2026-11-09 draft: #27 (`2b1db42`, PR #65) has since merged to `main` and built the whole data layer that draft specified. #26 is now a UI-only delta on top of it.

## Problem
An expanded project card on the Dashboard shows type, status, priority, notes and README. Metrics exist today only as a table inside the `📊 Metrics` popover (dashboard toolbar = all projects, board toolbar = one project). Nothing in the expanded card shows whether that project's work is moving. Add a Metrics tab to the expanded card with bar charts, fetched fresh on every expand.

## Already on main (from #27) — reuse, do not rebuild
- `tickets.closed_at` + triggers (`CLOSED_AT_TRIGGERS_SQL`, `electron/storage/schema.ts`), `SCHEMA_VERSION = 5`
- Closing lanes are configurable per board ("Counts as closed" checkbox, `swim_lanes.closes_ticket`); `in-dev`, In QA, `in-production` seeded + backfilled
	- Resolves old Q1 (which lane = closed). No hard-coded `CLOSED_LANE_ID`
- `metricWindows(now)` in `electron/metrics.ts`: today / rolling 7d / month / year, local time
- PR counts: one GraphQL request per repo (`prCounts`), open + merged per window
- Running agents: `runningAgentsByProject` via `ps` + `lsof` cwd (sees Auto Run terminal sessions too, so no renderer `agentRunning` count needed)
- IPC `metrics:get({ projectPaths })` → `ProjectMetrics[]`; preload `getMetrics(projectPaths)`; renderer `projectTrackerApi.getMetrics`
- Types in `src/shared/projectTypes.ts`:
	- `ProjectMetrics { projectPath, name, closed: MetricWindowCounts, hasClosingLanes, prs?: ProjectPrMetrics | { error }, agentsRunning: number | null }`
	- `prs === undefined` → no GitHub repo; `{ error }` → PR fetch failed; `agentsRunning === null` → process listing failed
- `MetricsPanel.vue` has the `prs` narrowing helpers (`prCounts`, `prUnavailableReason`)

## Decisions
- D1. Data: call `projectTrackerApi.getMetrics([project.path])` on expand. No new IPC, no schema change, no store-wide cache
- D2. Freshness: fetch in `toggleProject()` (`src/views/DashboardView.vue:253` on main) when it expands, not on collapse. Clear that card's previous result before the call so stale numbers never show as current. Collapse + re-expand fetches again
- D3. State: local refs in `DashboardView.vue` (`cardMetrics: Record<path, ProjectMetrics | undefined>`, `cardMetricsLoading`, `cardMetricsError`). Only one card expands at a time; a Pinia store entry is not needed
	- Guard against out-of-order replies: ignore a response whose path is no longer `expandedProjectPath`
- D4. Tab: extend `ProjectTab` (`:16`) to `'details' | 'readme' | 'metrics'`, third tab button next to README (`:516` block)
- D5. Charts: plain CSS bars, no chart dependency
	- Bar height = `count / max(counts) * 100%`, min 2px when count > 0, number label on every bar
	- Labels: Today / 7d / Month / Year
	- One small `MetricBars.vue` component (`counts: MetricWindowCounts`), used twice: Tickets closed, PRs merged
- D6. Tiles: PRs open, Agents running
- D7. Per-source states (one failing source never blanks the others):
	- `!hasClosingLanes` → closed chart replaced by "No lane counts as closed — set one in lane settings"
	- `prs` undefined → "No GitHub repo" in place of PR chart + PR tile
	- `prs.error` → inline error in the PR block
	- `agentsRunning === null` → "—" on the agents tile
	- whole `getMetrics` call rejects → inline error in the panel, never global `store.error`
- D8. Reuse the `prs` narrowing from `MetricsPanel.vue`: move `prCounts` / `prUnavailableReason` to a shared helper (e.g. `src/shared/metrics.ts`) rather than copying

## Requirements
- R0. Rebase `t26-create-a-metrics` onto latest `main` (branch is on `ebdfcd5`, main is `f405122`+); old R1/R2 are dropped
- R1. `MetricBars.vue` + CSS in `styles.css` (respect existing light/dark tokens)
- R2. `DashboardView.vue`: Metrics tab, fetch on expand (D2/D3), loading text "Loading metrics…", D7 states, "Updated {time}" from the fetch time
- R3. Shared `prs` helpers (D8), `MetricsPanel.vue` switched to them
- R4. Tests: `MetricBars` scaling (max 0 → no NaN heights, min height when count > 0); helper narrowing for undefined / error / counts

## Acceptance criteria
- Expanding a card shows a Metrics tab; selecting it shows loading, then charts. Data is fetched on every expand
- Tickets closed and PRs merged render as 4-bar charts with numbers; PRs open and Agents running render as tiles
- Project without `githubUrl` → "No GitHub repo", ticket + agent metrics still render
- A failing PR or agent source shows inline and doesn't blank the rest
- A ticket moved via `sqlite3` into a closing lane shows in the closed chart on the next expand (already true via #27 triggers; verify only)

## Out of scope
- Any change to `metrics:get`, triggers, `closed_at`, closing-lane config, PR or agent counting (#27 owns them)
- Auto-refresh while expanded, custom ranges, trends, historical charts

## Open questions
- None blocking. Non-blocking note: the board-level `📊 Metrics` popover already shows these numbers for one project as a table; #26 adds the same numbers as charts inside the dashboard card. If that duplication isn't wanted, close #26 as covered by #27

## Effort
About half a day. Mostly UI; data path already exists.

## Branch / worktree
- Branch: `t26-create-a-metrics`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t26`
