# PRD — Ticket #65: Clear button (✕) in the "Filter tickets…" field

## Context
The board's "Filter tickets…" field has no inline way to clear what you typed. Today you select the text and delete it, or press the toolbar **Clear** button, which also resets the lane filter and "Assigned to me".

## Acceptance criteria
- A ✕ shows inside the field only while it has text.
- Clicking ✕ empties the field and the board refilters right away.
- The lane filter and "Assigned to me" are unchanged after clearing.
- The ⌘⇧F / Ctrl⇧F focus shortcut and Escape-to-blur behaviour still work.
- The ✕ looks right in light and dark themes.
- Focus stays in the input after clearing.

## Code today (verified 2026-11-13 on `3a794ca`)
- Input: `src/views/BoardView.vue:883-890` — plain `<input>` (no `type`), `ref="filterQueryInput"`, `v-model="filterQuery"`, class `filter-query`, `.active` while it has text
- State: `filterQuery` ref (`BoardView.vue:80`); filtering reads `filterQuery.value.trim()` in a computed (`:337`), so any `input` event refilters immediately
- Toolbar Clear: `clearFilters` (`:363`) resets query + lane + mine — leave as is
- Shortcut: `focusTicketFilter` (`:507`) focuses + selects the input
- Escape: `handleBoardKeydown` (`:543`) — when the target is the filter input it blurs and returns, without `preventDefault`
- Precedent: `src/components/ProjectToolbar.vue:66` already uses `type="search"`
- Styles: `.filter-query` (`src/styles.css:983`) only sets flex; every `input[type="search"]` rule in `styles.css` is scoped to `.toolbar`, so the board field picks none of them up
- Theming: `useThemeEffect` (`src/App.vue:48`) writes `--color-*` vars + `data-theme-type` onto `<html>`. No `color-scheme` is set anywhere, so Chromium draws native controls in light-scheme colours on dark themes too

## Approach
1. `BoardView.vue:883` → add `type="search"`. Chromium draws its own cancel ✕, visible only while non-empty. Clicking it clears the value and fires `input` → `v-model` updates → board refilters. The ✕ sits in the input's shadow DOM, so focus stays in the field. No JS needed.
2. Escape: Chromium's default action for Escape in a search input clears the value. Keep today's blur-only behaviour: in the `event.target === filterQueryInput.value` branch (`:543`) call `event.preventDefault()` before `blur()`. The window listener runs before the default action, so `preventDefault` there still cancels the clear.
3. Theme the ✕ in `src/styles.css` next to `.filter-query`. The native glyph is a fixed grey that doesn't follow `--color-*`, so it will be low-contrast on dark themes. Replace it with a theme-aware mask:
   ```css
   .filter-query::-webkit-search-cancel-button {
     -webkit-appearance: none;
     width: 12px;
     height: 12px;
     cursor: pointer;
     background: var(--color-text-muted);
     -webkit-mask: <inline SVG ✕ data URI> center / contain no-repeat;
   }
   .filter-query::-webkit-search-cancel-button:hover {
     background: var(--color-text);
   }
   ```
   The mask takes the shape from the SVG and the colour from the theme var, so it follows every theme. The data URI holds only the shape, so no colours are hard-coded.
4. Fallback (only if step 3 can't be made to look right): a small absolutely-positioned `×` button inside a wrapper, `v-if="filterQuery"`, that sets `filterQuery = ''` and refocuses `filterQueryInput`. Not expected to be needed.

## Out of scope
- Toolbar **Clear** button behaviour
- The projects-page search field (`ProjectToolbar.vue`) — it keeps the native ✕; restyling it to match is a separate ticket if wanted

## Verification
- `bun run typecheck`, `bun run test`, `bun run build` clean
- Manual in the app (`/run`):
  - Type → ✕ appears; empty → ✕ gone
  - Click ✕ → field empty, cards refilter, focus still in field, lane select + "Assigned to me" untouched
  - ⌘⇧F focuses + selects; Escape blurs and keeps the text
  - Check ✕ contrast on one light theme (solarized-light) and one dark theme

## Open questions
None.

## Branch / worktree
- Branch: `t65-add-an-x`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t65`
