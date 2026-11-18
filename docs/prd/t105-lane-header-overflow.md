# T105 — Lane header buttons overflow narrow lanes

Labels: bug, ui · Branch: `t105-the-buttons-should` · Worktree: `.worktrees/t105`

## Problem

When a lane is narrow, the header's Auto Run (⏩) and settings (⚙) buttons spill past the lane's right border. Screenshot on the ticket: "In Development" lane with ⚙ clipped outside the lane.

## Root cause (verified against `main` @ e48b8f1)

- `src/styles.css` `.lane-heading h2 { flex: 1; }` has no `min-width: 0`. A flex item's default `min-width: auto` keeps it from shrinking below its min-content width, which is the longest word ("Development", "Determination").
- `.icon-button` is a fixed `width: 40px; min-width: 40px`. The header holds h2 + `.lane-count` + optional `.lane-unseen-count` + 2 buttons, with `gap: 8px`.
- `MIN_LANE_WIDTH = 200` (`src/shared/projectTypes.ts`). Users can resize a lane narrower than the header's min-content width, so the header overflows the lane.
- Markup: `src/views/BoardView.vue`, `header.lane-heading`, in the `v-for="lane in visibleLanes"` section.

## Fix (CSS only, `src/styles.css`)

- `.lane-heading h2` → add `min-width: 0` and `overflow-wrap: anywhere`. The title wraps or breaks instead of pushing the buttons out.
- `.lane-heading > button`, `.lane-count`, `.lane-unseen-count` → `flex-shrink: 0`. The buttons and badges keep their size, and the title gives up space first.

Out of scope: changing `MIN_LANE_WIDTH`, the button size, or the header markup.

## Acceptance criteria

1. At `MIN_LANE_WIDTH` (200px), every lane's header buttons stay inside the lane border. Check long names ("In Development", "Value Determination", "Merge Request") and a lane with the unseen-count badge showing.
2. Long lane names wrap inside the header. The lane does not overflow horizontally.
3. Lanes at default width (260px) and wider look the same as before.
4. These still work: lane drag (pointer and Alt+Arrow), double-click on the header to create a new ticket, the Auto Run and ⚙ buttons.

## Risk / note

- At 200px the title gets about 60–70px (estimate: lane padding, about 110px of badges, buttons and gaps). `overflow-wrap: anywhere` may break a long word in the middle ("Developm|ent"). The ticket accepts this. If it looks bad, the fallback is a single line with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` and a `:title="lane.name"` on the h2.

## Verification

- Run the app against an isolated copy of the DB. Drag each lane to the minimum width and screenshot its header. Include a lane with unseen agent results.
- `bun run typecheck` / existing tests still pass. The change is CSS only, so no new unit test.
