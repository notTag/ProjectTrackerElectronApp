# PRD — #135 Abstract BoardView.vue into logical components

## Work location
- Branch: `t135-abstract-boardview-vue`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t135`
- PRD: `docs/prd/t135-abstract-boardview-vue.md`

## Problem
`src/views/BoardView.vue` is 2876 lines (script 1–1594, template 1596–2876). Styles are already global in `src/styles.css`, so there's no `<style>` block to split. One file holds the titlebar, filters, the lanes board, and 9 modals, so every change means reading it all. Split it into focused child components. This is a pure refactor: no change to behavior, DOM structure, class names or visuals.

## Current state (verified at 39c3f2c)
### Template regions
| Region | Lines | Script it owns (approx.) |
|---|---|---|
| Titlebar + actions | 1597–1643 | `projectTitle`, `githubUrl`, `pullIssues`, `pullingIssues` |
| Filter bar (search, lane filter menu, hidden toggles, count, lanes/graph switch) | 1644–1713 | `filterQuery*`, `showOnlyMine`, `filterLaneIds`, `laneFilterMenu*`, `activeFilterLaneIds`, `laneFilterLabel`, `toggleLaneFilter`, `clearFilters`, `filtersActive`, `visibleTicketCount` |
| Lanes board (columns, resize, lane drag + keyboard reorder, cards, ticket drag + stack ghost, selection, add-lane zone) | 1714–1910 | 336–519, 536–546, 795–822, 1115–1172, 1549–1581 |
| Display modal (`v-if="boardSettingsOpen"`) | 1911–1976 | `showsField`/`toggleField`, `toggleLaneVisibility`, `toggleLaneFieldOnBoard` |
| Board Settings modal (`v-if="settingsOpen"`) | 1977–1994 | `openDisplaySettings`, `openUiSettingsPanel` |
| New ticket modal | 1995–2062 | `ticketDraft`, `draftImageInput`, 823–894 (`stageDraftImages` … `saveTicketDraft`), `draftNextLaneId` |
| New swim lane prompt | 2063–2073 | `laneDraftName`, `laneDraftGraphPosition`, `saveLaneDraft` |
| Ticket modal | 2074–2439 | `checklistDraft`, `linkDraft*`, `imageError`, `modalFieldsMenu*`, `hidesModalField`, `valuesBeforeEdit`/`cancelTicketEdits`, PR refresh/override, `versionInvalid`, 940–1083 (edit/checklist/links/images), 1188–1248, 1582–1593 |
| Delete ticket confirm | 2440–2452 | `ticketPendingDeletion`, `deleteConfirmCancelButton`, `askToDeleteTicket`, `confirmDeleteTicket` |
| Auto Run / orchestrator confirm | 2453–2511 | `autoRunConfirm*` refs (1475–1482), `askToAutoRunLane`, `confirmAutoRunLane`, `changeAutoRunConfirmAgent` |
| Lane settings modal | 2512–2861 | `laneFieldsMenu*`, `showsLaneField`/`showsLaneSection`, orchestrator poll fns 1089–1114, orchestrator prompt 1273–1312, markdown autosave 1313–1457 |
| Delete lane confirm | 2862–2876 | `lanePendingDeletionId`, `pendingLaneTicketCount`, `askToDeleteLane`, `confirmDeleteLane` |

### Cross-region coupling (this is what decides where state lives)
- **Escape chain**: `handleBoardKeydown` (l.722) is a single window listener with a strict priority order: cancel lane drag → close ticket fields menu → close lane fields menu (and refocus its toggle) → close delete ticket confirm → close delete lane confirm → `closeModals()` → lane filter menu → UI demo panel → blur filter input → `router.push('/')`. Child-owned menus have to stay in this order.
- **`anyModalOpen`** (l.194) reads every modal's open flag. It blocks the ⌘⇧F filter shortcut.
- **`closeModals`** (l.696) resets all open flags plus ticket-modal drafts (`checklistDraft`, `linkDraft`, `linkDraftInvalid`, `imageError`).
- **Backdrop press guard**: `notePressTarget` / `closeIfPressStartedOnBackdrop` (l.685) are used by the new ticket, ticket and lane settings modals. They stop a drag that starts inside the modal and ends on the backdrop from closing it, and they ignore `v-edge-resize` presses.
- **Lane markdown autosave**: flushes and commits typed prompts on `openLaneId` change (l.1383) and on BoardView unmount (l.1395). Data-loss path, so it must keep both triggers.
- **Openers live elsewhere**: the lanes board opens the ticket modal, lane settings, auto run confirm and new ticket draft. `TicketGraph` (l.1708) also opens the ticket modal (`graph-ticket-panel` class when `boardView === 'graph'`). The titlebar opens new ticket, new lane and Settings. Board Settings swaps itself for Display (`openDisplaySettings`, "swap, never stack").
- **Shared read-only board data** used by 3+ regions: `board`, `project`, `projectPath`, `laneColumns`, `visibleLanes`, `ticketsInLane`, `agents`, `nextLaneOptionsFor`, `editLane`, `preferences`, `store`, `openInStore`.
- **Naming trap**: `boardSettingsOpen` opens the **Display** modal and `settingsOpen` opens **Board Settings**.

## Design
### Ownership rule
- **BoardView keeps** the route/store wiring, the derived board data (`board`, `laneColumns`, `visibleLanes`, `ticketsInLane`, filter predicates), every modal's **open flag** (`openTicketId`, `openLaneId`, `ticketDraft` presence, `laneDraftName`, `autoRunConfirmLaneId`, `ticketPendingDeletion`, `lanePendingDeletionId`, both settings flags), `anyModalOpen`, `closeModals`, and the one window `keydown` listener.
- **Each child owns** its local UI state: drafts, menus, template refs, timers, and the handlers that only it uses. It is mounted with `v-if` exactly where it is today, so unmounting resets its state the same way `closeModals` does now.
- Children read the store through `useProjectsStore()` / `useOpenInStore()` themselves. Don't prop-drill `store`. Board-derived values that BoardView already computes come in as props, so nothing is computed twice.
- No new Pinia store, no provide/inject unless props pass 3 levels.

### Escape order across components
- A child that owns a menu inside the Escape chain (ticket fields menu in `TicketModal`, lane fields menu in `LaneSettingsModal`) exposes `closeMenuOnEscape(): boolean` via `defineExpose`. It returns `true` when it closed something.
- `handleBoardKeydown` calls these through template refs at the same spot in the chain, then `preventDefault()`s. The order stays exactly as it is now.
- Don't add per-component `keydown` listeners. Relying on listener registration order to set priority is fragile.

### Backdrop guard
- Move `notePressTarget` / `closeIfPressStartedOnBackdrop` into `src/components/board/backdropPress.ts` as a tiny composable (`useBackdropPress()` → `{ notePressTarget, closeIfPressStartedOnBackdrop }`). Each modal gets its own instance, which behaves the same because only one modal with this guard is ever open at a time.

### Shared helpers
- Pure fns used by 2+ new components (`formatDate`, `formatDateTime`, `laneName`, `ipcErrorMessage`, `imageFilesOf`, `isTextFieldPaste`, `trimmedInputValue`) go to `src/components/board/boardFormat.ts`. Fns used by one component move into that component. No helper file for a single caller.

### Lane settings autosave (data-loss path)
- `LaneSettingsModal` owns `laneMarkdownDraft`, `laneMarkdownStatus`, `pendingMarkdownSaves`, `lastSavedMarkdown`, `markdownSaveQueue`, `uncommittedPrompts`.
- Keep a `watch(() => props.lane.id, …)` that does the same flush, commit and reseed as l.1383. Its `onBeforeUnmount` flushes and commits too, which covers both closing the modal and leaving the board.
- `lastSavedMarkdown` / `markdownSaveQueue` must not reset on remount if a save is in flight. If they need to outlive the modal, hoist them to module scope in the component file (`<script>` block, not `<script setup>`) and leave a `// why` comment.

