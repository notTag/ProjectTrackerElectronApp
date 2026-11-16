# PRD — Ticket #51: Semantic version field on each ticket

## Context
A ticket has no way to record which release it ships in. The user wants a semantic version (`MAJOR.MINOR.PATCH`) on every ticket, a way to switch the field on and off, and the lane agents (not a fixed rule) deciding when it gets filled in.

## Acceptance criteria
- Add a semantic version number field to each ticket.
- This field should be toggle-able.
- Let the swimlane's agent determine when the field should be filled out.

## Code today (verified 2026-11-12 on `f405122`)
- `Ticket` (`src/shared/projectTypes.ts:276`): optional fields, absent = unset. Closest analogues: `branchName`, `worktreePath` (plain strings)
- Storage: `electron/storage/schema.ts` `ADDED_COLUMNS` adds columns to older DBs on open. `stateRepository.ts` maps rows ↔ objects and upserts only changed fields, so outside `sqlite3` writes survive
- Agent prompt: `ticketMetadataLines` (`projectTypes.ts:456`) prints one line per set field; `ticketAgentPrompt` (`:501`) joins lane prompt → ticket metadata → description → full auto → output
- Per-lane checkbox pattern: `lane.fullAuto` in the lane cog modal (`BoardView.vue:1555`)
- Card show/hide pattern: `TICKET_CARD_FIELDS` (`projectTypes.ts:1052`) + board settings modal; `knownCardFields` makes a newly added field start shown
- DB path constant: `TRACKER_DATABASE_PATH` (`projectTypes.ts:643`)

## Decisions (defaults, no blockers)
- D1. "Toggle-able" means two switches, both following existing patterns:
  - Card display: new `version` entry in `TICKET_CARD_FIELDS`, toggled in board settings like Branch/Worktree
  - Agent filling: new per-lane checkbox "Agent sets semantic version" (`SwimLane.agentSetsVersion`), default off
- D2. The ticket modal always shows the field, so a person can set or clear it by hand in any lane
- D3. The lane agent decides *when* (AC3). The app only tells the agent, in lanes with the toggle on, that it may set the field and how. No rule in code about which lane or event fills it
- D4. Format: SemVer 2.0 `MAJOR.MINOR.PATCH` with optional `-prerelease` / `+build`. Leading `v` stripped on save. Validated in the modal; empty clears the field (`undefined` / `NULL`)
- D5. Agents write it with `sqlite3`, same as lane moves today (the app already refreshes on outside writes). Values written by an agent are not re-validated; the card shows whatever is stored

## Requirements
- R1. Types (`src/shared/projectTypes.ts`):
  - `Ticket.version?: string`
  - `SwimLane.agentSetsVersion?: boolean`
  - `{ id: 'version', label: 'Semantic version' }` appended to `TICKET_CARD_FIELDS` (append, never rename — ids are persisted)
  - Pure helper `normalizeSemanticVersion(input: string): string | undefined | null` → trimmed value without leading `v`; `undefined` for empty; `null` for invalid. One regex constant, the official SemVer one
- R2. Storage:
  - `ADDED_COLUMNS`: `{ table: 'tickets', column: 'version', definition: 'TEXT' }`, `{ table: 'swim_lanes', column: 'agent_sets_version', definition: 'INTEGER NOT NULL DEFAULT 0' }`
  - Add both to `SCHEMA_SQL` `CREATE TABLE` bodies too (matches how `orchestrator_prompt` was done)
  - `stateRepository.ts`: column lists, `excluded.` updates, row mapping, normalize defaults — mirror `worktree_path` (ticket) and `full_auto` (lane)
- R3. UI (`src/views/BoardView.vue`):
  - Ticket modal: text input "Version" near Branch / Worktree, placeholder `1.4.0`. On change: `normalizeSemanticVersion` → `editTicket(..., { version })`; invalid → inline error, value not saved
  - Card: when `showsField('version')` and `ticket.version` is set, show `v<version>` in the same chip style as branch
  - Lane cog modal: checkbox "Agent sets semantic version" below Full auto, helper text: "This lane's agent decides whether the ticket needs a version and writes it."
- R4. Agent prompt:
  - `ticketMetadataLines`: `Version: <version>` after `Worktree:` when set (any lane, toggle or not — it's ticket context)
  - `ticketAgentPrompt`: when `lane.agentSetsVersion`, add a section after the description:
    ```
    Semantic version: you decide whether this ticket's work needs a version and what it is (MAJOR.MINOR.PATCH). Leave it unset if it doesn't apply yet. To set or change it:
    sqlite3 "<TRACKER_DATABASE_PATH>" "UPDATE tickets SET version = '<X.Y.Z>', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_path = '<project path>' AND number = <N>;"
    ```
  - Needs the project path: add `projectPath?: string` to `TicketPromptContext`, passed where the prompt is built. Omit the SQL line (keep the sentence) if absent
- R5. Docs: `feature-map.md` — ticket modal "Version" entry, lane cog "Agent sets semantic version", card field
- R6. Tests:
  - `projectTypes.test.ts`: `normalizeSemanticVersion` (valid, `v` prefix, prerelease/build, empty, invalid like `1.2`, `1.2.3.4`, `01.2.3`); `Version:` line present only when set; version section present only when `agentSetsVersion`; prompt unchanged otherwise
  - `stateRepository.test.ts`: `version` and `agent_sets_version` round-trip; older DB migrates to `NULL` / `0`
  - Board preferences: saved prefs without `version` in `knownCardFields` get it shown

## Out of scope
- Auto-bumping, version ranges, or comparing/sorting tickets by version
- Board-wide or project-level "current version"
- Pulling versions from `package.json`, git tags, or GitHub releases
- Exposing version through GitHub issue sync
- Filtering the board by version

## Risks
- Agents write the DB directly; a typo'd value shows as-is. Fixable by hand in the modal
- Prompt gets longer in lanes with the toggle on — only those lanes

## Open questions
None. Defaults above (D1 interpretation of "toggle-able" is the main call; easy to drop one of the two switches in review).

## Branch / worktree
- Branch: `t51-add-a-semantic`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t51`
