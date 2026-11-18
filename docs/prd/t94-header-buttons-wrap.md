# PRD — Ticket #94: Header buttons break at small window widths

## Context
On a narrow window the board title bar and filter row overflow (see ticket screenshot). Button labels wrap to two lines ("← / Projects", "+ / Ticket", "⇣ Pull / issues", "+ Swim / lane", "⚙ / Display", "📊 / Metrics", "Open In" caption) inside fixed 28px buttons, so the second line spills below the border. The project title wraps ("ProjectTracker/electron- / app"). Filter row: "Assigned to me", "No status (0)", "GitHub Issues (2)", "78 of 80" wrap the same way.

Scope: CSS only, `src/styles.css`. No component or behavior change.

## Code today (verified 2026-11-17 on `e33a8e6`)
- `.titlebar` (`src/styles.css:56`): flex row, `justify-content: space-between`, `gap: 12px`, `height: 48px`, `padding: 0 12px 0 80px` (80px clears traffic lights), `-webkit-app-region: drag`
- `.titlebar-title` (`:73`): no `min-width: 0`, no ellipsis → wraps and competes for width
- `.titlebar-actions` (`:79`): flex row, `gap: 5px`, `no-drag`. No `flex-shrink: 0`; children have no `white-space: nowrap` → flex shrinks each button, text wraps
- `.titlebar-actions button` (`:86`): `min-width: 58px; height: 28px; min-height: 28px; padding: 0 12px` → wrapped text overflows the fixed box
- `.offline-badge` (`:93`): already `height: 28px`, same shape
- `.filter-trigger` (`:299`): `inline-flex`, `height: 28px`, no nowrap. Used by `OpenInPicker.vue` + metrics picker
- `.board-filters` (`:1017`): non-wrapping flex row, `gap: 8px`
- `.filter-query` (`:1023`): `flex: 0 1 320px` (already shrinkable; may still need `min-width: 0` to shrink below the input's intrinsic width)
- `.filter-count` (`:1042`): no nowrap → "78 of 80" wraps
- Window `minWidth: 960` (`electron/main.ts:56`)
- Dashboard header (`src/views/DashboardView.vue`) reuses `.titlebar-actions` → one CSS fix covers both views

## Requirements
- R1. No title-bar label wraps: `white-space: nowrap` on `.titlebar-actions button`, `.filter-trigger` (+ its caption), `.offline-badge`
- R2. Title gives up space first
	- `.titlebar-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
	- `.titlebar-actions { flex-shrink: 0; }`
	- Full title in a `title` attribute tooltip on the title element (Board + Dashboard) — the one template touch allowed
- R3. Near min width: one `@media (max-width: <N>px)` rule tightens action buttons (smaller horizontal padding / `min-width`; optionally hide the "Open In" caption, keep the app name). Pick `<N>` from in-app measurement: the smallest width where R1+R2 alone no longer fit
- R4. Filter row: `white-space: nowrap` on `.board-filters button` and `.filter-count`; `min-width: 0` on `.filter-query`; `flex-wrap: wrap` on `.board-filters` so controls drop to a second line instead of crushing text

## Acceptance criteria
- 960px → full screen: no title-bar or filter-row label wraps or spills out of its button, Board + Dashboard
- Project title ellipsizes (full text in tooltip) before any action button is squeezed
- All title-bar buttons still clickable (`-webkit-app-region: no-drag` intact on actions; title + gap still drag the window)
- ≥1280px: pixel-identical to today
- Typecheck + `bun run test` green

## Verification
- Real app on an isolated DB copy (see memory: run-app-before-merge / drive-app-via-cdp)
- Resize to 960 / 1100 / 1280px; screenshot Board + Dashboard headers; confirm no wrapping/spill and buttons clickable
- Measure the actions' natural width at 960px to set the R3 breakpoint (estimate: board actions ≈ 880px + 92px padding → doesn't fit at 960 without R3) [~75% confidence — measure]

## Decisions (defaulted under full auto)
- D1. No overflow "⋯" menu or icon-only mode. Add only if the header still can't fit at 960px after R1–R3
- D2. Keep window `minWidth: 960`
- D3. CSS-only fix in shared selectors, not per-view overrides — one root cause, one place

## Out of scope
- Swimlane column header layout
- Mobile / web-app breakpoints beyond the Electron min width

## Open questions
None.

## Branch / worktree
- Branch: `t94-when-the-window`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t94`
- PRD file: `docs/prd/t94-header-buttons-wrap.md` (committed on the branch)
