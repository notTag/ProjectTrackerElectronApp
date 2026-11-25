# PRD — #137 Header menu bar consolidation

Branch `t137-header-menu-bar` · worktree `.worktrees/t137`

## Problem
Board header (`src/views/BoardView.vue:1563-1604`) holds 10 controls in one right-aligned cluster: ← Projects, 📊 Metrics, Open In, ⌁ Open, + Ticket, ⇣ Pull issues, + Swim lane, ⚙ Display, 🎚 UI Demo. Too crowded. Fix: move Metrics + Display into a Settings modal, put Open In + ⌁ Open next to the project title.

## Current state (verified)
- No app-level "Settings modal" exists. The only board-wide modal is the ⚙ Display modal (`boardSettingsOpen`, `BoardView.vue:138`, template l.1878-1924: card fields, lane settings fields, columns)
- `.titlebar-title` is `flex: 1 1 0` (`styles.css:76`) → pushes the actions right. Titlebar is `-webkit-app-region: drag`; only `.titlebar-actions` opts out (`no-drag`, l.91)
- `MetricsPanel` is a self-contained button + absolute popover (`.filter-popover`: `position: absolute; right: 0; top: 100%+6px`, `styles.css:394`)
- `OpenInPicker` popover also uses `.filter-popover` → `right: 0`, opens leftward
- Dashboard header (`DashboardView.vue:418, 531`) also has Metrics + Open In — out of scope (ticket says "project title" → board only)

## Decisions (defaults taken, full auto)
- D1. New header button `⚙ Settings` (replaces `⚙ Display` slot) opens a new Settings modal (`settingsOpen` ref). The Settings modal is the "Settings modal" the ticket names
- D2. Settings modal has one section, eyebrow "Board Settings", holding:
	- `<MetricsPanel :project-paths="[projectPath]" scope="board" />` — popover renders inline inside the modal: `.settings-modal .metrics-popover { position: static; }` → no clipping, modal grows
	- `⚙ Display` button → `settingsOpen = false; boardSettingsOpen = true` (swap, never stacked modals)
- D3. Display modal itself unchanged (rename of `boardSettingsOpen` not needed)
- D4. Left group: wrap title + Open In + ⌁ Open in `<div class="titlebar-lead">`
	- `.titlebar-lead { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 8px; }`
	- `.titlebar-title` → `flex: 0 1 auto` (still ellipsizes); the empty rest of `.titlebar-lead` stays a drag handle
	- Open In + ⌁ Open wrapped in `<div class="titlebar-actions">` reuse (no-drag + button sizing) — or new `.titlebar-lead-actions` with `-webkit-app-region: no-drag; flex-shrink: 0`
	- Open In popover: `.titlebar-lead .filter-popover { left: 0; right: auto; }` → opens rightward, not over the traffic lights
- D5. Order left→right: `<title> | Open In ▾ | ⌁ Open`

## Change (3 files)
1. `src/views/BoardView.vue`
	- header template: move `<OpenInPicker />` + ⌁ Open button into `.titlebar-lead` after title; remove `<MetricsPanel>`; `⚙ Display` → `⚙ Settings` (`@click="settingsOpen = true"`, title "Board settings")
	- add `const settingsOpen = ref(false)` near l.138
	- `anyModalOpen` (l.172-182): add `|| settingsOpen.value`
	- `closeModals` (l.665): add `settingsOpen.value = false`
	- new modal after Display modal (l.1924): `.modal-backdrop` + `section.modal.lane-modal.settings-modal`, eyebrow "Board Settings", MetricsPanel, Display button, Done
2. `src/styles.css` — D2 + D4 rules near `.titlebar` block (l.56-110)
3. `feature-map.md` — board header table (l.245-251): Open In / ⌁ Open now beside title; Metrics + Display rows → under new `⚙ Settings` row; note Settings modal "Board Settings" section

## Acceptance criteria
- AC1. Header has a `⚙ Settings` button; clicking it opens a Settings modal with a "Board Settings" section
- AC2. 📊 Metrics is inside "Board Settings", not in the header; clicking it shows the board's metrics (same data as before), readable inside the modal, not clipped
- AC3. ⚙ Display is inside "Board Settings", not in the header; clicking it closes Settings and opens the existing Display modal
- AC4. Open In picker sits immediately right of the project title; its dropdown opens fully on-screen
- AC5. ⌁ Open sits immediately right of Open In; launches same target as before
- AC6. Long project title ellipsizes; Open In + ⌁ Open never get pushed off or overlap the right cluster
- AC7. Empty titlebar space still drags the window; new left-group buttons are clickable (no-drag)
- AC8. Escape / backdrop click closes the Settings modal; board shortcuts blocked while it's open (`anyModalOpen`)
- AC9. Dashboard header unchanged
- AC10. `bun run test` + typecheck/lint pass; run app on isolated DB copy and exercise all of the above before merge

## Out of scope
- Dashboard header
- Moving other header buttons (+ Ticket, Pull issues, + Swim lane, UI Demo) into Settings
- Restyling the Display modal content
