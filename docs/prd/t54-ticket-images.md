# PRD — Ticket #54: Attach images to tickets

## Context
Original ask: "If an image has been attached to a ticket then that image will be passed to the agent (we can attach a path name to the agent prompt)."

Agents (Claude Code, Codex) read local image files by path, so the prompt only needs absolute paths. The work is: store images somewhere stable, show them on the ticket, list them in the prompt.

## Acceptance criteria
- [ ] Ticket detail has an **Images** section: thumbnails, an **Add image** button (native file picker, png/jpg/jpeg/gif/webp), paste from clipboard (Cmd+V while the ticket panel is focused), and drag-and-drop onto the section.
- [ ] Each thumbnail has a remove (×) button; clicking a thumbnail opens the file in the OS viewer (`shell.openPath`).
- [ ] Attached images are copied into app storage, so moving/deleting the original does not break the ticket.
- [ ] `ticketAgentPrompt` includes, when images exist:
      `Images (open each path to view it):` followed by `- /abs/path.png` lines.
- [ ] Ticket with no images → prompt unchanged (no empty section).
- [ ] Deleting a ticket deletes its image folder.
- [ ] Thumbnails render in dev (Vite http origin) and packaged (file://).

## Code today (verified 2026-11-15 on `84e6a72`)
- `Ticket` (`src/shared/projectTypes.ts:316`) — optional fields, each persisted as a column; `externalLinks?: string[]` → `external_links_json` is the closest analog.
- Prompt metadata: `ticketMetadataLines` (`src/shared/projectTypes.ts:548`) already emits `Links:` / `Checklist:` blocks. Add an `Images` block the same way.
- Schema: `electron/storage/schema.ts:105` table + `:158` added-columns list (migration = append a `{ table, column, definition }` entry). Row mapping `electron/storage/stateRepository.ts:149` / `:217`, insert/update SQL `:919` / `:933`.
- IPC write allowlist: `TICKET_PATCH_FIELDS` (`electron/main.ts:253`) — typed `Record<keyof TicketWritePatch, true>`, so a missing key fails typecheck.
- File picker precedent: `dialog:pick-scan-directory` (`electron/main.ts:557`) + preload `pickScanDirectory` (`electron/preload.cts:59`).
- Ticket delete: `stateRepository.deleteTicket` (`electron/storage/stateRepository.ts:511`), called from `electron/main.ts:495`.
- UI analog: External Links section (`src/views/BoardView.vue:1439`).
- CSP (`index.html:6`) has `img-src 'self' data: file:`. Dev loads the renderer from the Vite http origin, where Chromium refuses `file://` images → need a custom scheme.

## Design
### Storage
- Dir: `<userData>/attachments/<ticketId>/<randomUUID><ext>` (`app.getPath('userData')`, respects `PROJECT_TRACKER_USER_DATA` → evals/tests isolated).
- Not in the repo: images are working notes, not source; worktrees would otherwise each need a copy.
- Ticket field: `images?: string[]` — absolute paths, column `images_json TEXT`. Absent = none.

### Main process (new `electron/ticketImages.ts`)
- `addTicketImages(ticketId, sourcePaths)` → copies each file, returns new paths. Validates ext against allowlist; rejects > 20 MB.
- `saveTicketImageBytes(ticketId, bytes, mimeType)` → for paste/drop of clipboard data with no file path.
- `removeTicketImage(ticketId, path)` → must resolve inside `<userData>/attachments/<ticketId>/` (path traversal guard), then `rm`.
- `removeTicketImages(ticketId)` → `rm -rf` the ticket dir; call from `deleteTicket` path in `main.ts`.
- IPC: `ticket-images:pick` (opens dialog, copies, returns paths), `ticket-images:save-bytes`, `ticket-images:remove`, `ticket-images:open` (`shell.openPath`, same inside-dir guard). All behind `assertTrustedSender`.

### Showing thumbnails
- `protocol.registerSchemesAsPrivileged` + `protocol.handle('ticket-image', …)` → `net.fetch(pathToFileURL(resolved))`, only for paths inside `<userData>/attachments/`; anything else 404.
- CSP: add `ticket-image:` to `img-src`.
- Renderer src: `ticket-image://local/<encodeURIComponent(path)>`.

### Prompt
- In `ticketMetadataLines`, after `Links:`:
  `Images (open each path to view it):\n- <path>` per image. Plain paths, no markdown, so any CLI agent can open them.

### Ticket write
- Renderer updates `images` through the existing ticket save (`TICKET_PATCH_FIELDS.images = true`). Files are written before the patch and removed after it, so a crash leaves at worst an orphan file, never a path to a missing file.

## Implementation steps
1. `Ticket.images`, schema column + added-columns entry, row mapping, insert/update SQL, `TICKET_PATCH_FIELDS`.
2. `electron/ticketImages.ts` + IPC handlers + preload methods + `projectTrackerApi` wrappers.
3. `ticket-image:` protocol + CSP.
4. `BoardView.vue` Images section (button, paste, drop, thumbnails, remove, open).
5. `ticketMetadataLines` Images block.
6. Delete-ticket cleanup.

## Test plan
- `projectTypes.test.ts`: prompt with 2 images lists both paths under the Images header; prompt without images has no `Images` line.
- `ticketImages.test.ts`: copy into temp userData; ext rejection; remove refuses a path outside the ticket dir; `removeTicketImages` deletes the dir.
- `stateRepository.test.ts`: `images` round-trips; older DB without `images_json` migrates.
- Manual (run-app-before-merge, isolated DB copy): add via picker, paste screenshot, drag file, remove, open; Run agent → prompt shows paths and agent describes the image; delete ticket → dir gone.

## Out of scope
- Images for GitHub-imported tickets (issue body images stay links).
- Image editing, cropping, annotations.
- Embedding images inline in the description markdown.
- Syncing images across machines.

## Decisions (defaults, no blockers)
- Store copies in userData, not references to originals and not in the repo.
- Absolute paths in prompt (agent cwd may be a worktree, so relative paths would break).
- Size cap 20 MB per image; image types only (png, jpg, jpeg, gif, webp).
- Custom `ticket-image:` scheme over data URLs: no base64 bloat in renderer state.

## Branch / worktree
- Branch: `t54-add-the-ability` (at `84e6a72`, latest main merge)
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t54`

## Open questions
None.


## PRD file
- `docs/prd/t54-ticket-images.md` on branch `t54-add-the-ability` (worktree `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t54`)