## Components (`src/components/board/`)
| Component | Props in | Emits out | Notes |
|---|---|---|---|
| `BoardTitlebar.vue` | `projectTitle`, `githubUrl`, `pullingIssues` | `new-ticket`, `new-lane`, `open-settings`, `pull-issues` | |
| `BoardFilters.vue` | `laneColumns`, `visibleTicketCount`, `filtersActive` + `v-model`s: `query`, `onlyMine`, `filterLaneIds`, `boardView` | `clear` | Exposes `focus()` for the ⌘⇧F shortcut and the filter input element for the Escape blur check |
| `BoardLanes.vue` | `visibleLanes`, `ticketsInLane`, `laneFilterNarrows`, `selectedTicketIds` | `open-ticket`, `open-lane`, `auto-run`, `new-ticket(laneId)`, `new-lane`, `move-ticket(ticketId, laneId)` | Owns lane resize, lane drag + keyboard reorder, ticket drag + stack ghost, add zone timer. Exposes `cancelLaneDrag()` + `laneDragActive` for Escape. Split out `LaneColumn.vue` only if `BoardLanes` is still over ~500 lines |
| `TicketModal.vue` | `ticket`, `boardView`, `nextLaneOptionsFor` | `close`, `delete(ticket)` | Owns checklist/link/image drafts, fields menu, version + PR edit, agent run. Resets drafts on `ticket.id` change (mirror l.187/642) |
| `NewTicketModal.vue` | `draft` (v-model), `nextLaneOptionsFor` | `close`, `saved` | Owns staged images |
| `LaneSettingsModal.vue` | `lane` | `close`, `delete(lane)` | See autosave above |
| `DisplaySettingsModal.vue` | `laneColumns` | `close` | |
| `BoardSettingsModal.vue` | — | `close`, `open-display`, `open-ui-panel` | Keeps the swap-not-stack rule |
| `ConfirmDeleteModal.vue` | `title`, `message`, `confirmLabel` | `confirm`, `cancel` | Shared by ticket + lane delete. Focuses its Cancel button on mount (today: `deleteConfirmCancelButton` / `laneDeleteConfirmCancelButton`) |
| `AutoRunConfirmModal.vue` | `lane`, `tickets` | `close`, `confirm(payload)` | Owns agent/model/orchestrator/terminal picks and seeds them on mount the way `askToAutoRunLane` does now |
- The new swim lane prompt (11 lines) stays inline in BoardView.
- Optional and zero-risk: rename `boardSettingsOpen` → `displaySettingsOpen` and `settingsOpen` → `boardSettingsOpen` in BoardView. Do it in its own commit.

