# PRD — #101 Orchestrator poll stepper (−  N  +, ∞ = off)

Branch: `t101-orchestrator-polling-time` · Worktree: `.worktrees/t101`

## PRD needed?
Small. One UI row + one pure helper. Kept short so In Development has verified code refs, the two pitfalls below, and the exact behavior table.

## Context (verified 2026-11-17 on `fd55108`)
- Row markup — `src/views/BoardView.vue:2244-2264` (`.orchestrator-poll-row`): checkbox label (`aria-label="Orchestrator poll active"`, tooltip `orchestratorPollTooltip`) + `<label>` "Orchestrator poll (minutes)" wrapping `<input type="number" min="1" step="1">`, disabled when inactive.
- Validator — `editOrchestratorPollMinutes` `BoardView.vue:865-873`: whole minutes ≥ 1 else reset input to `orchestratorPollMinutes(lane)`.
- Tooltip — `orchestratorPollTooltip` `BoardView.vue:875-879`.
- Save path — `editLane(lane, patch)` → `store.updateLane` (`BoardView.vue:861`). Both fields already whitelisted in `electron/ipcHandlers.ts:241`.
- Getters — `orchestratorPollMinutes` (falls back to `DEFAULT_ORCHESTRATOR_POLL_MINUTES` for 0/fraction/text) and `orchestratorPollActive` (`!== false`) — `src/shared/projectTypes.ts:940-946`.
- CSS — `src/styles.css:2090-2100`: `.orchestrator-poll-row` flex + `.orchestrator-poll-row .checkbox-label { min-height: 40px }` (from #84; dead once the checkbox goes).
- Consumers of "off" untouched: `buildOrchestratorLaunch` (`projectTypes.ts:1158`), Auto Run confirm (`BoardView.vue:2106`).
- Screenshot: dark rounded pill, full row width, thin `−` left, bold centered value, `+` right.

## Behavior
| State shown | `−` | `+` | Center |
|---|---|---|---|
| `∞` (active false) | disabled | save `{ orchestratorPollActive: true, orchestratorPollMinutes: 1 }` → shows 1 | text `∞`, not editable |
| 1 | save `{ orchestratorPollActive: false }` (minutes untouched) → `∞` | save minutes 2 | typeable |
| N > 1 | save minutes N−1 | save minutes N+1 | typeable |

- Step from the getter value (`orchestratorPollMinutes(lane)`), so a corrupted stored value steps from the default, never from NaN.
- `+` from `∞` is one patch / one write (both fields together).
- Typed value: existing `editOrchestratorPollMinutes` rule unchanged (0, blank, 1.5 → reset to stored). Typing 0 does NOT turn it off; only `−` does.
- Existing lanes with `orchestratorPollActive: false` open showing `∞`.

## Decisions
- D1. No storage change. `∞` ≡ `orchestratorPollActive: false`. No migration; `buildOrchestratorLaunch` untouched.
- D2. Leaving `∞` via `+` lands on 1, not the old stored minutes.
- D3. No upper bound.
- D4. Center: `v-if` swap. Active → `<input type="number" min="1" step="1">` with native spinners hidden (`appearance: textfield` + `::-webkit-inner/outer-spin-button { -webkit-appearance: none; margin: 0 }`). Off → `<span>∞</span>`. A number input can't hold the `∞` glyph, so a swap beats a text input + custom parsing.
- D5. Step logic as one pure exported helper in `src/shared/projectTypes.ts`, next to the getters:
  ```ts
  export const steppedOrchestratorPoll = (lane: SwimLane, step: -1 | 1): Partial<SwimLane> | undefined
  ```
  Returns the patch per the table above, `undefined` for `−` at `∞`. BoardView buttons call `const patch = steppedOrchestratorPoll(lane, step); if (patch) editLane(lane, patch)`. Keeps the branching unit-testable (no BoardView component test harness exists).
- D6. Styling scoped to `.orchestrator-poll-row` / a `.poll-stepper` class; no shared stepper component until a 2nd use. Reuse the existing input background/border/radius tokens from `input:not([type="checkbox"])` (`styles.css` ~491) so it matches light + dark theme; 40px height like other inputs.
- D7. Delete the checkbox markup and the dead `.orchestrator-poll-row .checkbox-label` rule.

## Pitfalls
- P1. Don't wrap the buttons in the `<label>`. A `<button>` is labelable: clicking the caption text would fire the first button (`−`) and could switch the lane off. Use `<label for="orchestrator-poll-minutes">` on the caption (or a `<span id>` + `aria-labelledby` on the group) and keep buttons outside it.
- P2. Buttons need `type="button"` (modal may sit in a form context; harmless either way).

## Accessibility
- Group: `role="group"`, labelled by the caption.
- `−` `aria-label="Decrease orchestrator poll"`, `+` `aria-label="Increase orchestrator poll"`.
- `∞` span: `aria-label="Orchestrator off"`; `aria-live="polite"` on the value wrapper so step changes are announced.
- Tooltip (`orchestratorPollTooltip`, unchanged text) on the group.

## Acceptance criteria
- AC1. Checkbox gone; one stepper pill (`−` · value · `+`) under the caption "Orchestrator poll (minutes)", styled like the screenshot.
- AC2. `−` at 1 → `∞`, saves `orchestratorPollActive: false`, minutes untouched.
- AC3. At `∞`: `−` disabled; `+` → saves active true + minutes 1, shows 1.
- AC4. `−`/`+` between 1..N step by 1 and save on click.
- AC5. Center typeable when active; invalid input resets to stored value.
- AC6. Tooltip at `∞` = "Off: Auto Run launches no Orchestrator agent for this lane."; otherwise the polling sentence.
- AC7. aria-labels as above; `∞` announced "Orchestrator off".
- AC8. Lanes stored inactive open showing `∞`.
- AC9. `bun run test` + typecheck pass.

## Tests
- Unit (`src/shared/projectTypes.test.ts`), `steppedOrchestratorPoll`:
	- inactive, `+1` → `{ orchestratorPollActive: true, orchestratorPollMinutes: 1 }`
	- inactive, `−1` → `undefined`
	- minutes 1, `−1` → `{ orchestratorPollActive: false }` (no minutes key)
	- minutes 5, `−1` → `{ orchestratorPollMinutes: 4 }`; `+1` → 6
	- corrupted minutes (0 / 1.5), `+1` → default + 1
- Existing inactive → no launch test (`projectTypes.test.ts:1544`) still passes.
- Manual, isolated DB copy (memory: run app before merge): `−` from 1 → ∞, `+` from ∞ → 1, type 7 → saved, type 0 → resets, clicking caption text does nothing, restart persists, light + dark theme.

## Out of scope
- Poll units, upper bound, other number inputs, live rate change of a running orchestrator, any storage/schema change.

## Open questions
None.
