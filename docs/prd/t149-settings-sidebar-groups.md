# PRD: Settings sidebar group headings (#149)

## Problem
Ticket asks for a side-by-side Settings modal: left list grouped as Board Settings ("Metrics", "Display") and UI Settings ("UI Settings"), right pane shows the selected item. #145 (PRs #183, #186, main @ `85705b9`) already shipped the side-by-side layout. Only gap: the sidebar is a flat list with no group headings.

## Today (main @ `85705b9`)
- `src/components/UiSettingsPanel.vue`
	- `SECTIONS` (line 19) — flat `{ id, icon, label }[]`: 👁 Display, 📊 Metrics, 🎚 UI Settings
	- Template (line 139) — `<nav class="settings-sidebar" aria-label="Settings sections">` → `v-for` of `<button class="settings-sidebar-item">`, `selected` class + `aria-current`
- `src/uiDemo.ts:130` — `selectedSettingsSection` ref, default `'display'`
- `src/styles.css`
	- `.eyebrow` (line 280) — muted, 0.78rem, bold
	- `.settings-sidebar` / `-item` / `-icon` (lines 2570-2603) — flex column, gap 2px, padding 8px

## Decisions
- D1. Side-by-side layout = done by #145. This ticket adds group headings only
- D2. Order + default stay as #186 set them: Display (default), Metrics, UI Settings. AC lists Metrics first; Display-first was a deliberate #186 call
- D3. Group headings = plain `<span class="eyebrow settings-sidebar-group">`, not buttons → no focus, no click, no selection
- D4. Each group wrapped in `<div role="group" :aria-labelledby="<heading id>">` → screen readers announce the group name
- D5. No change to `SettingsSection` type, `selectedSettingsSection`, or section contents

## Implementation sketch
- `src/components/UiSettingsPanel.vue`
	- `SECTIONS` → `SECTION_GROUPS`:
		- `{ id: 'board', label: 'Board Settings', sections: [display, metrics] }`
		- `{ id: 'ui', label: 'UI Settings', sections: [ui] }`
	- Template: outer `v-for` group → `<div role="group" :aria-labelledby="`settings-group-${group.id}`">` + `<span :id class="eyebrow settings-sidebar-group">` + existing button loop unchanged
	- Any other `SECTIONS` reference → derive from `SECTION_GROUPS` (`flatMap`) or drop if unused
- `src/styles.css` — one rule, no other new CSS:
	- `.settings-sidebar-group { padding: 8px 10px 2px; }`
	- Groups after the first get a little top margin (e.g. `[role="group"] + [role="group"] { margin-top: 8px; }` scoped under `.settings-sidebar`)
	- Group `div` needs `display: flex; flex-direction: column; gap: 2px` (or `display: contents`) so item spacing matches today
- `feature-map.md` — Settings entry: sidebar grouped under Board Settings (Display, Metrics) / UI Settings (UI Settings)

## Tests
- No component test exists for `UiSettingsPanel.vue`; template-only change → no new unit test
- `bun run test` + typecheck green
- Run-app check (isolated DB copy, CDP) is the real verification

## Acceptance
- [ ] Sidebar shows "Board Settings" heading above Display + Metrics
- [ ] Sidebar shows "UI Settings" heading above the UI Settings item
- [ ] Headings use `.eyebrow` style, are not buttons, can't take focus or be selected (Tab skips them)
- [ ] Order Display → Metrics → UI Settings; Display selected on open
- [ ] Clicking each item swaps the right pane to only that section; Display toggles, Metrics table, UI sliders/Reset behave as before
- [ ] `bun run test` + typecheck green
- [ ] App exercised on an isolated DB copy before merge: open ⚙ Settings → headings visible, Display selected, click each item, Tab through sidebar

## Out of scope
- Section contents
- Reordering sections
- Panel size / position / resize / drag
- Dashboard header

## Work location
- Branch `t149-rework-the-ux`
- Worktree `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t149` (off main @ `85705b9`)

## Open questions
- None. Defaulted under full auto: side-by-side already shipped (#145); keep #186's Display-first order over the AC's Metrics-first listing
