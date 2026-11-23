# PRD — #102 Add an information 'i' icon

## Why a PRD
- Small UI change, but three things in the ticket's approach don't hold as written (verified in code, 2026-11-18):
  - Esc: the board's window `keydown` handler (`BoardView.vue` `handleBoardKeydown` ~L560) closes every modal on Escape. A CSS-only tip can't "hide on Esc". Escape would close the whole modal instead.
  - Clipping: `.modal` has `overflow-y: auto` (`styles.css` ~L935). That makes overflow-x compute to `auto` too, so a bubble poking past the modal edge gets a horizontal scrollbar instead of escaping the modal.
  - Test: there's no DOM test env (`vitest` runs in node, no `@vue/test-utils`, no jsdom/happy-dom, no component tests yet).

## Goal
- One reusable `InfoTip` component: a small `ⓘ` glyph next to a field label. Hover or keyboard focus shows a themed tooltip explaining the field.

## Component — `src/components/InfoTip.vue`
- Props: `text: string`. No slot (YAGNI; no call site needs rich content).
- Markup:
  - wrapper `<span class="info-tip">` (`position: relative; display: inline-block`)
  - `<button type="button" class="info-tip-button" aria-label="More info" :aria-describedby="tipId">ⓘ</button>`
  - `<span :id="tipId" role="tooltip" class="info-tip-bubble">{{ text }}</span>`
  - `tipId` from Vue 3.5 `useId()` (vue `^3.5.16` installed). No hand-rolled counter.
- Glyph treatment follows the `⚙` in `.icon-button`: unicode glyph, `currentColor`, no SVG/icon lib. Sized for inline use (~1em, not the 40px header box), color `--color-text-muted`, hover `--color-text`. No border/background, focus ring via `:focus-visible`.
- Show/hide: CSS `.info-tip:hover` or `.info-tip:has(.info-tip-button:focus-visible)` shows the bubble. `:focus-visible`, not `:focus-within`: a mouse click focuses the button in Chromium, and `:focus-within` would leave the tip stuck open over the textarea.
- Esc: one bit of state, `dismissed`.
  - Window `keydown` listener in the capture phase: if the tip is showing (wrapper `:hover` or button `:focus-visible`) and not dismissed → set `dismissed = true`; `stopPropagation()` only when the tip button is the target, so a hover-only tip lets Esc through (#119). Capture phase, so a hover-shown tip hides on Esc too, not only a focused one. Otherwise it passes through and Esc closes the modal as usual.
  - Reset `dismissed` once neither shows it: on `mouseleave` when not keyboard-focused, on `blur` when not hovered.
  - Show rules carry `:not(.dismissed)`. A separate `.dismissed { display: none }` rule loses to the `:has()` show rule on specificity.
  - Capture-phase window listener runs before the button's own handlers; Esc is claimed only when the button has keyboard focus (`:focus-visible`); a mouse-clicked button counts as hover (#119).
- Click: `@click.prevent` on the wrapper. A click on the button never activates the label (interactive content), but a click on the bubble text would toggle the Full auto checkbox.
  - Prompt labels get `for` + textarea `id`: otherwise the label's first labelable descendant is the ⓘ button, and clicking the label text no longer focuses the textarea.
- Bubble styling: `--color-surface-raised` background, `--color-text` text, `--color-border` border, existing radius/shadow look. `font-size: 0.75rem` (matches `.field-hint`), `font-weight: normal`, `white-space: normal`. So light + dark themes come from tokens, no per-theme CSS.
- Positioning (no flip logic, per out-of-scope):
  - `top: calc(100% + 4px); left: 0; width: max-content; max-width: min(280px, 70vw); z-index` above modal content.
  - Every placement puts the icon near the modal's left side (see below), so a left-anchored bubble of ≤280px fits in the 560px lane modal / 760px ticket modal.
  - Ceiling: an icon near the right edge would overflow. Add `align="end"` (`right: 0`) only if a future call site needs it.

## Placements — `src/views/BoardView.vue`
- Icon goes right after the label's text node, inside the `<label>`. Lane modal labels stack column-wise, so the text and icon need an inline wrapper (`<span class="label-with-tip">Agent prompt <InfoTip …/></span>`) to stay on one line above the field.
- Lane modal → "Agent prompt" (~L2159)
- Lane modal → "Orchestrator prompt" (~L2198)
- Lane modal → "Full auto" checkbox (~L2337). Label text is long and wraps. Icon goes at the end of the text. Verify the bubble stays in-modal at narrow widths. If not, put the icon right after the checkbox instead.
- Ticket modal → "Full auto" checkbox (~L1988)
- Existing `.field-hint` lines stay. The tip adds the "why", the hint keeps the "what/where".

## Tooltip copy (draft, refine in review)
- Agent prompt: "Instructions sent to the agent when a ticket enters this lane. Autosaves to SwimlaneAgentPrompt/<lane>/ as markdown."
- Orchestrator prompt: "Instructions for this lane's orchestrator session, which dispatches and monitors ticket agents. Leave empty to use the generated default template."
- Full auto (lane): "When this lane's agent moves a ticket on, the next lane's agent starts on it automatically."
- Full auto (ticket): "Same as a lane's Full auto, but for this ticket in every lane it enters."

## Test — `src/components/InfoTip.test.ts`
- No new deps. Render with `renderToString` from `vue/server-renderer` (ships with `vue`) in the default node env.
- Assert:
  - output contains the `text`
  - button's `aria-describedby` equals the bubble's `id` (parse both from the HTML string), and the bubble has `role="tooltip"`
- Skipped: interaction tests for hover/Esc/click. Those need a DOM env (happy-dom + `@vue/test-utils`). Add them when a second interactive component needs tests. Cover them by hand in the app (below).

## Acceptance criteria
- `InfoTip.vue` exists, reusable via `text` prop, glyph styled like the `⚙` treatment.
- Icon present at the 4 spots above (Agent prompt, Orchestrator prompt, lane Full auto, ticket Full auto).
- Hover shows the tip. Tab-focus shows the tip. Blur hides it.
- Esc with the tip showing hides the tip and leaves the modal open. Next Esc closes the modal.
- Clicking the icon doesn't toggle the Full auto checkbox and doesn't focus the prompt textarea.
- Tip stays inside the modal (no horizontal scrollbar on the modal) and reads correctly in light + dark.
- `bun run test` passes, including the new InfoTip test.
- Manual check in the running app on an isolated DB copy before merge (hover, Tab, Esc twice, click, both themes).

## Out of scope
- Replacing native `title=` tooltips elsewhere.
- Replacing `⚙` / other glyphs with an SVG icon set.
- Info icons beyond the four spots above (incl. `TicketGraph.vue` prompt editors).
- Positioning library, auto-flip, top-layer/popover positioning.

## Work location
- Branch: `t102-add-an-information`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t102`
- PRD file: `docs/prd/t102-info-tip.md` (committed on the branch)
