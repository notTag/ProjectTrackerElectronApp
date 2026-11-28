# PRD — #153 Identify large code files in the repo

## Summary
Audit-only ticket. Find tracked source files that have grown past a maintainable size and file one split ticket per logical extraction. No code changes on this branch.

## Method
- `git ls-files` + `wc -l` over tracked source, 2026-11-26
- Threshold: non-test source files over ~800 lines
- Test files follow their source: each split ticket includes its test split

## Findings (re-verified 2026-11-26)

| File | Lines | Test lines |
|---|---|---|
| src/views/BoardView.vue | 2839 | — |
| src/styles.css | 2630 | — |
| src/shared/projectTypes.ts | 2365 | 2335 |
| src/stores/projects.ts | 1359 | 1066 |
| electron/storage/stateRepository.ts | 1138 | 1359 |
| electron/ipcHandlers.ts | 804 | — |

Below threshold, not ticketed: src/views/DashboardView.vue 728, scripts/scale-test.mjs 412, src/components/TicketGraph.vue 401.

## Split tickets (all in Backlog — verified in DB)
- #154 Split BoardView.vue: extract Lane Settings modal
- #155 Split BoardView.vue: extract Ticket modal + image handling
- #156 Split BoardView.vue: lane drag/resize/filter composables + confirm dialogs
- #157 Split src/shared/projectTypes.ts into domain modules
- #158 Split src/styles.css into per-area stylesheets
- #159 Split src/stores/projects.ts: extract agent run + GitHub logic
- #160 Split electron/storage/stateRepository.ts: row mappers + snapshots
- #161 Split electron/ipcHandlers.ts: payload validators + launch helpers

## Suggested order
1. #157 first — a barrel `index.ts` keeps `src/shared/projectTypes` imports stable for every later split
2. #154 / #155 / #156 — all touch BoardView.vue; run sequentially to avoid conflicts
3. #158, #159, #160, #161 — independent, any order / parallel

## Constraints for every split ticket
- Pure refactor: zero behaviour change
- Existing tests pass unchanged except for moved import paths; test file split mirrors source split
- `bun run build`, `bun run typecheck`, `bun run test` green before PR

## Acceptance criteria
- [x] Split tickets created for each file over threshold (#154–#161)
- [x] Line counts and ticket existence re-verified
- [ ] This PRD committed on `t153-identify-large-code` and merged via PR (In Development deliverable)

## Out of scope
- Doing any of the splits (each is its own ticket)
- Files under ~800 lines

## Open questions
None.
