# PRD — #141 Ticket modal UI bugs

Branch `t141-ticket-modal-ui` · worktree `.worktrees/t141`

## Problem
Two visual bugs in the ticket modal (`src/views/BoardView.vue`):
1. Checklist "add item" input is too narrow → placeholder shows only "Add an item, then press".
2. "Refresh from GitHub" (`↻`) button glyph is not vertically centred in its 40px box.

## Current state (verified)
- Checklist input `BoardView.vue:2294-2298`: bare `<input v-model="checklistDraft">`, direct child of `section.ticket-checklist`. No width rule exists → falls back to the browser's intrinsic `size=20` width. Other modal inputs sit inside `<label>` / flex rows that stretch them; this one has neither
  - `.ticket-checklist` CSS (`styles.css:1905-1923`) styles only `ul` / `li` / `li span`
  - Sibling pattern: `.ticket-links-add input` (`styles.css:1938`) sizes its add-input explicitly
- Refresh button `BoardView.vue:2209-2216`: `<button class="icon-button">↻</button>` inside `.pull-request-status` (flex, `align-items: center`, `styles.css:1856`)
  - `.icon-button` (`styles.css:725-741`) is flex-centred but adds `padding: 0 0 4px` — an optical nudge tuned for `×` / `⚙`, whose ink sits low. `↻` ink is already centred in its line box, so the nudge pushes it ~2px high
  - Precedent: `.ticket-modal-header .icon-button { padding: 0 }` (`styles.css:1682-1685`) drops the nudge for glyphs that don't need it

## Decisions (defaults taken, full auto)
- D1. Checklist input → `.ticket-checklist > input { width: 100%; }` (global `box-sizing: border-box` at `styles.css:39` keeps it inside the section). Full-width matches other single-line modal inputs
- D2. Refresh button → scoped override `.pull-request-status .icon-button { padding: 0; }`, same pattern as the header rule. No glyph swap, no change to base `.icon-button` (would shift every `×` / `⚙`)
  - Fallback if `↻` still reads off-centre in the running app: replace glyph with inline `<svg stroke="currentColor">` (header-button pattern), keep `padding: 0`
- D3. Root-cause scope: only these two call sites. Base `.icon-button` nudge stays — correct for `×` / `⚙` everywhere else

## Change (1 file)
1. `src/styles.css`
	- after `.ticket-checklist li span` (l.1921): add D1 rule
	- after `.pull-request-status` (l.1856): add D2 rule

## Acceptance criteria
- AC1. Ticket modal checklist input spans the section width; full placeholder "Add an item, then press Enter" visible at default modal width (760px)
- AC2. Typing + Enter still adds an item; input clears (no behaviour change)
- AC3. `↻` glyph visually centred (top/bottom gap equal ±1px) in the Refresh from GitHub button, light + dark themes
- AC4. Other `.icon-button` glyphs (`×` remove, `⚙`, header buttons) unchanged
- AC5. Verified in running app on isolated DB copy before merge

## Out of scope
- Other modal input sizing, `.icon-button` base redesign, icon library
