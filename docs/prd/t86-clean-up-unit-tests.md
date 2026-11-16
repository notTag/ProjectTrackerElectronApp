# PRD — Ticket #86: Clean up: Unit tests

Branch: `t86-clean-up-unit`
Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t86`

## Context
The unit suite (`bun run test`, vitest via `vite.config.ts`) has grown alongside features and was never audited as a whole. The goal is a suite where every test checks something real: no tautologies, no tests left over from removed behavior, no duplicates, and nothing that only passes on a particular machine setup. This is a test-only change. Production code stays untouched unless a test turns up a real bug, and in that case the bug gets its own ticket.

## Baseline (verified 2026-11-16 on `f9a3efb`)
- `bun run test` → 21 files, 491 tests, all green with the default `TMPDIR`
- `TMPDIR=<dir inside a checkout> bunx vitest run electron/ticketWorktree.test.ts -t "not a git repository"` → 1 fail (reproduced)
- Test counts per file (`it(` / `test(` lines; `it.each` expands at runtime):
  - `src/shared/projectTypes.test.ts`: 161 · `electron/storage/stateRepository.test.ts`: 51 · `src/stores/projects.test.ts`: 42
  - `electron/terminalLaunch.test.ts`: 28 · `src/shared/agentSession.test.ts`: 18 · `electron/agentRun.test.ts`: 13 · `electron/ticketWorktree.test.ts`: 11
  - `agentMarkdown` 9, `projectScanner` 9, `metrics` (electron) 7, `openIn` 6, `src/shared/metrics` 6, `trustedSender` 5, `judge` 5, `lint` 5, `githubRequest` 4, `plainJson` 4, `autoUpdate` 2, `snapshots` (generated with `describe.each` × `it.each`)
  - `scripts/check-release-env.test.mjs`, `scripts/notarize-dmg.test.mjs`

## Pre-audit results (done in this lane)
- No test without an `expect` / assertion (a script checked every `it` block)
- No duplicate test names in any file. No two test bodies look copy-pasted (names and setup compared for the three large files)
- Weak assertions found by scanning for `toBeDefined()`, `toBeTruthy()`, `not.toBeNull()`, `not.toBeUndefined()`, and bare `toHaveBeenCalled()`. Every `not.toHaveBeenCalled()` is a meaningful negative check, so those stay as they are
- Leak seen during the baseline run: a vite-node SSR cache dir with a random name (`<random>/ssr/…`) showed up in the worktree root. Deleted. Same leak as the existing repo note on #60. Root cause is outside the ticket's acceptance criteria → see R7

## Requirements

### R1 — Tighten the 4 listed weak assertions
| Location | Today | Change to |
|---|---|---|
| `electron/storage/stateRepository.test.ts:373` | `expect(stamped.updatedAt).toBeDefined()` | ISO match `/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/` **and** `not.toBe(<seeded ticket-a updatedAt>)` (read the seed value before the update) |
| `electron/storage/stateRepository.test.ts:1137` | `expect(repository.getState()).toBeDefined()` | The first `new StateRepository` call has nothing to load. Save a known state through it (e.g. `stateWithBoard()`), then assert that the second repository's `getState()` returns that board's project / ticket ids. That shows a failed snapshot still lets the real data load |
| `src/shared/projectTypes.test.ts:232` | `…tickets[0].updatedAt).toBeDefined()` | ISO match, and newer than the fixture's `createdAt` (`2026-02-01T00:00:00.000Z`), or pin time with `vi.useFakeTimers()`/`vi.setSystemTime` and assert the exact value |
| `src/stores/projects.test.ts:125` | `agentRun?.seenAt).toBeDefined()` | `.toBe('2026-01-02T00:00:00.000Z')`, the timestamp passed to `markAgentRunSeen` |

### R2 — Tighten the closed_at trigger checks (same weakness, found in this lane)
- `stateRepository.test.ts:945, 948, 988, 997` use `expect(closedAt(...)).not.toBeNull()`
- Change them to the ISO regex the neighbouring test already uses (`:924`). Pull the regex out once as a const in the `closed_at triggers` describe, so all 5 call sites share it

### R3 — Make the "not a git repository" test independent of TMPDIR
- Cause: `repositoryRootOf` runs `git -C <dir> rev-parse`. When `os.tmpdir()` sits inside a git checkout, git walks up into it and finds a repo
- Catch: `electron/ticketWorktree.ts:26` builds `gitEnvironment = { ...process.env, … }` **at module load**. Setting `process.env` inside the test body does nothing because the module has already captured env
- Fix (test-only, recommended):
  - Inside that one test: `vi.stubEnv('GIT_CEILING_DIRECTORIES', realpathSync(tmpdir()))`, then `vi.resetModules()`, then `const { repositoryRootOf } = await import('./ticketWorktree.js')`
  - Use `realpathSync` on the ceiling and on the temp dir (macOS `/var` → `/private/var`). `afterEach` → `vi.unstubAllEnvs()`
  - Fallback if module reset turns out to be messy: `vi.hoisted` to set the env var before the static import, scoped to this file (the other tests' repos all live below tmpdir, so a tmpdir ceiling doesn't affect them)
- Verify both runs:
  - `bunx vitest run electron/ticketWorktree.test.ts` → 11 pass
  - `TMPDIR=$PWD/.tmp-t86 bunx vitest run electron/ticketWorktree.test.ts` → 11 pass, then `rm -rf .tmp-t86`
- [~80% confidence that the resetModules route works cleanly in this vitest setup. Not run here because the PRD lane doesn't edit test files. Run the two commands above to confirm]

### R4 — Full per-test audit of every in-scope file
Read each test. Grep can't do this part. For each file, record **kept / tightened / deleted + reason**:
- Tautology: asserts a value the test itself just built, or a fixture echoed back unchanged
- Mock-only: the only assertions are on mocks the test configured, with no check on the code's output or state (e.g. `projects.test.ts` store tests: each one should also assert board state or the write payload, not just that `api.*` was called)
- Dead path: the test drives an API, field or flag that production no longer reads. Cross-check each tested symbol with `fff` grep in non-test code
- Changed behavior: the name or comment describes behavior the code no longer has, even though the assertion still passes
- Duplicate: same input class and same assertion as another test (the most likely places are `projectTypes.test.ts` → `ticketShellCommand` / `full auto` / `agent model`, which all build prompts)
- Action: weak but useful → tighten. Dead / duplicate / tautological → delete

### R5 — Misplaced tests in `projectTypes.test.ts` (optional, same-file move only)
- `:1086` and `:1096` (`removeLaneFromBoard …`) sit inside `describe('full auto')` → move them into `describe('removeLaneFromBoard')` at `:97`
- `:1107` and `:1119` (Auto Run worktree behavior) → move them under `describe('Auto Run orchestrator')`
- Pure move, no assertion changes. Skip it if it makes the diff noisy

### R6 — PR body
- TOF-GH format, per file → kept / tightened / deleted with a one-line reason
- Test count before → after (491 → N), with each deletion explained
- `bun run test` green. Also include the R3 TMPDIR run output

### R7 — Out-of-scope follow-up (log only, don't fix here)
- A full `bun run test` run can leave a vite-node SSR cache dir with a random name at the worktree root. Mention it in the PR as a follow-up ticket candidate. Stage files by explicit path, never `git add -A`

## Acceptance criteria
- R1–R4 done. Every in-scope file appears in the PR audit table
- `bun run test` green under the default TMPDIR and with TMPDIR inside the checkout (at least `ticketWorktree.test.ts`)
- No production file in the diff (`git diff --stat main -- ':!*.test.*' ':!docs/'` is empty)
- No snapshot changes unless a deleted test owned them
- Worktree root clean of test leftovers before commit

## Out of scope
- New coverage, behavioral evals (`evals/behavioral/*`), framework/layout changes, snapshot content, the root-cause fix for R7

## Open questions
None. R3 picks a test-local fix over changing `ticketWorktree.ts` to read env lazily, because the ticket forbids production changes. If the reviewer prefers lazy env, that becomes a separate ticket.
