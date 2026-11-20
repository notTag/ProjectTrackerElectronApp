# PRD — #119 InfoTip swallows Esc + #102 review nits

## Why a PRD
- Esc ordering spans 4 listeners in 3 files (PageFind capture, InfoTip capture, ModelField `@keydown.esc.stop`, board bubble handler). Wrong guard → tip either eats Esc again or stops hiding.
- a11y rename touches 4 call sites; copy for lane Full auto needed checking against #44 / #67 semantics.
- No new state, no persistence, no new deps.

## Today (verified @ `adcf96a`, 2026-11-20)
- `src/components/InfoTip.vue:15-22` — `dismissOnEscape`: Esc + `isShowing()` → `dismissed = true` + `stopPropagation()`, unconditional. Registered `:32` on `window`, capture.
- `src/components/PageFind.vue:45-48` — Find open + Esc → `preventDefault` + `stopPropagation`, also window capture, registered app-wide before any tip → runs first. Same-target listeners still run → tip also hides.
- `src/components/ModelField.vue:65` — custom input `@keydown.esc.stop` (target phase). Never reached: tip's capture listener stopped it.
- `src/views/BoardView.vue:673` `handleBoardKeydown` (window, bubble) Esc order: lane drag → modal fields menu → lane fields menu → delete confirms → modal close. All skipped while a hover tip shows.
- Call sites (InfoTip inside `<label>` → "More info" leaks into accessible name):
	- `:2214` ticket Full auto checkbox (icon after text)
	- `:2448` Agent prompt textarea `#lane-agent-prompt` (`label-with-tip` span)
	- `:2491` Orchestrator prompt textarea `#lane-orchestrator-prompt` (`label-with-tip` span)
	- `:2652` lane Full auto checkbox (icon BEFORE text, copy repeats label)
- `BoardView.vue:97` `agentPromptTip` — "sent to the agent when a ticket enters this lane" (wrong: sent whenever a ticket agent launches — ▶ Run, Run in, Auto Run, Full auto handoff).
- `src/styles.css:1659` `.info-tip-bubble` — `background: var(--color-surface)`; t102 PRD says `--color-surface-raised` (used by modals, `styles.css:194` etc.).
- `docs/prd/t102-info-tip.md:25` — "button's keydown bubbles up before the window listener runs" — false; capture listener on window runs first.
- Semantics for lane Full auto copy:
	- Effective full auto = `lane.fullAuto || ticket.fullAuto` (t44 D1); fires on any lane move by an agent (`fullAutoHandoffs`)
	- Next Lane = `ticket.moveToLaneId ?? lane.nextLaneId` (t67 D1); destination of the auto-move when an armed ticket's checklist completes
- Tests: `src/components/InfoTip.test.ts` = SSR render only. No jsdom / happy-dom / `@vue/test-utils` in deps → no DOM event tests possible without a new dep.

## Requirements

### R1 — Esc (BUG + Find nit) — `InfoTip.vue` only, capture listener kept
```ts
const dismissOnEscape = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !isShowing()) return
  dismissed.value = true
  const tipButtonIsTarget = event.target === button.value
  if (tipButtonIsTarget) event.stopPropagation()
}
```
- `defaultPrevented` → PageFind (earlier capture listener) already handled Esc; tip untouched.
- Tip showing → always hides.
- Claim Esc (`stopPropagation`) only when the tip button is `event.target` → keyboard-focused tip eats 1st Esc, modal stays; 2nd Esc closes modal.
- Hover-only tip → hides, event passes on → ModelField custom input, fields menus, lane drag, delete confirm, modal close all still get Esc.
- Decision: hover-shown tip no longer blocks modal close (native `title` tooltips never eat Esc). Avoids coupling `handleBoardKeydown` to tip state.
- Rewrite comment `:15-17` to state the above (why capture, why only target claims).

### R2 — a11y names (all 4 call sites)
- Wrap visible label text in `<span :id>`; control gets `aria-labelledby` = that id.
	- ids: `ticket-full-auto-label`, `lane-agent-prompt-label`, `lane-orchestrator-prompt-label`, `lane-full-auto-label` (one modal open at a time → static ids OK)
	- prompt sites: put the id on the existing text inside `.label-with-tip` (wrap text in its own span; InfoTip stays a sibling)
- Layout unchanged; InfoTip stays in the `<label>` (its `@click.prevent` already blocks label activation).
- Accessible names: "Full auto", "Agent prompt", "Orchestrator prompt", "Full auto: start the next lane's agent…".

### R3 — lane Full auto (`:2652`)
- Move `<InfoTip>` after the label text (matches ticket modal + prompt labels).
- New copy (adds info, not a repeat):
	- "Covers every ticket in this lane. A ticket's own Full auto turns it on for that ticket in every lane. Next Lane below sets where a ticket moves when its checklist is done."

### R4 — Agent prompt tip (`:97`)
- First sentence → "Instructions given to the agent each time it starts on a ticket in this lane."
- Keep the markdown-file sentence and the `\n\nNo {{variables}}…` paragraph as-is.

### R5 — bubble surface
- `.info-tip-bubble` background → `var(--color-surface-raised)` (matches t102 PRD + modal surface). Check light + dark readability; border already separates bubble from modal.

### R6 — t102 PRD fix
- Replace `docs/prd/t102-info-tip.md:25` with: "Capture-phase window listener runs before the button's own handlers; Esc is claimed only when the button is the target."

## Acceptance
- Ticket modal → Model → Custom…, pointer on Full auto ⓘ, Esc → custom entry backs out, tip hides, modal stays open
- Fields menu open + hover tip, Esc → menu closes; lane drag + hover tip, Esc → drag cancels
- Hover tip only (focus in a plain field), Esc → tip hides AND modal closes (R1 decision)
- Tab to ⓘ, Esc → tip hides, modal stays; 2nd Esc → modal closes
- Find bar open + tip shown, Esc → only Find closes; tip still visible
- VoiceOver / a11y tree: "Full auto, checkbox", "Agent prompt, edit text" — no "More info" in names
- Lane Full auto: icon after text, new copy
- Bubble readable in light + dark
- `bun run typecheck` + `bun run test` green

## Test
- No DOM test env (see Today). Don't add jsdom for 3 branches → verify R1 flows in the running app via CDP on an isolated DB (per run-app-before-merge).
- Optional if dev wants a unit check: extract the branch to a pure exported fn `escapeClaim(event, isShowing, buttonEl) → 'ignore' | 'hide' | 'hide-and-claim'` and test with plain objects. Not required.

## Out of scope
- Moving tip dismissal into `handleBoardKeydown`
- Changing PageFind to `stopImmediatePropagation` (R1's `defaultPrevented` guard covers it)
- Other InfoTip call sites added after `adcf96a` (none known)
