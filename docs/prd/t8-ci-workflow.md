# PRD — Ticket #8: CI typecheck, test and build on every PR

Source: https://github.com/notTag/ProjectTrackerElectronApp/issues/14

## Context
No `.github/` dir in the repo. `bun run typecheck`, `bun run test` and `bun run build` only run when someone remembers to run them locally, so a broken renderer build or a failing test can merge to `main` unnoticed. The repo is public, so Actions minutes, branch protection and required checks cost nothing.

## Acceptance criteria
- A workflow runs `bun install`, `bun run typecheck`, `bun run test` and `bun run build` on every PR to `main`.
- The check is required for merge on `main` (fallback if protection can't be set: visibly red on failure).
- A deliberately broken commit turns the run red; reverting turns it green.

## Code today (verified 2026-11-13 on `3a794ca`)
- Scripts (`package.json`):
  - `typecheck` = `vue-tsc --noEmit && tsc -p tsconfig.electron.json --noEmit`
  - `test` = `vitest run --passWithNoTests`
  - `build` = `rm -rf out && vue-tsc --noEmit && vite build && tsc -p tsconfig.electron.json` — no electron-builder, so no signing creds needed
- Lockfile: `bun.lock` → `bun install --frozen-lockfile`
- No `.nvmrc` / `engines`. Local: Node 22.23.1, Bun 1.3.11
- Tests: 13 files / 255 tests across `electron/**` and `src/**`
- `main` has no branch protection (`gh api repos/notTag/ProjectTrackerElectronApp/branches/main/protection` → 404)

## Constraints
- `electron/storage/stateRepository.test.ts` imports `node:sqlite`. The vitest bin runs under Node (shebang), not Bun → runner needs Node ≥ 22.5 → `actions/setup-node` with `node-version: 22` alongside `oven-sh/setup-bun`.
- `electron/ticketWorktree.test.ts` shells out to real `git` (init/clone/push in `os.tmpdir()`). Ubuntu runner has git. Its "not a git repository" case fails only when `TMPDIR` is inside a git checkout (seen in a local agent sandbox; leftover `not-a-repo-*` dirs in this worktree are from that) — fine on a clean runner.
- `electron` postinstall downloads its binary during `bun install`; works on Linux. Nothing in typecheck/test/build needs macOS → `ubuntu-latest`.
- Local baseline: typecheck ✓, build ✓, tests 254/255 (only the sandbox TMPDIR case).

## Design

### `.github/workflows/ci.yml` (only new file)
```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run test
      - run: bun run build
```

Decisions:
- One job `check`, not three: install is the slow step; one stable check name is what branch protection keys on.
- `push: main` too, so `main` itself shows a status and the protection API has a known context to require.
- Pin Bun to the local version to avoid lockfile-format drift; Node `22` (major only) is enough for `node:sqlite`.
- `permissions: contents: read` — least privilege, no secrets used.
- `bun run build` repeats `vue-tsc` from typecheck. Accepted: a few seconds, and keeps scripts untouched.

### Branch protection (after first green run of `check`)
```sh
gh api -X PUT repos/notTag/ProjectTrackerElectronApp/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "checks": [{ "context": "check", "app_id": 15368 }] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```
- `strict: false` — no forced rebase-before-merge on a solo repo.
- No review requirement, `enforce_admins: false` → owner can still merge own PRs / push in an emergency.
- Verify: `gh api repos/notTag/ProjectTrackerElectronApp/branches/main/protection --jq .required_status_checks.checks` → `[{"app_id":15368,"context":"check"}]`.

## Implementation steps
1. Branch `t8-add-ci-typecheck` already fast-forwarded to `3a794ca` (latest `main`).
2. Add `.github/workflows/ci.yml` as above. Commit, push, open PR → `check` runs.
3. Confirm green. Push a deliberate break (e.g. a type error in a `.ts` file), confirm red, revert, confirm green. Keep the break/revert out of the final history (squash merge or drop commits).
4. Merge PR → `push` run on `main` goes green.
5. Apply branch protection (command above), verify contexts.

## Test plan
- PR run: all four steps pass on `ubuntu-latest`.
- Red-path: deliberate type error fails at `typecheck`; run shows red on PR.
- Post-protection: a PR with failing `check` shows "Required" and merge button blocked (non-admin path).

## Out of scope
- `.dmg` packaging / signing / notarize (#7)
- macOS runner, release workflow
- `.github/pull_request_template.md`
- Caching `~/.bun/install/cache` — add if install time becomes a pain

## Open questions
None.
