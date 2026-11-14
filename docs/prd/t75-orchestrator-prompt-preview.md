# PRD — Ticket #75: Orchestrator agent prompt

Branch: `t75-orchestrator-agent-prompt`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t75`

## Summary
Show the Auto Run orchestrator prompt the app generates in each lane's cog modal, and let the user edit all of it. Today the "Orchestrator prompt" section only holds an extras textarea (empty by default), so it looks blank and the user can't see or change what the orchestrator is told.

## PRD needed?
Yes. The prompt is rebuilt per launch (selected tickets, board lanes, terminal), so a fully editable prompt needs a template with launch-time tokens, a new lane field, and a migration story for existing extras. Lanes the user never edits must keep today's prompt byte-for-byte.

## Context (verified 2026-11-14 on `4d800ca`)
- Generated prompt: `orchestratorPrompt(lane, entries, context)` in `src/shared/projectTypes.ts:811`
  - Launch-varying parts: `ticketLines` (`- #N title — tab "…" — branch …`), `ticketNumbers` (SQL `IN (…)`), `laneLines` (board lanes), `tabSection(context)` (terminal recipes, `:779`)
  - `AutoRunLaunchEntry` (`:686`) = `{ ticket, launch }`, `launch.number: number`
  - Context: `OrchestratorPromptContext` (`:769`) = `projectPath`, `lanes`, `terminalId`, `terminalLabel`
  - Extras: `laneInstructionsSection` (`:803`) appends `Lane instructions` when `lane.orchestratorPrompt` is set
  - Used only by `buildOrchestratorLaunch` (`:868`)
