# PRD — #145 Settings as a single floating panel with collapsed accordion sections

Branch `t145-settings-as-a` · Worktree `.worktrees/t145` · Base `main @ 39c3f2c` (v0.9.0)

## Problem
Settings takes two hops today. `⚙ Settings` (`BoardView.vue:1635`) opens a Settings modal (`settingsOpen`, l.1977-1994). That modal holds a Metrics panel, a `Display` button that swaps to a second modal (`boardSettingsOpen`, l.1911-1975), and a `🎚 UI Settings` button that closes the modal and opens the floating `UiSettingsPanel` (also titled "⚙ Settings"). The user wants one Settings surface: the floating panel. Every section should be an accordion inside it, and all of them should start collapsed.

## Decisions
- D1. The `⚙ Settings` header button toggles `uiDemoPanelOpen` (`src/uiDemo.ts:137`) directly. Both modals go away: `settingsOpen`, `boardSettingsOpen`, `openDisplaySettings`, `openUiSettingsPanel` and their template blocks.
- D2. `UiSettingsPanel.vue` owns all three `<details>` sections in this order: **Metrics**, **Display**, **UI Settings**. Metrics and Display content depends on BoardView (`projectPath`, lane visibility, card and lane field toggles), so it comes in through two named slots, `#metrics` and `#display`. The accordion markup lives in one file, and Display's board-local state stays in BoardView with no new store.
- D3. Section content moves over unchanged:
  - Metrics = `<MetricsPanel :project-paths="[projectPath]" scope="board" />`
  - Display = the three lists from the old Display modal body (Swimlane, Ticket Card, Swim lane Settings, with the `<hr />`s between them). Its Done button goes.
  - UI Settings = the existing `UI_DEMO_CONTROLS` rows + Reset
