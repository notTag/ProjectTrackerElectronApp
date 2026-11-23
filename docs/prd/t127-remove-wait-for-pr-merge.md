# PRD — #127 Remove "Wait for PR merge before moving on" lane setting

## Why a PRD
- Removal crosses 4 layers (UI, shared move logic, storage seed/schema bookkeeping, IPC validation). Easy to delete the checkbox and leave the gate live, or to delete the schema-version constant and break the seed ordering for older files.
- Behavior change on real boards: `in-pr` lanes with the flag on start auto-moving armed tickets on checklist completion.

## Problem
- t96 hard-coded a PR-merge gate into lane movement. Not every board is a code workflow; "wait for merge" belongs in the user's lane agent prompt or a ticket's Move Rules, not in the app.

## Today (verified 2026-11-23, branch `t127-test` @ adcf96a)
- UI — `src/views/BoardView.vue:2675-2685`: checkbox + hint inside `showsLaneField('waitsForPullRequestMerge', …)`
- Type — `src/shared/projectTypes.ts:263-265` `SwimLane.waitsForPullRequestMerge?`
- Eye-toggle list — `src/shared/projectTypes.ts:1838` entry in `LANE_MODAL_FIELDS`
- Gate
	- `isReadyToMove` `:1375-1378` — `heldForMerge` early return + `rulesGate` ternary (merge lanes use `moveRulesPass`, others `moveGatePasses`)
	- `completionMoves` `:1426-1432` — merge branch in `isJustCompleted`; doc comment paragraph `:1413-1416`
- Seed
	- `SEEDED_WAITING_LANE_IDS` `:1511-1512`, used in `createDefaultBoard` `:1587`
	- `stateRepository.seedWaitingLanesOnce` `electron/storage/stateRepository.ts:412-417`, called `:279`; imports `:16`, `:36`
	- `WAITING_LANES_SCHEMA_VERSION = 6` `electron/storage/schema.ts:8-9` (same value as `SCHEMA_VERSION`)
- Storage — read `stateRepository.ts:182`; upsert column list `:690`, `ON CONFLICT` set `:703`, value `:728`
- IPC — `LANE_PATCH_FIELDS` `electron/ipcHandlers.ts:242`. `isPatchOf` rejects any unknown key → whole patch rejected (`isLanePatch`, and `isSwimLane` for lane create `:399`)
- Schema — column `schema.ts:74` + additive migration entry `:190`
- Tests — `projectTypes.test.ts:1262-1263`, `:1312-1314` (merge-gate cases); `stateRepository.test.ts:1111-1123` (seed + round-trip)
- Docs — `feature-map.md:476`
- Keep — `isPullRequestSettled` `projectTypes.ts:1914`: used by PR sync `src/stores/projects.ts:534`; its test `projectTypes.test.ts:954-957` stays

## Changes
- UI
	- Delete the `<template v-if="showsLaneField('waitsForPullRequestMerge', …)">` block
- Shared
	- Drop `waitsForPullRequestMerge` from `SwimLane` + `LANE_MODAL_FIELDS`
	- `isReadyToMove`: delete `heldForMerge`; `rulesGate` → `moveGatePasses(ticket)` (inline it)
	- `completionMoves`: delete the `if (currentLane?.waitsForPullRequestMerge)` block + the merge paragraph of the doc comment. `currentLane` param of `isJustCompleted` may become unused → drop it from signature + call sites if typecheck flags it
	- `moveRulesPass`: keep only if still referenced after the edit, else delete
	- Delete `SEEDED_WAITING_LANE_IDS`; drop the property from `createDefaultBoard`
- Storage
	- Delete `seedWaitingLanesOnce` + its call + imports
	- Delete `WAITING_LANES_SCHEMA_VERSION`. Do NOT touch `SCHEMA_VERSION` (stays 6) or `CLOSING_LANES_SCHEMA_VERSION`
	- Remove column from read mapping, upsert column list, `ON CONFLICT` set, and values
	- Leave column in `SCHEMA_SQL` + migration list (dormant, `NOT NULL DEFAULT 0`). Insert omits it → default 0; update omits it → old 1s stay but nothing reads them
- IPC
	- Remove from `LANE_PATCH_FIELDS` → stale patches with the key are rejected by existing validation (acceptable per AC; renderer and main ship together, so none are sent)
- Tests
	- Delete merge-gate cases in `projectTypes.test.ts`
	- Replace `stateRepository.test.ts:1111-1123` with: fresh file seeds no lane with column = 1; a row with column = 1 reads back with no `waitsForPullRequestMerge` key; lane update leaves the column value untouched
	- Add one `completionMoves` case: board lane `in-pr`, ticket armed, checklist completes, PR open → moves (guards against the gate creeping back)
	- No `ipcHandlers.test.ts` exists — no new IPC test; rejection is existing `isPatchOf` behavior
- Docs
	- Delete `feature-map.md:476` bullet

## Edge cases
- Saved display prefs containing `'waitsForPullRequestMerge'` in `hiddenLaneModalFields` / `hiddenLaneModalFieldsByLane` — harmless: only membership checks, no field renders for it. No pref migration
- DB opened at schema version < 6 — previously seeded `in-pr` = 1; now no seed. Fine: value is unread
- Ticket in `in-pr` already armed, checklist already complete, PR open — no transition fires on upgrade (completion is edge-triggered on `previousBoard` vs `nextBoard`). Moves next time the gate goes from failing → passing or on ▶ Run success
- `isReadyToMove` label: `in-pr` tickets with rules now need checklist + rules (via `moveGatePasses`), same as every lane

## Acceptance criteria
- Lane settings modal: no checkbox, no hint; eye-toggle list has no "Wait for PR merge"
- Movement in every lane = checklist / Move Rules / ▶ Run completion only
- New boards: no lane with the flag; existing `in-pr` lanes with column = 1 behave like any other lane, no crash
- Lane patch containing `waitsForPullRequestMerge` rejected by IPC validation, app keeps running
- `bun run typecheck` + `bun run test` pass (no `lint` script in `package.json` — typecheck covers unused imports/locals); `git grep waitsForPullRequestMerge` hits only `docs/prd/`
- Real-app check on isolated DB copy: checkbox gone; `in-pr` lane with column = 1, armed ticket, open PR, tick last checklist item → ticket moves to Next Lane

## Impact (tell user in PR)
- 6 boards have `in-pr` with the flag on. Armed tickets there will now move on checklist completion, not merge
- Replacement: add "PR merged" to the `in-pr` lane agent prompt or the ticket's Move Rules

## Out of scope
- Dropping the `waits_for_pull_request_merge` column (no column-drop migration path exists)
- Auto-writing "PR merged" into existing lane prompts / Move Rules — user's call
- PR sync (`projects.ts:534`) — unchanged

## Branch / worktree
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t127`
- Branch: `t127-test`