- Launch call: `confirmAutoRunLane` in `src/views/BoardView.vue` (~`:884`) builds the context inline and calls `buildOrchestratorLaunch`
- Lane terminal: `autoRunTerminal(lane)` (`BoardView.vue:835`) → `OpenInTarget` (`id`, `label`)
- Cog modal: `BoardView.vue` ~`:1699-1708`, "Orchestrator prompt" textarea bound to `lane.orchestratorPrompt` (`@change` → `editLane`) + hint
- Storage of `orchestratorPrompt` (#50, see `docs/prd/t50-orchestrator-prompt.md` R1-R2): `SwimLane` field, `ADDED_COLUMNS` entry in `electron/storage/schema.ts`, column in `electron/storage/stateRepository.ts` (upsert, row mapping, `normalizeLane` default)
- Live data: the In Development lane already has extras that clash with the base prompt ("raise it or solve it" vs "never answer or message the ticket agents"). Full editing lets the user resolve that

## Decisions
- D1. Fully editable (option C, chosen by user 2026-11-14). The user's text replaces the whole generated prompt. No locked lines; the report-only rules can be deleted. That is the user's call
- D2. Template tokens for launch-varying parts, filled at every launch:
  - `{{tickets}}` → ticket lines, one per launched ticket
  - `{{ticket_numbers}}` → comma-separated numbers (inside the SQL `IN (…)`)
  - `{{lanes}}` → board lane lines (`- id — name — agent work: yes|no`)
  - `{{terminal}}` → the whole tab section for the lane's Auto Run terminal (list/close recipes, or the "cannot be queried" text)
  - Project path, lane name and lane id are written in plainly; they don't change between launches. Unknown `{{…}}` is left as typed
- D3. New field, not a reuse. `SwimLane.orchestratorPromptOverride?: string`, column `orchestrator_prompt_override TEXT NOT NULL DEFAULT ''`. Empty = use the generated prompt, exactly as today
- D4. One textarea. The section shows `override || defaultTemplate(lane, context)`, where the default template is today's prompt with the four tokens in place, existing `Lane instructions` included. The extras textarea goes away; its text is visible and editable inside the full prompt
- D5. Save rule (on `@change`):
  - text trimmed equals the default template trimmed → `editLane(lane, { orchestratorPromptOverride: '' })` (stays on generated, no fork)
  - otherwise → `editLane(lane, { orchestratorPromptOverride: text, orchestratorPrompt: '' })` in one call. Extras move into the override so they aren't stored twice
- D6. "Reset to default" button, shown only when an override is set → `orchestratorPromptOverride: ''`. Reset gives the pure app default (old extras were folded into the override and are gone). No confirm dialog; the text before reset is not kept
- D7. Missing-token hint: under the textarea, list the four tokens. When an override lacks `{{tickets}}` or `{{ticket_numbers}}`, show a non-blocking warning ("The orchestrator won't know which tickets to watch"). Launch still runs
- D8. Same code path. The default template and real launches both come from one internal renderer, so the preview can't drift

## Requirements
- R1. `src/shared/projectTypes.ts`
  - `SwimLane.orchestratorPromptOverride?: string`
  - Token constants: `ORCHESTRATOR_PROMPT_TOKENS = { tickets: '{{tickets}}', ticketNumbers: '{{ticket_numbers}}', lanes: '{{lanes}}', terminal: '{{terminal}}' }`
  - Extract internal `renderOrchestratorPrompt(lane, parts, context)` where `parts = { tickets, ticketNumbers, lanes, terminal }` (strings). Today's body, with those four spots taking `parts.*`
  - `orchestratorPromptParts(entries, context)` → real strings (today's `ticketLines.join('\n')`, `ticketNumbers`, `laneLines.join('\n')`, `tabSection(context)`)
  - Export `orchestratorPromptTemplate(lane, context)` = `renderOrchestratorPrompt(lane, tokens, context)` (the default template)
  - `orchestratorPrompt(lane, entries, context)`, same signature:
    - override empty/whitespace → `renderOrchestratorPrompt(lane, orchestratorPromptParts(entries, context), context)`, output identical to today
    - override set → fill each token in the override with `replaceAll` from `orchestratorPromptParts`
  - Export `orchestratorPromptMissingTokens(text): string[]` (only `{{tickets}}`, `{{ticket_numbers}}`) for D7
- R2. Storage, mirroring `orchestrator_prompt` everywhere it appears (`git grep orchestrator_prompt electron/`):
  - `ADDED_COLUMNS` entry `{ table: 'swim_lanes', column: 'orchestrator_prompt_override', definition: "TEXT NOT NULL DEFAULT ''" }` in `electron/storage/schema.ts`
  - `stateRepository.ts`: upsert/update column lists, row mapping, `normalizeLane` default `?? ''`
- R3. `src/views/BoardView.vue`
  - Extract `orchestratorContextFor(terminal: OpenInTarget): OrchestratorPromptContext`; use it in `confirmAutoRunLane` instead of the inline object
  - Computed `openLaneOrchestratorTemplate` = `orchestratorPromptTemplate(openLane, orchestratorContextFor(autoRunTerminal(openLane)))`
  - Replace the extras textarea with one monospace textarea (`white-space: pre`, tall, scrollable): `:value="openLane.orchestratorPromptOverride || openLaneOrchestratorTemplate"`, `@change` per D5
  - Reset button (D6), token hint + missing-token warning (D7)
  - New hint text: "Sent to the Auto Run orchestrator (runs when 2+ tickets auto-run). {{tickets}}, {{ticket_numbers}}, {{lanes}}, {{terminal}} are filled in at launch."
- R4. Tests
  - `src/shared/projectTypes.test.ts`:
    - existing `orchestratorPrompt` tests untouched and passing (no override = same bytes)
    - `orchestratorPromptTemplate` contains lane name/id and all four tokens; contains `Lane instructions` + extras when set
    - override: tokens filled with real ticket lines, numbers, lanes, terminal recipe; no `{{` left for known tokens; unknown `{{foo}}` kept; whitespace-only override = generated
    - filling the unedited template gives the same text as the generated prompt for the same entries (D8 guard)
    - `orchestratorPromptMissingTokens` reports only the missing ones
  - `electron/storage/stateRepository.test.ts`: override round-trips; old rows load as `''`

## Acceptance criteria
- [ ] Every lane's cog modal (unassigned included) shows the full orchestrator prompt in one editable textarea
- [ ] Unedited lanes show the generated prompt with tokens, built from the same renderer as launch
- [ ] Unedited lanes launch with a byte-for-byte identical prompt (existing tests pass unmodified)
- [ ] Editing and leaving the textarea saves the whole text as the lane's prompt; the next Auto Run sends it with tokens filled
- [ ] Existing extras appear inside the shown prompt and are kept when the user first edits it
- [ ] "Reset to default" returns the lane to the generated prompt
- [ ] Removing `{{tickets}}` or `{{ticket_numbers}}` shows a warning but does not block
- [ ] Changing the lane's Auto Run terminal changes the `{{terminal}}` output at launch, also for edited prompts
- [ ] `bun run test` and typecheck pass

## Out of scope
- Version history of edited prompts beyond Reset
- Editing the per-ticket agent prompt
- Previewing with the actually selected tickets
- Orchestrator behavior, agent/model pickers (#47, #72)

## Known limits
- Lane name, lane id and project path are typed into an edited prompt; renaming the lane won't update it. Reset to pick up the new name
- App updates to the default prompt don't reach lanes with an override. Reset to pick them up

## Open questions
None. User chose C (fully editable) on 2026-11-14; defaults above.
