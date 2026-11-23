# PRD — Ticket #126: UI Demo sliders

## Problem
Tuning the board's look (corner radii, see-through surfaces, card text alignment) means editing `src/styles.css` and reloading. There is no way to try values live.

## Goal
A `🎚 UI Demo` button in the board header opens a floating, non-blocking panel of controls. Each control writes one `--ui-*` CSS custom property on `document.documentElement`, so the board updates as you drag. Values persist in localStorage and apply before first paint. Defaults reproduce today's UI exactly.

## Current behaviour (verified in code)
- Header toolbar: `⚙ Display` button at `src/views/BoardView.vue:1556`, last item in the header `div`.
- Board Escape handling: `handleBoardKeydown` (`BoardView.vue:672`). Comment at l.680: an unhandled Escape leaves the board, so each overlay claims Escape in that function, in priority order.
- Radii hardcoded in `src/styles.css`: `button` l.177 (`8px`), `.modal` l.283 (`8px`) + second `.modal` rule l.988, `.lane` l.1259 (`8px`), `.ticket` l.1342 (`6px`). 44 `border-radius` literals in total; only the ones above are in scope.
- Backgrounds are theme vars: `.modal` → `var(--color-surface-raised)`, `.ticket` → `var(--color-surface)`; `.lane` uses its own surface var.
- `.ticket` already animates `opacity` (`transition` l.1349) for the carried-behind drag state (`ticket-carried`). So element `opacity` is already in use on cards.
- `.ticket` is `display: grid; align-items: start` with checkbox + content columns.
- `color-mix()` already used in `styles.css` (2 uses) → supported by the app's Chromium.
- First-paint entry: `src/main.ts`, imports `styles.css` then mounts. Persistence pattern: `src/modalWidth.ts` (module-scope ref), `src/stores/theme.ts` (localStorage key + try/catch read).
- Tests: `vitest run`, existing `src/**/*.test.ts` (e.g. `src/stores/theme.test.ts`).

## Decisions
1. **Transparency = background alpha, not element `opacity`.** Element opacity would also fade text and borders, and would fight the existing `ticket-carried` opacity transition. Implement as `background: color-mix(in srgb, var(--color-surface) calc(var(--ui-alpha-card, 100) * 1%), transparent)`. Theme colours untouched → works in every theme.
2. **"Modals" radius covers both `.modal` rules**; "buttons" covers the base `button` rule only. Pills (`999px`) and small badges stay as they are.
3. **Vertical align maps to `align-items` on `.ticket`** (top = `start`, middle = `center`, bottom = `end`). Cards are content-height, so the visible effect is how the checkbox column lines up with multi-line title/content. Horizontal justify maps to `text-align` on `.ticket` content.
4. **One module, one component.** No Pinia store: values are UI-only and never hit the DB (out of scope). Module-scope reactive state like `modalWidth.ts`.
5. **Panel position** persisted in the same localStorage entry, so reopening (and restarting) restores it. Clamped into the viewport on open and on window resize.

## Controls → CSS vars
| Control | Var | Range / values | Default |
|---|---|---|---|
| Swimlane radius | `--ui-radius-lane` | 0–24 px | 8 |
| Ticket card radius | `--ui-radius-card` | 0–24 px | 6 |
| Modal radius | `--ui-radius-modal` | 0–24 px | 8 |
| Button radius | `--ui-radius-button` | 0–24 px | 8 |
| Modal opacity | `--ui-alpha-modal` | 0–100 % | 100 |
| Swimlane opacity | `--ui-alpha-lane` | 0–100 % | 100 |
| Ticket card opacity | `--ui-alpha-card` | 0–100 % | 100 |
| Card text justify | `--ui-card-text-align` | left / center / right | left |
| Card content align | `--ui-card-align-items` | start / center / end (Top / Middle / Bottom) | start |

