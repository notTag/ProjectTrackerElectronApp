# PRD — #138 BUG: Tooltip cutoff

Branch `t138-bug-tooltip-cutoff` · worktree `.worktrees/t138`

## Problem
An InfoTip (ⓘ) bubble opened inside a modal is clipped by the modal's edge. Repro (ticket screenshot): lane settings modal → "Full auto" ⓘ (`src/views/BoardView.vue:2792`). The long label wraps, the ⓘ ends up near the modal's right edge, the left-anchored bubble runs past it and is cut off.

## Root cause (verified)
- `.info-tip-bubble` is `position: absolute; top: calc(100% + 4px); left: 0; z-index: 10` inside `.info-tip { position: relative }` (`src/styles.css:1764-1810`)
- `.modal` has `overflow-y: auto` (`src/styles.css:1011`) → `overflow-x` computes to `auto` too → anything past the modal box is clipped (or adds a scrollbar). z-index can't escape overflow clipping
- #102 PRD (`docs/prd/t102-info-tip.md`) accepted this ceiling ("an icon near the right edge would overflow"). Resizable modals (#117) + the wrapping Full auto label now hit it

## Scope
- Single fix point: all `<InfoTip>` uses go through `src/components/InfoTip.vue`
	- `BoardView.vue` — 7 uses: titlebar pickers (~1915/1934/1955), ticket Full auto (~2329), lane prompts (~2566/2624), lane Full auto (~2792)
	- `UiSettingsPanel.vue:117`
- Platform: Electron 35.7.5 (Chromium 134) → Popover API (Chr 114+) + CSS anchor positioning (Chr 125+) are native. No library, no JS position math
- Modals are plain `div`s, not `<dialog>` → a popover in the top layer always paints above them

## Approach
1. Bubble → top layer via Popover API. Top layer ignores ancestor `overflow` and stacking contexts → no modal can clip it
	- `<span :id="tipId" role="tooltip" popover="manual" class="info-tip-bubble" :style="{ positionAnchor: anchorName }">`
	- `manual`, not `auto`/`hint`: no light-dismiss, no closing other open popovers (pickers' menus); show/hide fully owned by InfoTip
2. Show/hide moves from CSS (`:hover`, `:has(:focus-visible)`) to JS, same rules as today:
	- `show()` when `!dismissed && (hovered || keyboard-focused)`; else `hide()`
	- Triggers: wrapper `mouseenter`/`mouseleave`, button `focus`/`blur`, Esc dismiss
	- Keep `dismissed`, `dismissOnEscape` capture logic, `resetOnMouseLeave`, `resetOnBlur` unchanged (#102/#119); they now also call a single `syncBubble()` that does `showPopover()`/`hidePopover()` (guard with `:popover-open` / try-catch — both throw `InvalidStateError` on wrong state)
	- `hidePopover()` in `onBeforeUnmount` so a tip open when its modal closes never lingers in the top layer
	- `:focus-visible` check stays (mouse-click focus counts as hover, not keyboard)
3. Position with CSS anchor positioning
	- Button: `:style="{ anchorName }"`, `anchorName = '--tip-' + tipId` (Vue 3.5.35 `useId()` → `v-0`, `v-1-0` … → valid dashed ident; no sanitizing needed)
	- Bubble CSS: `position: fixed; inset: auto; margin: 0; top: calc(anchor(bottom) + 4px); left: anchor(left);`
	- `position-try-fallbacks: flip-inline, flip-block, flip-block flip-inline;` → near right edge it right-aligns to the ⓘ, near bottom it opens above. Fixes the screenshot case directly
	- Reset UA `[popover]` styles not already set: `inset`, `margin`, `overflow: visible`, `color`/`background` already set; `border`/`padding` already set
	- Visibility: drop `display: none/block` rules + the `.info-tip:not(.dismissed):hover …` selectors; popover's UA `display: none` until `:popover-open` handles it
4. Remove `.ui-demo-titlebar .info-tip { position: static }` workaround (`src/styles.css:2537-2541`) — only existed to keep the bubble inside the 320px panel; flip fallback covers it. Keep `cursor: default` on `.ui-demo-titlebar .info-tip`
5. `@click.prevent` on wrapper stays — bubble is still a DOM child of the `<label>`, so a click on it still bubbles through the label

## Edge cases
- Mouse path ⓘ → bubble: bubble is still a DOM descendant of the wrapper → `:hover`/`mouseleave` treat it as inside, same as today (4px gap behaves as today)
- Modal scrolls while tip open: anchor positioning tracks the anchor; no JS listener needed
- Modal closes / tip unmounts while open: `onBeforeUnmount` hides it
- `max-width: min(280px, 70vw)` stays → bubble never wider than viewport

## Acceptance criteria
- Bug when a tool tip is displayed inside a modal the tooltip is cutoff.
- The Tooltip should overlay on top of the modal.
- AC1: Lane modal "Full auto" ⓘ bubble shows in full, overlaying the modal edge; no clipping, no modal scrollbar appears
- AC2: Same for every InfoTip call site (lane prompts, ticket Full auto, titlebar pickers, UI settings panel), at default and resized modal widths
- AC3: Bubble near right/bottom viewport edge flips to stay on screen
- AC4: Hover, keyboard focus, Esc (focus claims Esc, hover passes it through), mouse-leave/blur reset all behave as before (#102, #119)
- AC5: Clicking the bubble text still doesn't toggle the Full auto checkbox
- AC6: Light + dark theme styling unchanged

## Tests
- `src/components/InfoTip.test.ts` (SSR render) — extend existing test:
	- bubble has `popover="manual"`, `role="tooltip"`, `id` === button's `aria-describedby`
	- button's `anchor-name` === bubble's `position-anchor` (both `--tip-<id>`)
- No DOM env for hover/top layer → manual check in running app on an isolated DB copy (per memory: run app before merge): lane modal Full auto at narrow + wide resize, ticket modal, UI settings panel ⓘ, keyboard Tab + Esc, light + dark theme

## Out of scope
- Replacing native `title=` tooltips elsewhere
- Rich/slot content in tips
- Tooltip delay/animation

## Open questions
- None
