# PRD — #115 Per-lane card field settings cog

## Why a PRD
- New preference layer (board → lane) on top of `cardFields`. Gets the precedence rule, the back-compat read, and the header event plumbing (lane drag + dblclick draft both live on the header) wrong → cog starts a drag, or a lane hides fields in every lane.
- Popover must join the existing Escape / outside-click handling like the T93 modal-fields menu.

## Problem
- Card fields are board-wide only (board settings → "Ticket card display"). Users want e.g. Done lane to show PR + version but not description, while Idea lane shows description only.
- No per-lane control today.

## Today (verified 2026-11-19)
- `TICKET_CARD_FIELDS` `src/shared/projectTypes.ts:1752` — 9 fields (number, description, assignee, labels, checklist, branch, worktree, pullRequest, version). Title not in list → always shown.
- `BoardPreferences` `projectTypes.ts:1880` — `laneWidths`, `hiddenLaneIds`, `cardFields`, `knownCardFields?`, `hiddenModalFields`
- `createDefaultBoardPreferences` `:1904`; `getBoardPreferences` `:1914` spreads saved over defaults → a missing new key reads back as its default
- `toggleInList` `:1931` (private); `toggleCardField` `:1939`, `toggleModalField` `:1944`
- BoardView:
	- `preferences` / `savePreferences` `src/views/BoardView.vue:174-177` → `store.saveBoardPreferences`
	- `showsField(field)` `:183` — only reads `cardFields`; used by every card field at `:1690-1745`
	- Lane header `:1619-1659` — has `@pointerdown="startLaneDrag"` and `@dblclick="startTicketDraftFromHeading"`; children: name, count, unseen badge, Auto Run ▶, text ⚙ (`title="How you want to build it"` → `openLaneId = lane.id`)
	- Pattern to copy, modal fields menu (T93):
		- `modalFieldsMenuOpen` ref `:144`, reset on ticket change `:146-149`
		- `modalFieldsMenuRef` + `closeModalFieldsMenuOnOutsideClick` `:191-195`
		- Escape closes menu first `:654-659`
		- markup `:1914-1940` — `filter-menu` wrapper, SVG cog button (`aria-haspopup`, `aria-expanded`), `filter-popover role="group"` of checkboxes
- Agent prompt: `ticketAgentPrompt(ticket, lane, context)` `projectTypes.ts:674` — signature takes no preferences → hidden fields can't affect it. Already drops empty fields. Existing tests `src/shared/projectTypes.test.ts:637-662`.

## Requirements
1. Each lane header shows a fields cog (SVG, same glyph as T93), rightmost in the header.
2. Cog opens a popover: one checkbox per `TICKET_CARD_FIELDS` entry, checked = shown in this lane.
3. Field hidden board-wide → checkbox disabled + unchecked, hint "Hidden for the whole board". Lane cog can only hide further, never re-show.
4. Toggling affects only that lane's cards.
5. Persists across restart (per-user prefs, like `laneWidths`). Saved prefs without the new key → `{}` → every lane follows board setting.
6. Agent prompt unchanged by lane (or board) visibility; empty fields still absent.
7. Existing lane-settings ⚙ glyph → ✎, `title="Edit lane"`, so header shows one cog.
8. Works for the virtual `unassigned` lane too (keyed by its id).

## Design
### Data — `src/shared/projectTypes.ts`
- `BoardPreferences.hiddenLaneCardFields: Record<string, TicketCardField[]>` — laneId → hidden fields. Hidden list (not shown list) so fields added later show by default, same reason as `hiddenModalFields`.
- `createDefaultBoardPreferences` → `hiddenLaneCardFields: {}`. `getBoardPreferences` needs no change (spread covers old saves).
- New:
	```ts
	export const toggleLaneCardField = (
	  preferences: BoardPreferences,
	  laneId: string,
	  field: TicketCardField
	): BoardPreferences => {
	  const hiddenInLane = preferences.hiddenLaneCardFields[laneId] ?? []
	  return {
	    ...preferences,
	    hiddenLaneCardFields: { ...preferences.hiddenLaneCardFields, [laneId]: toggleInList(hiddenInLane, field) }
	  }
	}
	```