- D4. Accordion = native `<details>/<summary>` (the #136 precedent). Reuse the existing `.lane-settings-section` / `.lane-settings-section-body` CSS (chevron, focus ring, reduced motion) and `class="eyebrow"` on `<summary>`. No new accordion CSS.
- D5. Open state lives at module scope in `src/uiDemo.ts`, next to `uiDemoPanelOpen`:
  ```ts
  // ponytail: app-session only, never saved (same as laneModalSectionsOpen, #136)
  export const settingsSectionsOpen = reactive({ metrics: false, display: false, ui: false })
  ```
  Bind with `:open="settingsSectionsOpen.metrics"` + `@toggle` that writes `(event.target as HTMLDetailsElement).open` back. Everything starts collapsed. Open state survives closing and reopening the panel and Board ↔ Dashboard remounts, and resets on app restart.
- D6. Scrolling: the panel caps at the viewport, `.ui-demo-panel { max-height: calc(100vh - 16px); display: flex; flex-direction: column; }`. The body scrolls: `.ui-demo-body { overflow-y: auto; min-height: 0; }`. The titlebar stays fixed, so dragging still works.
- D7. Expanding a section makes the panel taller and can push its bottom off screen. Call the existing `keepInViewport()` from every section's `@toggle`. It already clamps `y` against `offsetHeight`, and D6's max-height means the panel always fits once clamped.
- D8. Esc: drop `boardSettingsOpen` / `settingsOpen` from the modal-open guard (l.205-206) and from `closeModals` (l.701-702). The existing `uiDemoPanelOpen` Esc branch (l.769) still closes the panel. The number-input `@keydown.esc` commit (UiSettingsPanel l.143) stays.
- D9. CSS: delete the `.settings-modal` rules (`styles.css:2279-2310`) apart from the inline-Metrics part. Move that part to the panel: `.ui-demo-panel .metrics-menu` and `.ui-demo-panel .metrics-popover { position: static; max-width: 100%; box-shadow: none; }`. Keep the `.titlebar-actions .metrics-popover-header button` selector (Dashboard uses it) and point the other half of that rule at `.ui-demo-panel`.
- D10. Fix the close button's `aria-label` (`"Close UI Demo"` → `"Close Settings"`). The header button's `title` becomes `"Settings"`, or keep the current one.

## Change (≈3 files + docs)
- `src/uiDemo.ts`: add `settingsSectionsOpen` (D5).
- `src/components/UiSettingsPanel.vue`: body → 3 `<details>`, with slots `metrics` / `display` and UI Settings holding the existing controls. `@toggle` → write the open state + `keepInViewport()`. Fix the aria-label.
- `src/views/BoardView.vue`:
  - header button → `@click="uiDemoPanelOpen = !uiDemoPanelOpen"`
  - `<UiSettingsPanel v-if="uiDemoPanelOpen">` with `<template #metrics>` (MetricsPanel) and `<template #display>` (old Display modal lists)
  - delete both modals, `settingsOpen`, `boardSettingsOpen`, `openDisplaySettings`, `openUiSettingsPanel`, and their guard / `closeModals` lines
  - drop imports this leaves unused (typecheck/lint will flag them)
- `src/styles.css`: D6 + D9.
- `feature-map.md`: update the Settings / Display / UI Settings entries (l.328 says "⚙ Settings → 🎚 UI Settings") to "⚙ Settings floating panel: Metrics / Display / UI Settings accordions, all collapsed by default".

## Acceptance criteria
- Header has exactly one `⚙ Settings` button
- Clicking it opens the floating Settings panel, with no modal and no backdrop. Clicking it again closes the panel, and so do ✕ and Esc.
- The panel opens centered every time and is resizable (bottom-right grip), staying inside the window
- Left sidebar lists Display, Metrics and UI Settings; the selected section's content shows on the right. Display is selected by default. Metrics shows its table directly, with no toggle button; the selection holds while the app runs and resets on restart.
- Section contents behave as before: Metrics windows/totals, the Display toggles (lane visibility, card fields, lane-modal fields) apply live, and UI Settings sliders/selects/Reset work
- The content pane scrolls when it overflows. The panel is still draggable by the titlebar.
- No references to `settingsOpen`, `boardSettingsOpen`, `.settings-modal` remain
- `bun run test` + typecheck pass. The app was exercised on an isolated DB copy before merge (memory: run-app-before-merge / drive-app-via-cdp).

## Verify (manual, isolated DB)
1. Open the board, click `⚙ Settings`: the panel appears centered with Display selected
2. In Display, toggle a card field: the card updates live. Hide a lane: the lane disappears. The pane scrolls.
3. Select Metrics: the table shows at once (no button) and scrolls sideways inside the pane instead of clipping.
4. Drag the panel to a corner: it clamps on screen. Resize it: it stops at the window edge.
5. Esc closes the panel. Reopen it: centered again, last-selected section still selected.
6. Switch Board → Dashboard → Board and reopen: the selection is still there

## Risks
- `UiSettingsPanel` sits at z-index 250, above modal backdrops (200), on purpose (#129: UI knobs stay usable while a modal is open). At 680×520 centered it now covers more of a ticket/lane modal opened behind it; drag or close the panel. Out of scope.

## Out of scope
- Changing what any section contains
- Dashboard header (has its own Metrics, no Settings)
- Persisting accordion state

## Open questions
None.

## Rework (2026-11-26) — supersedes D2, D4–D7
The user picked this PR over #179 (#140) and changed the design:
- The panel opens centered every time. Its position is component state and is no longer saved to localStorage.
- The panel is resizable with native CSS `resize: both` from the bottom-right grip, 680×520 by default and 420×280 at minimum. Inline `max-width`/`max-height` derived from its position keep it inside the window.
- Accordions are replaced by a side-by-side layout like macOS System Settings: a fixed 168px sidebar (icon + label, the selected section highlighted) and a scrolling content pane on the right. The selected section (`selectedSettingsSection`) lasts for the app session and defaults to Display.
- Follow-up: Display moved to the top of the sidebar and is the default; Metrics renders `MetricsPanel inline` (table always open, no nested toggle button).
