# PRD — Ticket #35: External Links section

Branch: `t35-add-an-external`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t35`
Labels: feature, ticket-modal, storage

## Problem

A ticket can hold two links today: `externalUrl` (set only by GitHub import) and
`pullRequestUrl`. Design docs, Figma files, Slack threads and related issues end up
pasted into the description, where they are hard to find and don't open in one click.

## Goal

Add an "External Links" section to the ticket modal. A ticket can carry any number
of http(s) links. Each one opens in the default browser and can be removed. Links
persist in SQLite and are passed to agents in the ticket prompt.

## Non-goals

- Link titles, labels or favicon previews (show the URL text only)
- Editing a link in place (remove it and add it again)
- Reordering links
- Showing links on the board card or as a card display field
- Merging `externalUrl` or `pullRequestUrl` into this list
- Exposing links through GitHub sync or the external API

## Design

Follow the Checklist pattern end to end. Every layer below already has a checklist
counterpart to copy.

### 1. Type (`src/shared/projectTypes.ts`)

- `Ticket.externalLinks?: string[]`. Absent means no links. Old rows need no migration.

### 2. Pure helpers (`src/shared/projectTypes.ts`, next to `addChecklistItem`)

```ts
addExternalLink(links: string[] = [], url: string): string[]
removeExternalLink(links: string[] = [], index: number): string[]
```

- `addExternalLink` trims `url`. If the trimmed value fails `isWebUrl` or is already
  in `links` (exact string match), it returns `links` unchanged. Otherwise it returns
  `[...links, trimmed]`.
- `removeExternalLink` mirrors `removeChecklistItem` (filter by index).
- The UI tells "invalid" from "added" by comparing lengths, or by checking `isWebUrl`
  first. No extra result type is needed.

### 3. Storage

`electron/storage/schema.ts`
- Add `external_links_json TEXT` to the `tickets` CREATE TABLE.
- Add `{ table: 'tickets', column: 'external_links_json', definition: 'TEXT' }` to
  `ADDED_COLUMNS` so existing databases gain the column on open.

`electron/storage/stateRepository.ts`
- Row → ticket: `externalLinks: parseJson<Ticket['externalLinks']>(row.external_links_json, undefined)`
- `ticketValues`: append `jsonOrNull(ticket.externalLinks)` after `pullRequestUrl`.
- `insertTicketRow` / `updateTicketRow`: append `external_links_json` to the column
  lists. The values are positional and `id` is spread last, so the new column must sit
  directly before `id` in both statements, and the `?` count goes from 17 to 18.
- The baseline diff in `saveState` compares whole tickets, so a changed links array
  triggers an update without any extra code.

### 4. UI (`src/views/BoardView.vue`, ticket modal)

Place the section after "GitHub PR" and before "Checklist". Copy the Checklist block
(~L824), including its `checklistDraft` ref and its `editTicket` patch call.

- Heading: "External Links"
- List of saved links, each with:
  - `<a :href="link" target="_blank" rel="noreferrer">{{ link }}</a>`. Clicking it
    opens the default browser through the existing `setWindowOpenHandler` →
    `shell.openExternal` path in `electron/main.ts`. No main-process change is needed.
  - A × button that patches `externalLinks: removeExternalLink(links, index)`
- Below the list: a text input (`linkDraft` ref) with an "Add" button to its right.
  - Enter or Add → `addExternalLink`. On success: patch the ticket, clear the input
    and keep focus on it, so the next link can be typed right away. This is the
    "new input box below" from the request: the list grows above a fresh empty input.
  - On an invalid URL: don't patch, keep the text, and show the inline hint
    "Use an http(s) URL". Clear the hint on the next keystroke.
  - On a duplicate: don't patch, and clear the input (the link is already listed).
  - Empty or whitespace-only input: do nothing, no hint.
- Long URLs wrap or truncate with ellipsis. The full URL goes in `title`.

### 5. Agent prompt (`ticketMetadataLines`)

After the `Source:` line and before `Checklist:`, add this when `externalLinks` is non-empty:

```
Links:
- https://…
- https://…
```

Use the same `- ` bullet shape as the checklist block. Omit the block when there are no links.

### 6. Docs

- `feature-map.md`, ticket modal section: add an "External Links" entry (what it
  stores, where it shows, that it goes to the agent prompt).

## Acceptance criteria

- [ ] Ticket modal shows an "External Links" section between GitHub PR and Checklist
- [ ] The section has a text input with an "Add" button to its right
- [ ] Adding a link puts it in the list above, clears the input and keeps focus
- [ ] Enter adds the same way the button does
- [ ] Non-http(s) input is rejected and shows "Use an http(s) URL"
- [ ] Duplicates and whitespace-only input are not added
- [ ] Each saved link opens in the default browser
- [ ] Each saved link can be removed with ×
- [ ] Links persist across app restarts (`external_links_json`)
- [ ] A database created before this change opens fine, and its tickets have no links
- [ ] The agent prompt includes a `Links:` block only when the ticket has links
- [ ] `feature-map.md` documents the section
- [ ] `bun run test` passes

## Tests

`src/shared/projectTypes.test.ts`
- `addExternalLink`: trims whitespace, rejects `ftp://` / `javascript:` / plain
  text, skips duplicates, appends a valid link, and treats `undefined` as `[]`
- `removeExternalLink`: removes by index and leaves the rest in order
- `ticketAgentPrompt`: contains `Links:` and each URL when links are set, and has no
  `Links:` when they are absent or empty

`electron/storage/stateRepository.test.ts`
- `externalLinks` round-trips through save → load
- An older database without `external_links_json` loads, gains the column, and its
  tickets come back with `externalLinks` undefined

## Risks / notes

- Positional SQL parameters: forgetting to append to both statements and to
  `ticketValues` shifts every later column. The round-trip test catches this.
- `isWebUrl` only checks the `http(s)://` prefix. That is enough here, because
  `shell.openExternal` is gated by the same check in `main.ts`.

## Open questions

None. The ticket fixes placement, validation, persistence and scope.
