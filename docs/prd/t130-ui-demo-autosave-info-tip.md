# PRD — #130 UI Demo title ⓘ "auto-saves" note

Branch `t130-add-a-save`

## Problem
Original ask (t126 follow-up): a Save button on the 🎚 UI Demo panel. Dropped, because the panel already saves every change: the deep `watch(uiDemoValues)` calls `applyUiDemo()` + `saveUiDemo()`, and the position saves on drag end (`endDrag`). The real gap is that users don't know it auto-saves. Fix: add an ⓘ note on the title.

## Change (3 files)

### 1. `src/components/UiDemoPanel.vue`
- Import `InfoTip` from `./InfoTip.vue`
- Titlebar (l.113) `<strong>🎚 UI Demo</strong>` →
  ```vue
  <span class="label-with-tip">
    <strong>🎚 UI Demo</strong>
    <InfoTip text="Changes save automatically as you edit, on this machine only. Reset restores the defaults." />
  </span>
  ```
- `startDrag`: skip `closest('button, .info-tip')` so pressing ⓘ or its bubble text never starts a drag

### 2. `src/styles.css`: two gotchas found while checking the code
- **Button style bleed.** `.ui-demo-titlebar button { min-height: 28px; padding: 0 10px; }` (l.2371) has specificity 0,1,1 and beats `.info-tip-button` (0,1,0). Without a fix, ⓘ becomes a 28px-tall padded button. Fix: narrow the selector to the ✕ only, e.g. `.ui-demo-titlebar > button`. The ✕ is a direct child of the header; ⓘ sits inside spans
- **Bubble overflows the panel.** `.info-tip-bubble` is `left: 0` relative to `.info-tip`, which sits roughly 100px in (12px padding + title width). With `max-width: 280px` the bubble ends around 380px, past the panel's 320px width. The panel has no `overflow: hidden`, so nothing gets clipped, but the bubble spills outside the panel, and off-window when the panel is dragged to the right edge. Fix: anchor the bubble to the titlebar:
  ```css
  .ui-demo-titlebar { position: relative; }          /* add to existing rule */
  .ui-demo-titlebar .info-tip { position: static; }  /* bubble anchors to titlebar */
  ```
  The bubble then starts at the panel's left edge, just below the titlebar. 280px is less than 320px, so it fits. Its z-index of 10 inside the panel puts it above the body rows, which aren't positioned
- `.ui-demo-titlebar .info-tip { cursor: default; }`: the bubble would otherwise inherit the titlebar's `cursor: move`

### 3. `feature-map.md`, UI Demo panel section (l.327–336)
- Add to the Reset/localStorage bullet (l.336): "An ⓘ next to the title says this: changes save automatically, this machine only."

## Escape behavior (verified, no code change)
- InfoTip registers its `keydown` listener on `window` in the **capture** phase. When the ⓘ has keyboard focus (`:focus-visible`), the listener calls `stopPropagation()`
- The board's Escape handler (`BoardView.vue` l.755, `handleBoardKeydown`, closes the panel at l.737) listens on `window` in the **bubble** phase, so it never sees that first Escape → only the tip hides
- When the tip is only hovered or isn't showing, Escape propagates → the panel closes as before

## Acceptance criteria
- ⓘ sits right after "🎚 UI Demo" in the titlebar, using `InfoTip`, sized like the other ⓘ tips (no 28px button bleed)
- Hover or keyboard focus shows: "Changes save automatically as you edit, on this machine only. Reset restores the defaults."
- No Save button; save behavior unchanged
- Pressing ⓘ doesn't start a drag; dragging the title text still works
- Escape with ⓘ keyboard-focused hides only the tip; a second Escape, or any Escape without a focused tip, closes the panel
- Bubble stays within the panel's width and isn't clipped, including with the panel dragged to the right window edge
- `feature-map.md` mentions the ⓘ note
- `bun run typecheck`, lint, tests pass

## Tests
- If `UiDemoPanel` has a component test, add one assertion: the titlebar renders an `.info-tip` with the note text. Escape and hover behavior are already covered by InfoTip's own tests (#102). Don't duplicate them
- Manual check in the running app: hover, Tab to focus + Escape twice, drag from the title and from ⓘ, panel at the right edge

## Out of scope
- Save button or explicit-commit save mode
- Changing what or where the panel saves

## Decisions
- Reuse `InfoTip` instead of a native `title` attribute: matches the other ⓘ tips and is reachable by keyboard
- Anchor the bubble to the titlebar with CSS instead of adding a right-align/position prop to InfoTip: smaller change, scoped to this one spot