- No DB / schema / IPC change.

### View — `src/views/BoardView.vue`
- `showsField(field, laneId)` = board `cardFields` includes field AND lane's hidden list doesn't. Update all call sites in the card template (`:1690-1745`) to pass `lane.id` (cards render inside `v-for="lane"`).
	- Split for readability: `shownOnBoard(field)` + `hiddenInLane(field, laneId)`.
- `laneFieldsMenuLaneId = ref<string | null>(null)` — one open popover at a time.
- Outside click: popover lives in a `v-for`, so no single template ref. Close when `event.target` isn't inside `.lane-fields-menu` (`closest`). Register alongside the existing modal-fields outside-click listener.
- Escape: close lane fields menu first, next to the `modalFieldsMenuOpen` branch `:654`.
- Close menu when a lane drag starts or the lane is deleted (stale id harmless otherwise — popover just doesn't render).
- Markup: after the ✎ button, wrapper `div.filter-menu.lane-fields-menu` with `@dblclick.stop` (header owns draft); `startLaneDrag` ignores presses inside `.lane-fields-menu` so outside-click handlers for other menus still see them. Button: `aria-haspopup="true"`, `:aria-expanded`, `:aria-label="`Card fields in ${lane.name}`"`, `title="Card fields shown in this lane"`. Popover `role="group"`, `aria-label="Card fields shown in this lane"`.
- Popover anchored right (`right: 0`) so it doesn't overflow narrow lanes; check against `MIN_LANE_WIDTH`.

### Not touched
- `ticketAgentPrompt`, `ticketMetadataLines` — no changes.
- `TicketGraph.vue` — unaffected.
- Board settings "Ticket card display" — unchanged; remains the default for every lane.

## Acceptance criteria
- [ ] Every lane header (incl. No status) has a fields cog at top right; existing lane settings button shows ✎ "Edit lane".
- [ ] Unchecking a field in lane A hides it on lane A cards only; lane B unchanged.
- [ ] Field hidden board-wide shows disabled/unchecked with "Hidden for the whole board" in every lane popover.
- [ ] Re-enabling a field board-wide restores it in lanes that didn't hide it themselves.
- [ ] Clicking cog / popover does not start lane drag, ticket draft, or toggle anything else; outside click and Escape close it; Escape doesn't also close a modal.
- [ ] Restart app → per-lane choices kept. Prefs saved before this change load with all lanes following the board setting.
- [ ] Hidden field value still in agent prompt; empty field still absent.

## Tests — `src/shared/projectTypes.test.ts`
- `toggleLaneCardField`: hides in target lane only; second toggle un-hides; other lanes' entries untouched.
- `getBoardPreferences` with saved prefs lacking `hiddenLaneCardFields` → `{}`.
- `ticketAgentPrompt`: rich ticket → contains labels/branch/etc. regardless of a prefs object with every field lane-hidden (prompt built from same ticket, compared equal); ticket with empty description/labels/branch → those lines absent. (Signature takes no prefs — the test locks that the prompt is built from ticket data alone.)
- Manual / CDP: run app on isolated DB copy, toggle in one lane, verify other lane, restart, verify persistence.

## Edge cases
- Lane deleted → its `hiddenLaneCardFields` entry is orphaned. Harmless (keyed by unique id, never read). ponytail: no cleanup; add prune in `removeLane` if prefs bloat ever matters.
- Lane hides every field → card shows title only. Allowed.
- New card field shipped later → absent from every hidden list → shown. Intended.

## Out of scope
- Per-lane ticket modal field visibility.
- Hiding the title.
- Shared/synced per-lane settings across users.
- Lane cog re-showing a board-hidden field (override model). Could add later if asked.

## Branch / worktree
- Branch: `t115-add-a-settings`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t115`
