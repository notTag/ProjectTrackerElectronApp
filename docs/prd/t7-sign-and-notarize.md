# PRD — Ticket #7: Sign and notarize the packaged macOS app

## Problem
`bun run dist` can exit 0 with a build that is signed but not notarized, and the `.dmg` is never notarized at all. A downloaded, quarantined copy then shows "Project Tracker is damaged" or needs right-click → Open on another Mac.

## Done when
- `bun run dist` produces a signed, notarized, stapled `.dmg` (and a notarized `.app` inside the `.zip`).
- The DMG opens on a machine that has never seen the source, with no Gatekeeper override.
- Credentials come from the environment or keychain only and are never committed.

## Code today (verified 2026-11-13 on `c36c25b`, electron-builder / app-builder-lib 26.15.2)
- `package.json` `build.mac`: `entitlements` + `entitlementsInherit` → `build/entitlements.mac.plist`. Targets `dmg`, `zip`. No arch (host arch).
- Developer ID cert is in the login keychain and electron-builder finds it on its own. Hardened runtime is on by default.
- `.app` notarization: `macPackager.js:318` `notarizeIfProvided(appPath)` reads creds via `MacTargetHelper.getNotarizeOptions` (`APPLE_KEYCHAIN_PROFILE`, API key, or Apple ID sets). With no creds it only logs a skip.
- DMG: `dmg-builder/out/dmg.js` never notarizes. It signs the DMG only when `dmg.sign === true` (default `false`). It writes the blockmap and sha512 (`createBlockmap`) and **then** calls `emitArtifactBuildCompleted`.
- `packager.js:226` `emitArtifactBuildCompleted` awaits the user `artifactBuildCompleted` hook, **then** emits `artifactCreated`. That second event schedules the GitHub upload and the `latest-mac.yml` entry (`PublishManager.js:150-163`).
- `afterAllArtifactBuild` (`index.js:58`) runs after `packager.build()` finishes, so every `artifactCreated` upload has already been scheduled.
- `dist/latest-mac.yml` (0.2.0) **does** list the DMG with its sha512 and size, not just the zip.
- `scripts/check-release-env.mjs`: `notarizeProblem(env)` is private. `releaseEnvProblems(env)` adds a GitHub-token check. Only `release` calls it. Tests are in `check-release-env.test.mjs`.

## Corrections to the ticket plan
1. **Use `artifactBuildCompleted`, not `afterAllArtifactBuild`.** With `--publish always`, the original DMG upload is already queued before `afterAllArtifactBuild` runs, so the upload and the stapler race. `artifactBuildCompleted` is awaited before `artifactCreated`, so whatever gets uploaded is already stapled.
2. **The DMG hash in `latest-mac.yml` would go stale.** The sha512 and blockmap are computed before any hook runs. Fix: set `build.dmg.writeUpdateInfo: false`. The DMG then gets no blockmap and no `latest-mac.yml` entry (`isWriteUpdateInfo` is false). The updater only uses the zip, so auto-update is unaffected.

## Requirements
### R1 Preflight on `dist`
- Export `notarizeProblem` from `check-release-env.mjs` and add a `--notarize-only` argv flag: it checks only notarize creds, without asking for a GitHub token.
- `"dist": "node scripts/check-release-env.mjs --notarize-only && bun run build && electron-builder --mac"`.
- Error header for this mode: "Dist aborted before building".
- Tests: notarize-only passes with `APPLE_KEYCHAIN_PROFILE` alone and no token; fails on `{}` with one problem.

### R2 Notarize + staple the DMG
- `build.artifactBuildCompleted: "scripts/notarize-dmg.mjs"` (default export `(context) => Promise<void>`). Return early unless `context.file` ends in `.dmg`.
- Map creds to notarytool flags, in the same precedence as `getNotarizeOptions`:
  - `APPLE_KEYCHAIN_PROFILE` → `--keychain-profile <p>` (+ `--keychain <APPLE_KEYCHAIN>` if set)
  - `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` → `--key --key-id --issuer`
  - `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` → `--apple-id --password --team-id`
- `execFile('xcrun', ['notarytool','submit',dmg,...flags,'--wait'])`, then `execFile('xcrun', ['stapler','staple',dmg])`. Use `node:child_process` + `util.promisify`, never a shell string. Throw on a non-zero exit so the build fails.
- With no creds: throw. The R1 preflight should already have caught that, so reaching it means a bug.
- Pure flag-mapping fn exported and unit-tested (3 cred sets + precedence). The `xcrun` calls are not mocked.
- `build.dmg`: `{ "sign": true, "writeUpdateInfo": false }`.

### R3 Credentials (one-time, local)
- `xcrun notarytool store-credentials notary --apple-id <id> --team-id RNHBB5G7H7` (prompts for the app-specific password and stores it in the keychain).
- Export `APPLE_KEYCHAIN_PROFILE=notary` in your shell profile. Nothing goes into the repo or `.env`.

### R4 README
- Add to the release section: the `dist` creds requirement, keychain profile setup (R3), and that the API key and Apple ID env sets also work.
- Unsigned escape hatch: `CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --dir` (after `bun run build`). No new script.

### R5 Verify (record outputs in the PR)
- `codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Project Tracker.app"`
- `spctl -a -vvv -t exec "dist/mac-arm64/Project Tracker.app"` → `source=Notarized Developer ID`
- `xcrun stapler validate dist/*.dmg`
- `spctl -a -vvv -t open --context context:primary-signature dist/*.dmg` → accepted, Notarized Developer ID
- `dist/latest-mac.yml` lists only the `.zip`, and no `.dmg.blockmap` is produced
- Manual: get the DMG onto a second Mac or a fresh user account by AirDrop or browser download (that sets quarantine), then open it with no override

## Decisions (defaulted, no blockers)
- D1 Local keychain only, no CI signing. CI signing gets its own ticket.
- D2 `dist` requires notarize creds and fails fast. Unsigned builds use the `--dir` escape hatch.
- D3 The keychain profile is the documented default. API key and Apple ID still work.
- D4 Arch unchanged (host arch).
- D5 `dmg.sign: true`. Apple recommends signing a disk image before notarizing, and `spctl -t open --context context:primary-signature` needs a signature to assess. The scheme's "unwanted errors" note is legacy. If notarytool rejects the signed DMG, set it back to `false` and record why in the PR. [~75% confidence — confirmed only by an R5 run]
- D6 DMG left out of `latest-mac.yml` (`writeUpdateInfo: false`) rather than re-hashing after stapling. Nothing reads that entry.

## Out of scope
- CI signing pipeline, Windows/Linux signing (#1), Mac App Store, universal/x64 builds.

## Branch / worktree
- Branch: `t7-sign-and-notarize`
- Worktree: `/Users/nicktag/Code/Projects/ProjectTracker/electron-app/.worktrees/t7`