## Requirements
- R1: `🎚 UI Demo` button directly right of `⚙ Display`; `class="secondary"`; click toggles the panel.
- R2: Panel is `position: fixed`, no backdrop, board stays interactive. Drag by title bar via pointer events (`setPointerCapture`); position clamped inside the viewport.
- R3: Closes via ✕ and Escape. Escape is claimed in `handleBoardKeydown` (closes panel, `preventDefault`) so it does not leave the board. Order: lane drag / menus / modals keep their existing priority; the panel branch goes after them, before the "leave board" fallthrough. So with a modal open, Escape closes the modal first, and the next Escape closes the panel.
- R4: Each numeric row = label + `<input type="range">` + `<input type="number">` bound to the same value. Typed values clamp to range on change; non-numeric input reverts to the current value.
- R5: Justify + align rows are 3-way segmented buttons (or `<select>`), same row layout.
- R6: Every control writes exactly one var via `document.documentElement.style.setProperty`. CSS uses `var(--ui-…, <today's literal>)` so a missing var renders today's UI.
- R7: "Reset" restores all defaults (removes the localStorage values and re-applies defaults). Panel position is not reset.
- R8: Persist to localStorage key `project-tracker-ui-demo` as JSON. Read wrapped in try/catch; unknown keys ignored, each value re-clamped on load (corrupt storage can't break layout).
- R9: Apply stored values in `src/main.ts` before `mount` → no flash of defaults.
- R10: Board view only. The vars are global on `:root`, but the Dashboard's selectors aren't switched to them, so it is unaffected. (Shared `button`/`.modal` rules do affect any dashboard buttons/modals — accepted; see Notes.)

## Implementation
- `src/uiDemo.ts` (new): control definitions table (key, var name, min, max, default, unit / allowed values), `clampValue`, `toCssValue`, `loadUiDemo`, `saveUiDemo`, `applyUiDemo(values)`, module-scope `uiDemoValues` reactive + `uiDemoPanelOpen` ref, panel position ref.
- `src/uiDemo.test.ts` (new): clamp (below min, above max, NaN → default, enum outside allowed → default) and value → `{ var, cssValue }` mapping (px suffix for radii, bare number for alpha, keyword for alignment).
- `src/components/UiDemoPanel.vue` (new): title bar (drag + ✕), rows generated from the definitions table, Reset button. `watch(uiDemoValues, apply + save, { deep: true })`.
- `src/views/BoardView.vue`: button after `⚙ Display`; render `<UiDemoPanel v-if="uiDemoPanelOpen" />`; Escape branch in `handleBoardKeydown`.
- `src/styles.css`: swap the literals listed in "Current behaviour" for `var(--ui-…, literal)`; wrap the three backgrounds in `color-mix(…)` with alpha var fallback `100`; `.ticket` `align-items: var(--ui-card-align-items, start)` and `text-align: var(--ui-card-text-align, left)`; panel styles (`z-index` above lanes, below modals).
- `src/main.ts`: `applyUiDemo(loadUiDemo())` before `mount`.

## Testing
- `bun run test` → `src/uiDemo.test.ts` passes alongside existing suites.
- Manual (isolated DB copy, per repo memory "run app before merge"):
  1. Fresh profile, no stored values: board pixel-identical to `main` (compare screenshots).
  2. Open panel, drag each slider: lanes / cards / modals / buttons update live; drag panel to each edge — stays in viewport; board still clickable behind it.
  3. Type `99` in a radius box → clamps to `24`; type `-5` → `0`.
  4. Opacity 50 on cards: background see-through, text fully opaque; dragging a ticket still shows the carried-behind fade.
  5. Justify center/right and align middle/bottom change card layout.
  6. Escape closes panel and stays on the board; with a ticket modal open, Escape closes the modal first.
  7. Restart app → values + panel position restored with no flash. Reset → today's look.
  8. Switch themes (light + dark) with non-default values → only radius/alpha/alignment differ.

## Out of scope
DB / per-project / per-user persistence; colour, font, spacing, shadow controls; exporting values to `styles.css` or the theme package; presets; Dashboard view.

## Notes / risks
- `button` and `.modal` rules are global, so the button/modal radius also shows on any button/modal outside the board. Scoping them to `.board-shell` would miss modals teleported to `body`. Accepted as harmless; revisit only if it's a problem.
- Branch `t126-ui-demo-sliders`, worktree `~/Code/Projects/ProjectTracker/electron-app/.worktrees/t126`.