## Implementation order (one commit per checklist item, typecheck + tests green after each)
1. `boardFormat.ts` + `backdropPress.ts`. Extract `BoardTitlebar` and `BoardFilters`.
2. `BoardLanes` (largest risk: pointer and drag state).
3. `TicketModal` + `NewTicketModal`.
4. `LaneSettingsModal`.
5. `DisplaySettingsModal`, `BoardSettingsModal`, `ConfirmDeleteModal`, `AutoRunConfirmModal`.
6. Measure BoardView. Must be under 600 lines.
7. Run the app on an isolated DB copy and exercise everything (checklist below).

## Acceptance criteria
- `src/views/BoardView.vue` is under 600 lines and only does orchestration: data, open flags, Escape chain, child wiring.
- Rendered DOM unchanged: same elements, classes, `title`s and `aria-*`. CSS in `styles.css` stays untouched.
- `bun run typecheck`, `bun run test`, `bun run build` all clean.
- Every `// why` comment moves with the code it annotates. None dropped.
- No new dependency, no new store.

### Manual exercise checklist (isolated DB, per memory recipe)
- Titlebar: + Ticket, + Swim lane, Pull issues, Settings → Display swap, Settings → UI panel, Open In.
- Filters: type a query, ⌘⇧F focuses it, Escape blurs it and keeps the text, lane filter menu (outside click + focus-out close), only-mine, clear, count, lanes ↔ graph.
- Lanes: resize a column (persists), drag a lane (Escape cancels mid-drag, double-click grace), keyboard lane reorder, drag one ticket, drag a multi-select stack (ghost), drop on lane, add-zone linger, double-click heading → draft, unseen-result badges.
- Ticket modal: every field edit, cancel restores values, checklist add/toggle/drop, external link add (invalid URL flag), images (pick, paste, drop, remove, open), PR refresh + override, version edit (invalid flag), move-to-lane, agent run/resume, fields menu (Escape closes the menu only), delete → confirm (Escape closes the confirm only), backdrop drag-out does not close, open from graph view.
- New ticket: draft + staged images (paste/drop/pick/unstage), next-lane default follows Status, save.
- Lane settings: every field, sections remember open state, fields menu (Escape refocuses its toggle), agent + orchestrator markdown type → autosave → switch lane mid-type → no text bleeds between lanes, close mid-type → saved, poll stepper, delete → confirm.
- Auto Run confirm: agent/model/orchestrator/terminal picks, confirm runs.
- Escape with nothing open → back to projects.

## Out of scope
- Restyling, moving CSS out of `styles.css`, scoped styles
- New features, store redesign, `DashboardView.vue`
- Component unit tests (no Vue test-utils in repo; the current harness is SSR render, see `src/components/InfoTip.test.ts`). Add one only if an extracted pure helper picks up real logic.
