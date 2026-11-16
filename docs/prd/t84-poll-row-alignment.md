# PRD — Ticket #84: Align "Orchestrator poll (minutes)" and "Active" in the lane modal

Branch: `t84-ticket-modal-view`

## Shipped (supersedes R1/R4 and D3's "no markup change")
- After review the checkbox moved LEFT of the input and lost its "Active" text; its meaning is in a hover tooltip (`orchestratorPollTooltip`) plus `aria-label`.
- The D3 `min-height: 40px` rule still does the centering. Line numbers below are as of `f9a3efb` and have since drifted.

## PRD needed?
Barely. One CSS rule. Kept short so In Development has the verified root cause and the exact fix.

## Context
The lane cog modal shows "Orchestrator poll (minutes)" (number input) and an "Active" checkbox on one row (#64, `src/views/BoardView.vue:1742`). The checkbox and its text sit level with the bottom edge of the input, not its middle, so the two controls look misaligned.

## Root cause (verified 2026-11-16 on `f9a3efb`)
- `.orchestrator-poll-row` (`src/styles.css:1854`): `display: flex; align-items: flex-end; gap: 16px`.
- Left item: `.lane-modal label` (`styles.css:1351`) is a column: caption text, 6px gap, then the input. The input gets `min-height: 40px` from `input:not([type="checkbox"])` (`styles.css:491`).
- Right item: `label.checkbox-label` (`styles.css:1699`) is a row with `align-items: center`, but its own box is one text line (~20px) tall.
- `flex-end` lines up bottom edges, so the short checkbox label hugs the bottom of the 40px input instead of its center.

## Requirements
- R1. The "Active" checkbox and its text are vertically centered on the poll input box (not on its caption).
- R2. Same alignment with Active checked or unchecked (input disabled).
- R3. No change to any other `.checkbox-label` (filter popover, ticket modal, card field list).
- R4. Horizontal layout stays: same row, 16px gap.

## Decisions
- D1. Title says "Ticket modal view", but these fields only exist in the lane (swimlane cog) modal. The fix goes there.
- D2. "Aligned" = vertical alignment of the checkbox row with the input box.
- D3. CSS only, scoped to the row:
  ```css
  /* Matches the 40px input min-height (input:not([type="checkbox"])) so the
     label's align-items: center lands the checkbox on the input's middle. */
  .orchestrator-poll-row .checkbox-label {
    min-height: 40px;
  }
  ```
  Bottom edges still meet through `flex-end`; the label's existing `align-items: center` then centers checkbox + text on the 40px band. No markup change. Specificity (0,2,0) only adds `min-height`, so it doesn't fight `.lane-modal .checkbox-label`.
- D4. Hard-coded `40px` mirrors `styles.css:494`. The comment names that coupling. No new CSS variable for one use.

## Implementation
1. `src/styles.css`: add the D3 rule right after `.orchestrator-poll-row` (~line 1858).
2. Launch the app on an isolated DB copy, open a lane cog modal, check alignment with Active on and off.
3. `bun run test` + typecheck.

## Tests
Visual check only. A CSS layout nudge has no cheap unit test. Before/after screenshots go in the PR.

## Out of scope
- Restyling the poll row or the lane modal layout.
- A shared input-height CSS variable.

## Open questions
None.
