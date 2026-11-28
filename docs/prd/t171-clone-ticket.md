# t171 — Clone a ticket

Source: https://github.com/notTag/ProjectTrackerElectronApp/issues/189
Branch: `t171-add-the-ability` · Worktree: `.worktrees/t171`

## Ask
- Clone button, top right corner of the open-ticket modal
- Clone keeps the original's metadata; only the title changes → `CLONE OF T#<N> <TICKET_TITLE>`
- Original ticket's modal closes, clone's modal opens

## Where it lives today
- Modal header: `src/components/board/TicketModal.vue:373` `.ticket-modal-header` → eyebrow, fields menu (`EyeOffIcon`), `ExpandToggle` (last item = top right)
- Modal emits `close` / `delete` (`TicketModal.vue:58`); `BoardView.vue:511` owns `openTicketId` (`:74`)
- Create path: `store.addTicket` (`src/stores/projects.ts:511`) → `addTicketToBoard` (`src/shared/projectTypes.ts:1757`) — numbers via `nextTicketNumber(board)` inside the `updateBoard` mutate, so numbering stays race-safe
- Ticket shape: `Ticket` interface (`projectTypes.ts:326`)
- Images: absolute paths under `<userData>/attachments/<ticketId>/`; deleting a ticket removes that dir (`electron/ipcHandlers.ts:437`) → clone must own copies, not share paths

## Design
- Pure fn `cloneTicketOnBoard(board, sourceId, newId)` in `projectTypes.ts` next to `addTicketToBoard`: new id, `nextTicketNumber`, `createdAt` now, title `CLONE OF T#${source.number} ${source.title.trim()}`, appended to the same lane
- Store `cloneTicket(projectPath, ticketId): Promise<string | null>` → `updateBoard(...)` with the fn above, then copies images
- Modal: `CopyIcon` `icon-button` after `ExpandToggle` (rightmost), `title`/`aria-label` "Clone ticket"; emits `clone: [ticket]`
- BoardView `@clone` → `const cloneId = await store.cloneTicket(...)`; on success `openTicketId.value = cloneId` (swaps modal: original closes, clone opens); on failure keep original open + error banner
- Images: new IPC `ticket-images:copy` `{ toTicketId, imagePaths }` → each path through `resolveAttachmentPath` (must sit under attachmentsRoot) → `addTicketImages(attachmentsRoot, toTicketId, resolved)`; store patches clone's `images` with returned paths. Copy fails → clone still saved, image error shown on the clone (same pattern as `newTicketImageError`)

## Field rules
- Copied: `laneId`, `description`, `labels`, `assigneeId`, `checklist` (items + done state, deep copy), `agentId`, `model`, `fullAuto`, `externalLinks`, `moveToLaneId`, `moveRules`, `version`, `images` (as copies)
- Reset — identity: `id`, `number`, `createdAt`, `updatedAt`
- Reset — the original's work, sharing would make two agents collide on one branch/worktree/PR: `branchName`, `worktreePath`, `pullRequestUrl`, `pullRequestState`, `pullRequestMergedAt`, `agentRun`
- Reset — per-ticket lane state: `moveRulesPassedLaneId`, `readyLaneId`, `moveOnComplete` → `false` (arming is opt-in per ticket; a clone never auto-moves unless the user arms it)
- `externalId` dropped (GitHub dedupe key — a copy would make re-pull update the clone instead of the original); `externalUrl` kept so the issue link still shows [~75% confidence the card/modal render `externalUrl` without `externalId` — verify in dev; if not, fold it into `externalLinks`]

## Assumptions
- "Original ticket will close" = its modal closes; the original ticket stays in its lane, untouched [~85% confidence — reading is symmetric with "new one will open"]
- Clone of a clone stacks literally: `CLONE OF T#205 CLONE OF T#171 ...`
- Button shows in lanes and graph views (unlike `ExpandToggle`, which hides in graph)
- No confirm dialog — cloning is non-destructive, delete undoes it

## Acceptance criteria
- Clone button is the rightmost control in the open-ticket modal header
- Click → new ticket, next number, same lane, title `CLONE OF T#<N> <title>`, copied fields per rules above
- Original modal closes, clone modal opens on the new ticket
- Original ticket unchanged (lane, fields, `updatedAt`)
- Clone's images are separate files; deleting the original leaves clone images intact
- `projectTypes.test.ts`: `cloneTicketOnBoard` title, number, copied vs reset fields, checklist deep copy (mutating clone's checklist leaves source alone)
- `ticketImages.test.ts`: copy path rejects paths outside attachmentsRoot
- `feature-map.md` ticket modal section notes the Clone button
- `bun run test` + typecheck pass; manual run on isolated DB copy

## Out of scope
- Bulk clone of selected cards
- Cloning into a different lane or project
- Keyboard shortcut
