# PRD — Ticket #83: Fullscreen button on ticket modals

Branch: `t83-add-a-fullscreen`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t83`

## Context

Ticket modals cap at 760px wide. Long descriptions, checklists and the agent command wrap badly, and on a big window most of the screen sits unused behind the backdrop. A toggle in the modal's top-right corner widens the modal to 85% of the window and shrinks it back.

## Code today (verified 2026-11-16 on `f9a3efb`)

- New-ticket modal: `src/views/BoardView.vue:1266-1267`, `<section class="modal ticket-modal">`, first child `<p class="eyebrow">New ticket</p>`.
- Open-ticket modal: `src/views/BoardView.vue:1318-1320`, same classes, first child is the `.eyebrow` meta line (`#N · Created … · Updated …`). No close ✕; closing is Done / Escape / backdrop click.
- The open-ticket backdrop gets `graph-ticket-panel` when `boardView === 'graph'` (`BoardView.vue:1318`). Same `<section class="modal ticket-modal">` is then the docked side panel.
- `src/styles.css`:
  - `.modal-backdrop` `:895` — fixed inset, grid centred, `padding: 24px`, z-index 200.
  - `.modal` `:908` — `width: min(560px, 100%)`, `max-height: 100%`, `overflow-y: auto`.
  - `.ticket-modal` `:1341` — `width: min(760px, 100%)`.
  - `.graph-ticket-panel .ticket-modal` `:1649` — `width: 100%`. Same specificity (0,2,0) as a new `.ticket-modal.expanded` rule; whichever comes later in the file wins.
  - `.icon-button` `:627` — 40×40 flex-centred button used for ⚙ / × in lanes and modal rows.
  - `.eyebrow` `:207` — muted uppercase line, `margin: 0 0 4px`.
- Icon pattern: inline `<svg … stroke="currentColor">` inside `.icon-button` (e.g. auto-run button `BoardView.vue:1111-1120`). `currentColor` follows the theme with no extra CSS.
- `BoardView.vue` is `<script setup>`. `App.vue:30` notes each view mounts its own instance, so Board ↔ Dashboard switches remount BoardView. A plain `ref` inside setup would reset on every switch.

## Requirements

1. Fullscreen toggle button at the top right of the new-ticket modal and the open-ticket modal.
2. Expanded: modal width = 85% of the app window (`85vw`). Collapsed: today's `min(760px, 100%)`.
3. Icon + `aria-label` + `title` reflect state: collapsed shows expand icon, label/title `Expand`; expanded shows collapse icon, label/title `Collapse`. Also `aria-pressed` bound to the state.
4. Height unchanged: still `max-height: 100%` of the backdrop, scrolls inside.
5. State shared by both modals and kept for the app's lifetime (across ticket opens, board switches, Board ↔ Dashboard). Resets to collapsed on app restart. Not saved to DB or localStorage.
6. Button follows light and dark themes (use `currentColor` + existing `.icon-button` / button tokens; no hard-coded colours).
7. Escape, backdrop click and Done keep closing the modal. Clicking the toggle must not close the modal or trigger the open-ticket `@focusin` refresh in a harmful way (refresh is fine, it already fires on any focus).
8. Graph view's docked panel: no button, and an expanded state must not widen the panel.

## Implementation

### State — survives BoardView remounts

Module-scope ref, outside `<script setup>`. Smallest option: a second plain `<script>` block in `BoardView.vue`:

```ts
<script lang="ts">
import { ref } from 'vue'
// ponytail: app-session memory only; move to settings/DB if it must survive restart.
const ticketModalExpanded = ref(false)
</script>
```

`<script setup>` can read it directly. Alternative if the dev agent prefers: export the ref from a tiny module (e.g. `src/ticketModalWidth.ts`). Don't put it in the Pinia store — it is pure UI state.

### Template

- Both `<section class="modal ticket-modal">` get `:class="{ expanded: ticketModalExpanded }"`. For the open-ticket section use `{ expanded: ticketModalExpanded && boardView !== 'graph' }`.
- Wrap the `.eyebrow` line and the button in a header row (`display: flex; align-items: center; justify-content: space-between; gap`), so the eyebrow text keeps its spot on the left and the button sits top right. Keep the `<p class="eyebrow">` element as is.
- Button: `<button type="button" class="icon-button" :title :aria-label :aria-pressed="ticketModalExpanded" @click="ticketModalExpanded = !ticketModalExpanded">` with two inline SVGs (`v-if` / `v-else`): outward arrows (expand) and inward arrows (collapse), `stroke="currentColor"`, `fill="none"`, ~18px.
- Open-ticket modal: render the button only when `boardView !== 'graph'`.

### CSS (`src/styles.css`, next to `.ticket-modal` at `:1341`)

```css
.ticket-modal.expanded {
  width: 85vw;
}
```

- `85vw` stays inside the backdrop's 24px padding on any window wider than ~320px, so no `min()` cap needed. If the dev agent wants belt-and-braces: `width: min(85vw, 100%)`.
- Graph panel is protected by the template guard (no `expanded` class in graph view), so CSS order doesn't matter.
- Header row: small class (e.g. `.ticket-modal-header`) with flex + `margin-bottom` matching the eyebrow's current 4px; reset the eyebrow's own bottom margin inside it if spacing doubles.
- Optional: `transition: width 150ms ease` on `.ticket-modal`. Skip if it causes text reflow jank.

## Acceptance criteria

- [ ] Button visible top right of new-ticket and open-ticket modals (board view).
- [ ] Click → modal 85% of window width. Click again → back to 760px max.
- [ ] Label/title/icon read `Expand` when collapsed, `Collapse` when expanded; `aria-pressed` matches.
- [ ] Long modal still scrolls inside window; height unchanged.
- [ ] Expand, close, open another ticket → still expanded. Expand, go to Dashboard and back → still expanded. Expand in new-ticket modal → open-ticket modal also expanded.
- [ ] Restart app → collapsed.
- [ ] Light + dark theme: icon and button match other icon buttons.
- [ ] Escape, backdrop click, Done still close the modal.
- [ ] Graph view docked panel: no button; panel width unchanged even if state is expanded.
- [ ] `bun run typecheck` and `bun run test` pass.

## Out of scope

- Graph view docked ticket panel (`.graph-ticket-panel`).
- Lane settings, board settings, delete-confirm, auto-run confirm and dashboard modals.
- Full height or native OS fullscreen (`BrowserWindow.setFullScreen`).
- Persisting the preference to DB / across restarts.
- Keyboard shortcut.

## Files to touch

- `src/views/BoardView.vue` — state, header row + button in both ticket modals.
- `src/styles.css` — `.ticket-modal.expanded`, header row class.
- `feature-map.md` — one line under the ticket modal section describing the toggle (repo keeps a feature map).

## Defaults chosen (full auto, no open questions)

- Applies to both ticket modals; graph panel excluded.
- Remembered for the app session only.
- Button lives in the eyebrow row; no close ✕ added.
