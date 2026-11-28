# PRD — #176 Update the Metrics view in Settings

Branch `t176-update-the-metrics` · Worktree `.worktrees/t176` · Base `main @ 5d99574`

## Problem
The ⚙ Settings floating panel (#145, `src/components/UiSettingsPanel.vue`) has a 168px sidebar and a content pane (`.ui-demo-body`). In the screenshot attached to the ticket:
- **Metrics scrolls sideways.** `MetricsPanel.vue:138` renders `<section class="filter-popover metrics-popover">`. `.ui-demo-panel .metrics-popover { overflow-x: auto }` (`styles.css:2338`) scrolls the 11-column table inside a pane about 486px wide (680 − 2 border − 168 sidebar − 24 padding). Every cell is `padding: 4px 8px; white-space: nowrap`, so the columns cannot shrink.
- **Card inside a pane.** `.filter-popover` (`styles.css`) gives the box `--color-surface-overlay`, a 1px border, an 8px radius and 6–10px padding. The pane itself is `--color-surface-raised` (inherited from `.ui-demo-panel`), so a dark card sits in a lighter pane. Display and UI Settings have no darker pane.
- **Sidebar reads as buttons.** `.settings-sidebar-item` is a `<button>` and inherits the global chrome (`styles.css:195`): `border-radius: var(--ui-radius-button, 8px)`, accent background and hover affordances. The rule overrides only the background and min-height.
- **Icon.** UI Settings uses 🎚 (`UiSettingsPanel.vue:22`). It looks too much like 👁 and 📊 and doesn't say "UI".

## Requirements

### R1 — Darker pane for every section
- `.ui-demo-body { background: var(--color-surface-overlay); }`, so the pane is darker than the sidebar and titlebar (still `--color-surface-raised`) for Display, Metrics and UI Settings.
- The fill runs edge to edge in the pane, with no lighter gutter. `.ui-demo-body` is a flex child of `.settings-layout`, so it already fills the height.
- Scoped override so the metrics box no longer shows as a card:
  ```css
  .ui-demo-panel .metrics-popover {
    position: static;
    max-width: 100%;
    max-height: none;   /* pane scrolls vertically, not the box */
    overflow: visible;  /* drop overflow-x: auto */
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }
  ```
- Check the sidebar hover. It currently uses `--color-surface-overlay`, the same token as the new pane. That is acceptable, because the hover is in the sidebar and not next to the pane. R3 sets the final hover token.

### R2 — Metrics table fits without horizontal scroll
Scope every rule to `.ui-demo-panel .metrics-table` so the Dashboard header popover (`.titlebar-actions`) doesn't change.
- `width: 100%`. Cells: `padding: 3px 4px` (down from 4px 8px).
- **Project column takes the leftover width and ellipsizes.** With auto layout, use the "zero max-width" trick on the row headers:
  `.ui-demo-panel .metrics-table tbody th, .ui-demo-panel .metrics-table tfoot th { width: 100%; max-width: 0; }`
  The existing `overflow: hidden; text-overflow: ellipsis` stays, and the `title` attribute (`MetricsPanel.vue`) still shows the full path.
  - Use this instead of the ticket's suggested `table-layout: fixed`. Fixed layout takes column widths from the first row, which here has `rowspan`/`colspan` group headers. That would force hard-coded widths for 10 numeric columns. Auto layout plus `max-width: 0` sizes the numeric columns to their content.
- Let the 2-row headers wrap: `.ui-demo-panel .metrics-table thead th { white-space: normal; }`, so "PRs open" and "PRs merged" break into two lines and the numeric columns stay narrow. Body cells stay `nowrap`.
- **Panel min-width.** Measure the table's minimum content width in the running app with a realistic row (4-digit Year counts and the Total row). Set `.ui-demo-panel { min-width }` to table min + 168 sidebar + 24 body padding + 2 border, rounded up to a multiple of 8px. Rough estimate: about 640–680px.
  - If the measured minimum is more than the default `width: 680px`, raise the default `width` to match, so the default size never scrolls.
  - Inline `maxWidth: calc(100vw - x)` (`UiSettingsPanel.vue:119`) still caps the panel on very narrow windows. That case is accepted.
- Remove the outdated comment above `.ui-demo-panel .metrics-menu` ("the popover scrolls it sideways instead"). Keep the `minmax(0, 1fr)` grid tracks.

### R3 — Sidebar items as highlighted bars
Keep the `<button>` elements so Tab focus, `aria-current` and click handling don't change. Restyle `.settings-sidebar-item` only:
- `width: 100%; min-height: 28px; padding: 0 8px; border: 0; border-radius: 6px; box-shadow: none; background: transparent; color: var(--color-text); font-weight: normal;`. Set the fixed radius here so the UI Settings "button radius" knob no longer reshapes the list.
- Hover (not selected): `background: var(--color-hover); box-shadow: none;`. This is a subtle wash with no accent ring. Make sure no global `button:hover` filter or ring applies.
- Selected: keep `background: var(--color-accent); color: var(--color-text-on-accent);`.
- Focus: keep a visible `:focus-visible` outline (`2px solid var(--color-accent)`, `outline-offset: -2px`, so the sidebar's `overflow-y: auto` doesn't clip it).
- The goal is a macOS System Settings source list: rows with a tinted bar, not a stack of buttons.

### R4 — UI Settings icon
- `SECTIONS` in `UiSettingsPanel.vue:22`: `{ id: 'ui', icon: '🎨', label: 'UI Settings' }`.
- Check whether 🎚 is used for this section anywhere else (README, other PRDs are fine to leave) and update user-facing copy if it is.

## Acceptance criteria
- AC1. Settings → Metrics has no horizontal scrollbar at the default panel size or at the minimum panel width. All 11 columns stay visible, a long project name ellipsizes, and hovering it shows the full path.
- AC2. `--color-surface-overlay` fills the whole active pane for Display, Metrics and UI Settings, with no lighter gutter and no bordered inner card around the metrics table.
- AC3. Sidebar items look like highlighted bars, with no button radius from the UI knob, no accent ring and no shadow. Selected = full-width accent bar, hover = subtle wash. Tab reaches each item, the focus ring shows, and `aria-current="true"` stays on the selected item.
- AC4. UI Settings shows 🎨.
- AC5. The Dashboard header's 📊 Metrics popover is unchanged: same box, shadow, padding and table spacing.
- AC6. AC1–AC5 hold in light and dark themes.

## Verification
- `bun run typecheck` / `bun run test` / `bun run lint` (whatever `package.json` defines). No logic changes, so no new unit test.
- Run the app on an isolated DB copy (see memory "Drive app via CDP"). Open ⚙ Settings, go through all three sections, resize the panel to its minimum width and check `scrollWidth <= clientWidth` on `.ui-demo-panel .metrics-popover` and `.ui-demo-body`. Switch the theme. Open the Dashboard header Metrics popover and compare it with `main`.
- Take before and after screenshots for the PR (`docs/pr-screenshots/`).

## Files
- `src/styles.css`: metrics block ≈2303–2400, settings panel ≈2551–2650
- `src/components/UiSettingsPanel.vue`: `SECTIONS` icon only

## Out of scope
- Metrics data, columns, windows or refresh behavior.
- Redesigning the Dashboard header Metrics popover.
- The content and controls of the Display and UI Settings sections.
- Making the sidebar collapsible or responsive below the new min-width.
