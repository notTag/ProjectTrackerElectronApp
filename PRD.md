# Project Tracker Electron App PRD

## Overview

Project Tracker Electron App packages the existing Project Tracker dashboard as a native macOS desktop application. The app should preserve the current Vue/Vite dashboard experience while replacing the Vite-only local API middleware with Electron-native capabilities for scanning project directories, persisting state in a local SQLite database, choosing folders, and opening project shells.

## Problem

The current dashboard works well in local development, but its local backend behavior is implemented as Vite dev middleware. That means the scanner, repo-local JSON state persistence, folder picker, and local project actions are not part of a packaged production app. Users need a reliable desktop app that can run without a dev server and manage local project state from the filesystem.

## Non-Goals

- Rebuild the dashboard UI from scratch.
- Add cloud sync, accounts, or collaboration.
- Replace the current scan logic with a cloud-backed or server-backed indexing engine.
- Support Windows or Linux in the first release.
- Publish to the Mac App Store.
- Implement automatic updates in the first release.

## Users

Primary user: a developer managing many local projects who wants a quick desktop dashboard for project health, priority, activity, and triage.

## Current System

The Vue/Pinia app in `src/` is the only UI. It runs in the Electron window, and the same code runs in a browser through `bun run web`, a local Node server that calls the same channel handlers (`electron/ipcHandlers.ts`). The old standalone `web-app/` and its Vite middleware were removed in #85.

## Milestones

### Milestone 3: Hardening (done)

- [x] Failure states are covered with tests.
- [x] Packaged app smoke test is documented (`docs/packaged-smoke-test.md`).
- [x] Large scans and missing directories are handled gracefully.
- [x] Storage repository boundaries are documented for future cloud/database migration (`docs/storage-seam.md`).

## Risks

- macOS shell-opening behavior can vary by terminal app and user configuration.
- Current scanner behavior may be synchronous or long-running; large directories may need progress reporting later.
- Future cloud or multi-user persistence will need an explicit migration/sync model from local SQLite.

## Open Questions

- Is macOS-only acceptable for the first release, or should the architecture leave room for Windows/Linux soon?
