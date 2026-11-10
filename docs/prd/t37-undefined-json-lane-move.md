# PRD — Ticket #37: `"undefined" is not valid JSON` on Idea → In Development

## Problem
Moving a ticket Idea → In Development (PRD lane skipped, no agent run yet) shows an error about undefined JSON.

## Root cause (verified against `origin/main` @ 03d1f8e)
- Every `JSON.parse` in the app goes through one of three identical copies of `toPlainJson = (v) => JSON.parse(JSON.stringify(v))`, or `parseJson` in `electron/storage/stateRepository.ts:58` (already guarded, returns its fallback).
- `JSON.stringify(undefined)` returns `undefined`; `JSON.parse(undefined)` throws `SyntaxError: "undefined" is not valid JSON`.
- `electron/preload.cts:12` `invokePlain` runs `toPlainJson(result)` on every IPC result. Any handler that resolves `undefined` therefore rejects in the renderer.
- Confirmed void handler routed through `invokePlain` today: `theme:set-native` (`electron/main.ts:344`, called from `src/App.vue:36` → `setNativeTheme`). It rejects on every call. `page-find:*` use raw `ipcRenderer.invoke` and are unaffected.
- `ticket.agentRun` absent is already safe on the read side: `parseJson(row.agent_run_json, undefined)`.
- Not confirmed statically: which call in the lane-move path hands `undefined` to `toPlainJson`. Every current lane-move IPC (`project-state:save`, `lane:auto-run`, `ticket:run-agent`) returns an object. Step 1 below confirms the trigger before the fix lands.

## Branch state
- Worktree `t37-bug-when-moving` sits at `ebdfcd5`, 4 PRs behind `origin/main` (#42 lane drag, #43 agent markdown, #44 full auto). Full auto (#44) adds the lane-entry handoff path (`fullAutoHandoffs` → `autoRunLane`) this bug lives in.
- First step: `git merge origin/main` (or rebase) before touching code.

## Requirements

### R1. Reproduce first
- Run `bun run dev` on the updated branch, create a ticket in Idea with blank description and no `agentRun`, drag it to In Development (lane with and without full auto on).
- Capture the stack from DevTools. Record which IPC channel / caller produced `undefined`. If it's not `toPlainJson`, fix that call site instead and note it on the ticket.

### R2. Guard `toPlainJson` against `undefined`
- Behavior: `undefined` in → `undefined` out, no throw. Everything else unchanged.
  ```ts
  export const toPlainJson = <T>(value: T): T =>
    value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
  ```
- Main + renderer: move the helper to `src/shared/plainJson.ts` (already in the electron tsconfig `include`); `electron/main.ts:54` and `src/services/projectTrackerApi.ts:5` import it. Drop both local copies.
- Preload: keeps its own inline copy with the same guard. `electron/preload.cts` runs with `sandbox: true` (`electron/main.ts:249`) and is compiled by plain `tsc`, no bundler, so it can only `require('electron')`. A runtime import of `src/shared/plainJson` would break preload load. Add a one-line comment saying why the copy exists.

### R3. In Development run uses ticket data when no PRD exists
- `ticketAgentPrompt` (`src/shared/projectTypes.ts:407`) already builds from lane prompt + ticket metadata + `ticket.description`; `filter(Boolean)` drops empty sections. No change expected; R1 confirms a blank-description, no-`agentRun` ticket produces a launchable prompt.

### R4. Tests (one each, existing files)
- `src/shared/plainJson.test.ts` (new, tiny) or `src/shared/projectTypes.test.ts`: `toPlainJson(undefined)` returns `undefined` without throwing; `toPlainJson({ a: 1, b: undefined })` → `{ a: 1 }`.
- `src/stores/projects.test.ts`: moving a ticket with no `agentRun` and blank description from `idea` to `in-development` saves without setting `store.error`.

## Acceptance criteria
- Ticket from any lane → In Development with blank PRD/agent fields: no error banner, no console rejection.
- In Development run uses ticket title, description, branch.
- `setNativeTheme` no longer rejects (side effect of R2).
- `bun run typecheck` and `bun run test` clean.

## Out of scope
- Making the PRD lane mandatory before In Development.
- Changing lane prompts or the Auto Run launch flow.
- Converting void IPC handlers to return explicit values (guard covers them all).

## Open questions
None blocking. R1 may reveal a second trigger; handle in this ticket if it is in the lane-move path.

## Branch / worktree
- Branch: `t37-bug-when-moving`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t37`
