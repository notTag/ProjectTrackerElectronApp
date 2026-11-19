# PRD: #112 List prompt variables in the Agent / Orchestrator prompt ⓘ tips

## Why a PRD
- Small change, but it sits on top of #102 (PR #144, open). It touches 3 files plus a test, and has one trap: Vue interpolating `{{…}}`. This doc pins the dependency, the exact tip strings and the CSS change.

## Problem
- The lane modal's ⓘ tips (from #102) say what each prompt is for, but not which `{{variables}}` it accepts.
- Orchestrator prompt: 4 tokens are filled at launch. Their names show in the field-hint under the textarea, but not what they mean.
- Agent prompt: takes no tokens. It is sent verbatim (`ticketAgentPrompt`, `src/shared/projectTypes.ts:674`). Nothing says so, so a user might type `{{tickets}}` there and the agent would get it literally.

## Verified current state (2026-11-19)
- `ORCHESTRATOR_PROMPT_TOKENS` at `src/shared/projectTypes.ts:1119`: `tickets`, `ticketNumbers` (`{{ticket_numbers}}`), `lanes`, `terminal`.
- `InfoTip.vue` is on `origin/t102-add-an-information` only. It is not on `main` or this branch. Its props are `{ text: string }`.
- #102's BoardView tips use static `text="…"` attributes:
  - Agent prompt: "Instructions sent to the agent when a ticket enters this lane. Autosaves to SwimlaneAgentPrompt/<lane>/ as markdown."
  - Orchestrator prompt: "Instructions for this lane's orchestrator session, which dispatches and monitors ticket agents. Leave empty to use the generated default template."
- #102 `.info-tip-bubble` sets `white-space: normal` and `max-width: min(280px, 70vw)`. This ticket must replace `normal` with `pre-line`; adding a second rule isn't enough.

## Acceptance criteria
- AC1: The orchestrator tip ends with a `Variables:` block, one line per token with its meaning. `{{tickets}}` and `{{ticket_numbers}}` are marked required.
- AC2: The block is built from `ORCHESTRATOR_PROMPT_TOKENS`, so a new token shows up in the tip. A token with no meaning still gets its line.
- AC3: The agent tip ends with: "No {{variables}}: this text is sent as typed; ticket details are added automatically."
- AC4: `{{…}}` shows literally. Use a bound `:text` with a JS string expression; no mustache in template text.
- AC5: The text wraps within the existing max-width, and `\n` line breaks show (`white-space: pre-line`).
- AC6: Unchanged: the "Missing …" warning, the field-hint (`v-pre`) and Reset to default.
- AC7: `bun run test`, typecheck and build pass. A new test checks that the orchestrator help contains every `ORCHESTRATOR_PROMPT_TOKENS` value and marks both required tokens.

## Design
- `projectTypes.ts`, next to the tokens:
  ```ts
  const ORCHESTRATOR_TOKEN_MEANINGS: Record<keyof typeof ORCHESTRATOR_PROMPT_TOKENS, string> = {
    tickets: 'one line per launched ticket: number, title, tab, branch, handoff tabs (required)',
    ticketNumbers: 'comma-separated ticket numbers, e.g. for SQL IN (…) (required)',
    lanes: 'board lanes: id — name — agent work yes/no',
    terminal: "the lane's Auto Run terminal tab section (list/close recipes)"
  }

  export const orchestratorPromptTokenHelp = (): string => {
    const tokenKeys = Object.keys(ORCHESTRATOR_PROMPT_TOKENS) as (keyof typeof ORCHESTRATOR_PROMPT_TOKENS)[]
    const tokenLines = tokenKeys.map((key) => `${ORCHESTRATOR_PROMPT_TOKENS[key]}: ${ORCHESTRATOR_TOKEN_MEANINGS[key]}`)
    return ['Variables:', ...tokenLines].join('\n')
  }
  ```
  - The `Record<keyof …>` type makes a new token a typecheck error until it has a meaning. That's stronger than AC2's fallback, so no fallback code is needed.
  - "Required" is written into the meaning text. Reuse an existing required-token list in BoardView if one exists; otherwise the text is enough.
- `BoardView.vue`: expose `orchestratorPromptTokenHelp` to the template (import it) and change both tips to bound strings:
  - Orchestrator: `` :text="`Instructions for … default template.\n\n${orchestratorPromptTokenHelp()}`" ``. A computed or const in `<script setup>` is cleaner than a long inline template literal, so prefer a `const orchestratorPromptTip = …`.
  - Agent: `const agentPromptTip = '… as markdown.\n\nNo {{variables}}: this text is sent as typed; ticket details are added automatically.'`
- `styles.css`: `.info-tip-bubble { white-space: pre-line; }`, replacing #102's `white-space: normal`. The other tips are single-line, so they look the same.
- `feature-map.md`: add a line to the lane modal / InfoTip section about the variable lists.

## Decisions
- D1: Blocked on PR #144. Rebase onto `main` once it merges; if it's still open when development starts, rebase onto `origin/t102-add-an-information` and retarget later.
- D2: The agent tip says "no variables". Real agent tokens are out of scope.
- D3: The meanings live next to the tokens in `projectTypes.ts`: one place, testable.
- D4: Keep the field-hint as is.
- D5: `pre-line` over one element per line: no InfoTip API change.

## Test
- `projectTypes.test.ts`: every value of `ORCHESTRATOR_PROMPT_TOKENS` is in `orchestratorPromptTokenHelp()`, the help starts with `Variables:`, and the `{{tickets}}` and `{{ticket_numbers}}` lines contain `required`.
- Manual (per memory "run app before merge"): isolated DB copy, open the lane modal, hover/focus both ⓘ. Check the line breaks, the literal `{{…}}`, the wrapping at 280px, and that Escape still dismisses the tip and then the modal.

## Out of scope
- Agent-prompt token support, changes to the token set, the required-token warning, tips on other fields.

## Open questions
- None.

## Work location
- Branch: `t112-create-add-update`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t112`
