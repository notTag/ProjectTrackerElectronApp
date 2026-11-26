# PRD — #140 Settings modal: resizable + accordion sections

Branch: `t140-settings-modal` · Worktree: `.worktrees/t140`

## Problem
- ⚙ Settings modal (`BoardView.vue:1977`) is a menu of buttons that swap to other surfaces
	- `MetricsPanel` = its own 📊 toggle + popover, rendered inline via `.settings-modal .metrics-popover { position: static }` (`styles.css:2299`)
	- `Display` → `openDisplaySettings()` (`BoardView.vue:147`) closes Settings, opens 2nd modal `boardSettingsOpen` (`BoardView.vue:1911`)
	- `🎚 UI Settings` → `openUiSettingsPanel()` (`BoardView.vue:152`) closes Settings, opens floating `UiSettingsPanel.vue`
- Edge-resize (#117, `vEdgeResize` in `src/modalWidth.ts`) only on ticket, graph ticket, lane modals. #117 PRD deliberately left settings / new lane / confirm dialogs without it — this ticket reverses that

## Current state (verified)
- Backdrop close + resize conflict already solved in BoardView: `notePressTarget` / `closeIfPressStartedOnBackdrop` (`BoardView.vue:685-694`)
	- `vEdgeResize` calls `preventDefault()` on an edge press → helper skips the close
	- Modals on plain `@click.self` close after an edge drag released over the backdrop → every newly resizable modal with a backdrop-close needs the helper
- `.settings-modal` CSS (`styles.css:2281`): `width: auto; min-width: min(420px, 100%); max-width: 100%; align-items: flex-start`
	- `width: auto` lets the metrics table size the modal; fights the inline width `vEdgeResize` writes
	- `align-items: flex-start` would shrink `<details>` rows to content width
- `.modal.resizable` (`styles.css:1660`): `min-width: min(560px, 100vw - 48px); max-width: calc(100vw - 48px)`
- Display modal has 3 groups, not 2: Swimlane visibility (show/hide lanes), Ticket Card fields, Swim lane Settings fields
- `MetricsPanel` shared with Dashboard titlebar (`DashboardView.vue:418`, scope `dashboard`) — popover mode must keep working there
	- Opens via button, persists open in `localStorage` `metrics-panel-open:<scope>`, closes on outside click, loads (git/gh per project) on open
- `UiSettingsPanel` only entry point = Settings modal button. Watch on `uiDemoValues` → `applyUiDemo()` + `saveUiDemo()` lives in the panel component; `applyUiDemo()` also runs at boot (`main.ts:17`)
	- Floating, no backdrop, z-250 above modal backdrops (#129) so modal knobs can be tuned live over an open modal
	- `uiDemoPanelPosition` (drag position) saved in the same `localStorage` payload
- Section open-state pattern: `laneModalSectionsOpen` reactive in `modalWidth.ts:11` + `rememberLaneSectionOpen` (`BoardView.vue:238`) on `@toggle`
- All `.modal` sections without resize
	- BoardView: Display (1912), Settings (1978), new lane (2064), delete ticket (2441), auto-run confirm (2454), delete lane (2863)
	- DashboardView: onboarding (694, no backdrop close), remove directory (717, `@click.self`)

## Requirements

R1. Every modal resizable
- Add `v-edge-resize` + `resizable` class to every `section.modal` listed above that survives this ticket
- Every one of those with a backdrop close → `@pointerdown="notePressTarget"` + `@click.self="closeIfPressStartedOnBackdrop(...)"`
- Move `notePressTarget` / `closeIfPressStartedOnBackdrop` from `BoardView.vue` to `src/modalWidth.ts` (export) so `DashboardView` uses the same pair
	- module-level `pressStartedOnBackdrop` is fine: one backdrop pressed at a time
- Onboarding modal: directive + class only (no backdrop close to guard)
- Width not persisted, no per-modal expand toggle (only ticket + lane modals have `ExpandToggle`)

R2. Settings modal = three accordions
- Body, top to bottom: eyebrow `Board Settings`, then three `<details class="lane-settings-section">` with `<summary class="eyebrow">` + `<div class="lane-settings-section-body">`
	- `Metrics`
	- `Display`
	- `UI Settings`
- Done button + Esc + backdrop click still close it
- Open state per section shared across boards, kept for the app session
	- new `settingsModalSectionsOpen = reactive({ metrics: false, display: false, uiSettings: false })` next to `laneModalSectionsOpen` in `modalWidth.ts`
	- default all collapsed: Metrics runs git/gh on load; collapsed avoids that cost on every Settings open
	- `@toggle` writes `details.open` back (same shape as `rememberLaneSectionOpen`; generalize that fn to take the target reactive, or add a sibling one-liner)

R3. Metrics section
- Body = metrics table inline, no 📊 button inside
- `MetricsPanel` gets prop `inline?: boolean`
	- `inline` → render header (Metrics label + ↻ refresh) + table only, no toggle button, no outside-click listener, no `localStorage` open-state read/write, load on mount
	- not `inline` → unchanged (Dashboard)
- Mount with `v-if="settingsModalSectionsOpen.metrics"` inside the section body → collapsed section never loads; opening it loads once
- Table wider than modal → horizontal scroll inside the section body (`overflow-x: auto`), modal width stays user-controlled
- Drop `.settings-modal .metrics-menu` / `.metrics-popover` rules that only existed to un-popover it; keep the `.titlebar-actions .metrics-popover-header button` half of the shared selector at `styles.css:2306`

R4. Display section
- Body = all three groups moved verbatim from the `boardSettingsOpen` modal: Swimlane visibility, Ticket Card, Swim lane Settings fields (`<hr />` between groups kept)
- Delete: `boardSettingsOpen` ref, `openDisplaySettings`, the Display modal template, `boardSettingsOpen` in `anyModalOpen` (205) and `closeModals` (701)
- Remove `EyeOffIcon` import from BoardView if no other use remains (only use today = Display button, l.1982)

R5. UI Settings section
- Body = `UiSettingsPanel` controls inline (rows + Reset), no titlebar / drag / ✕
- Implementation: strip `UiSettingsPanel.vue` down to its body (rename optional, e.g. `UiSettingsControls.vue`)
	- keep: `uiDemoValues` watch (apply + save), `commitNumber`, `setRange`, `setChoice`, InfoTip text ("Changes save automatically…") moved beside the section summary or atop the body
	- delete: `panel` ref, drag fns, `clampIntoViewport`, `keepInViewport`, resize listener, fixed-position styles
- `src/uiDemo.ts`: delete `uiDemoPanelOpen`, `uiDemoPanelPosition`, `PanelPosition`/`readPosition`; `saveUiDemo` payload → `{ values }`
	- `normalizeUiDemoValues` already reads `stored.values`; old payloads with a `position` key load fine (ignored)
- BoardView: delete `uiDemoPanelOpen` import, `openUiSettingsPanel`, `<UiSettingsPanel v-if=...>` (1639), Esc branch (769-773)
- CSS: delete `.ui-demo-panel` / `.ui-demo-titlebar` rules; keep `.ui-demo-body` / `.ui-demo-row` (restyle only if they break at modal width)
- Known tradeoff, accepted: #129's "tune modal knobs over an open ticket/lane modal" goes away
	- modal radius / opacity knobs still preview live on the Settings modal itself (it is a `.modal`)
	- card knobs preview through the backdrop (0.42 dim)
	- re-add a floating mode later only if a second entry point needs it

R6. Settings modal CSS reconcile
- `.settings-modal`: drop `width: auto`, `min-width`, `max-width`, `align-items: flex-start` → `.modal` 560px default + `.modal.resizable` min/max take over
- Keep `.settings-modal .modal-actions { align-self: stretch }` only if still needed after `align-items` goes (it won't be — delete)

R7. Docs
- `feature-map.md` l.251 (Settings modal) + l.328-330 (UI Settings panel) + Display modal entry (3.5) → describe accordions; note every modal is edge-resizable

## Acceptance checks
- Settings modal: drag left/right edge → width follows pointer, clamps at 560px floor and viewport-48px ceiling; releasing over the backdrop does not close it
- Same drag on: new lane, delete ticket, auto-run confirm, delete lane, Dashboard onboarding, Dashboard remove-directory
- Settings shows 3 collapsed sections; expand Metrics → table loads with ↻; collapse/reopen Settings → open sections stay open; switch board ↔ dashboard → still remembered; restart app → all collapsed
- Dashboard 📊 Metrics popover unchanged (button, outside-click close, remembered open)
- Display section toggles hide/show lanes, card fields, lane-modal fields exactly as the old modal did
- UI Settings section: slider / number / select change applies live and survives restart; Reset restores defaults
- Esc with Settings open → closes; no stray Display modal or floating panel reachable anywhere
- `bun run typecheck` + `bun run test` green

## Out of scope
- Persisting modal width or accordion state across restarts
- Height resizing
- Redesigning controls inside sections
- Expand toggle on non-ticket/lane modals

## Files
- `src/views/BoardView.vue` — Settings template, delete Display modal + panel wiring, resize on all modals, backdrop helpers import
- `src/views/DashboardView.vue` — resize + backdrop helper on both modals
- `src/modalWidth.ts` — `settingsModalSectionsOpen`, exported backdrop helpers
- `src/components/MetricsPanel.vue` — `inline` prop
- `src/components/UiSettingsPanel.vue` — strip to inline controls
- `src/uiDemo.ts` — drop panel open/position state
- `src/styles.css` — `.settings-modal` reconcile, drop popover-in-modal + floating panel rules
- `feature-map.md`
