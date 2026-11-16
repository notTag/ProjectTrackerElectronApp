# PRD — Ticket #80: "+" to add a swimlane

## Context
Adding a lane needs the toolbar **+ Swim lane** button or the empty-board **Create swim lane** button. Both set `laneDraftName = ''`, which opens the "New swim lane" modal → `saveLaneDraft` → `store.addLane` (appends at the end). Nothing marks the spot a new lane actually lands: the right end of the lanes.

## Acceptance criteria
- A trailing hover zone renders as the last child of `.board`, after the right-most visible lane: one lane wide, full board height. Not a `.lane`, no `data-lane-id`.
- Invisible at rest — no "+" until hovered or focused.
- Hover → a large "+" in a thin-bordered box (1px `--color-border`, glyph `--color-text-muted`) slides in from the right (translateX + opacity, ~200ms ease-out).
- Mouse leaves → "+" stays 3s, then slides back out to the right. Re-entering within the 3s cancels the pending hide (no flicker, no replayed fly-in).
- Click "+" → opens the existing "New swim lane" modal (`laneDraftName = ''`). No new create path.
- "+" is a real `<button aria-label="Add swim lane" title="Add swim lane">`. `:focus-visible` = shown state, so keyboard users reach it without a mouse.
- `prefers-reduced-motion: reduce` → no slide, opacity-only change; 3s delay still applies.
- Absent in graph view and while a single-lane filter (`filterLaneId`) is active.
- During a lane drag (`laneDrag?.active`) the zone is inert (hidden, `pointer-events: none`) but keeps its box — see Approach §2.
- Lane drag-reorder drop indicator + lane resize still work.
- Toolbar **+ Swim lane** and empty-board button unchanged.
- Pending 3s timer cleared on unmount.

## Code today (verified 2026-11-15 on `84e6a72`)
- Board: `<section ref="boardElement" class="board">` `src/views/BoardView.vue:1058-1063`, in the `v-else` after the graph view (`:1052`) and empty-board branch (`:1053-1056`) → graph view + zero-lane board already excluded by placement
- Lanes: `v-for="lane in visibleLanes"` `:1072`, closing `</section>` `:1225`; board closes `:1226` → zone goes between them
- `visibleLanes` `:156` — hidden lanes + `filterLaneId` (`:91`) already applied
- Drag: `laneDrag` ref `:206`; `laneElements()` `:235` queries `.lane[data-lane-id]`; `laneAnchorAt` `:241` positions the indicator from lane `offsetLeft`s and the last sibling — a non-`.lane` trailing element is ignored by both
- Modal: `laneDraftName` `:103`, toolbar button `:997`, modal `:1303`, `saveLaneDraft` `:612`
- Unmount hook already exists: `onBeforeUnmount` `:570` (removes keydown listener)
- CSS: `.board` `src/styles.css:1055` — flex, `gap: 12px`, `overflow-x: auto`, `justify-content: safe center`, `position: relative`. `.lane` `:1095`, width inline. Reduced-motion pattern: `:858`, `:1260`, `:1637`
- No component tests in repo (vitest covers `src/stores`, `src/shared` only)

## Approach
1. Template — after the lanes `v-for`, inside `.board`:
   ```vue
   <div
     v-if="!filterLaneId"
     class="lane-add-zone"
     :class="{ shown: addZoneShown, inert: laneDrag?.active }"
     @mouseenter="showAddZone"
     @mouseleave="hideAddZoneLater"
   >
     <button class="lane-add-button" aria-label="Add swim lane" title="Add swim lane" @click="laneDraftName = ''">+</button>
   </div>
   ```
2. Inert, not `v-if`, during drag. With `safe center` and no overflow, removing the zone's box (its width + one gap) re-centers every lane → lanes jump the moment a drag starts. Keeping the box avoids that. (`filterLaneId` toggling is a user action, so the reflow there is fine.)
3. Script — one timer, no lib:
   ```ts
   const ADD_ZONE_HIDE_DELAY_MS = 3000
   const addZoneShown = ref(false)
   let addZoneHideTimer: ReturnType<typeof setTimeout> | undefined
   const showAddZone = () => {
     clearTimeout(addZoneHideTimer)
     addZoneShown.value = true
   }
   const hideAddZoneLater = () => {
     clearTimeout(addZoneHideTimer)
     addZoneHideTimer = setTimeout(() => { addZoneShown.value = false }, ADD_ZONE_HIDE_DELAY_MS)
   }
   ```
   Add `clearTimeout(addZoneHideTimer)` to the existing `onBeforeUnmount` (`:570`).
   Re-enter while shown → `addZoneShown` already `true` → class unchanged → no replayed transition.
4. CSS next to `.lane` in `styles.css`:
   - `.lane-add-zone`: `flex: 0 0 auto`, `display: flex`, center content, `overflow: hidden` (so the off-screen "+" doesn't widen the scroll area)
   - `.lane-add-button`: large glyph (~2.5rem), transparent bg, `1px solid var(--color-border)`, `color: var(--color-text-muted)`, `transform: translateX(100%)`, `opacity: 0`, `transition: transform 200ms ease-out, opacity 200ms ease-out`
   - `.lane-add-zone.shown .lane-add-button, .lane-add-button:focus-visible` → `transform: none; opacity: 1`
   - `.lane-add-zone.inert` → `pointer-events: none`, button forced hidden
   - `@media (prefers-reduced-motion: reduce) { .lane-add-button { transform: none; transition: opacity 200ms; } }`
   - Zone width: `DEFAULT_LANE_WIDTH` (260, `src/shared/projectTypes.ts:1554`) — bind it as an inline width like lanes do, or hard-code `260px` in CSS with a `ponytail:` note pointing at the constant

## Layout note
- No overflow: zone sits right after the last lane, not at the window edge; lanes shift left by half (zone + gap) to stay centered with it. Accepted.
- Overflow: `.board` scroll width grows by zone + gap; "scroll all the way right" reveals it.

## Out of scope
- Inline lane naming in the zone (still the modal)
- Choosing the new lane's position (`store.addLane` appends)
- Removing/moving the toolbar button
- Touch / no-hover beyond keyboard focus
- Graph-view add-lane affordance
- Configurable delay or animation

## Verification
- `bun run typecheck`, `bun run test`, `bun run build` clean
- Manual in the app (`/run`, isolated DB copy):
  - Few lanes (no overflow) + many lanes (overflow, scroll right) — zone after last lane both times
  - Hover → "+" slides in; leave → gone after ~3s; re-enter at ~2s → stays, no flicker
  - Click "+" → "New swim lane" modal → save → lane appended
  - Tab to "+" → visible without hover; Enter opens modal
  - Lane drag: no lane jump on drag start, drop indicator past last lane correct, reorder works; resize handle works
  - Lane filter set → zone gone; graph view → zone gone
  - macOS Reduce Motion on → opacity-only
  - Light + dark theme: border + glyph readable
  - Navigate away within 3s → no console warnings

## Open questions
None. Deviation from the ticket's defaults: zone is inert (not removed) during a lane drag — avoids lanes jumping in the centered layout.

## Branch / worktree
- Branch: `t80-to-add-a`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t80`
