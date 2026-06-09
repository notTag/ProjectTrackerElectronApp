# Project Tracker Electron App PRD

## Overview

Project Tracker Electron App packages the existing Project Tracker dashboard as a native macOS desktop application. The app should preserve the current Vue/Vite dashboard experience while replacing the Vite-only local API middleware with Electron-native capabilities for scanning project directories, persisting state in a local SQLite database, choosing folders, and opening project shells.

## Problem

The current dashboard works well in local development, but its local backend behavior is implemented as Vite dev middleware. That means the scanner, repo-local JSON state persistence, folder picker, and local project actions are not part of a packaged production app. Users need a reliable desktop app that can run without a dev server and manage local project state from the filesystem.

## Goals

- Package the existing dashboard UI as a desktop app.
- Support scanning local project directories without running `vite dev`.
- Persist user state outside the repository in a local SQLite database under the app data directory.
- Preserve existing project classification workflows: priority, status, notes, hidden paths, third-party paths, and scan directories.
- Provide a native folder picker for adding scan directories.
- Provide a native action for opening a shell at a project path.
- Produce a local macOS distributable suitable for personal use.

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

The existing app lives in `dashboard/` and is a Vite/Vue/Pinia single-page app.

Important current pieces:

- `dashboard/src/views/DashboardView.vue`: main dashboard experience.
- `dashboard/src/stores/projects.ts`: project state and dashboard workflows.
- `dashboard/src/services/projectTrackerApi.ts`: browser API client.
- `dashboard/dev/projectStateServer.ts`: Vite middleware for state, scan, and folder picking.
- `scripts/scan-projects.sh`: current local project scanner to be ported to TypeScript.
- `projecttracker-state.json`: current repo-local persisted state.

## Requirements

### App Shell

- Create an Electron app that loads the built Vite dashboard.
- Support local development with hot reload.
- Support packaged production builds without a Vite server.
- Use secure Electron defaults:
  - `contextIsolation: true`
  - `nodeIntegration: false`
  - explicit preload bridge
  - no broad filesystem access from renderer code

### Routing

- Ensure dashboard routing works from the packaged app.
- Prefer hash-based routing for packaged file loading unless a custom protocol is introduced.

### State Persistence

- Store Project Tracker state in a local SQLite database created under Electron's app data path, available from `app.getPath('userData')`.
- Treat SQLite as the canonical local store for the desktop app. Renderer `localStorage` may remain only as a browser-development fallback.
- Do not auto-migrate or import the existing repo-local `projecttracker-state.json` for the first release.
- Preserve the existing logical state shape in the storage model:
  - `version`
  - `updatedAt`
  - `scanDirectories`
  - `hiddenPaths`
  - `thirdPartyPaths`
  - `snapshot`
- SQLite writes should use transactions where multiple state changes must be committed together.
- The storage layer should be abstracted behind a small repository/service API so a future multi-machine or multi-user version can migrate to a server-backed database such as Postgres without rewriting renderer workflows.

### Project Scanning

- Port the existing scanner behavior from `scripts/scan-projects.sh` to TypeScript and run it from the Electron main process.
- Support a user-selected initial scan directory chosen during first-launch onboarding.
- Support user-added scan directories.
- Respect hidden/excluded paths.
- Preserve existing merge behavior so user edits survive rescans.
- Surface scan failures clearly in the UI.

### Folder Picker

- Replace the Vite middleware `osascript` folder picker with Electron's native folder dialog.
- Return a normalized POSIX path.
- Return `null` when the user cancels.

### Project Shell Action

- Provide a native action to open a shell at a selected project path.
- For macOS MVP, opening Terminal or the user's default shell is acceptable.
- If native shell opening fails, fall back to copying `cd <path>` to the clipboard and show clear feedback.

### Renderer API

- Replace HTTP calls to `/api/project-state` with Electron IPC/preload methods when running in Electron.
- Keep the current HTTP behavior available for browser/dev compatibility if useful.
- IPC means Electron inter-process communication between the renderer process and the main process. There is no separate token exchange between the bundled renderer and main process for the MVP; trust is established by loading only the packaged/local dashboard, using `contextIsolation`, disabling Node integration, exposing only explicit preload methods, and validating every IPC payload in the main process before performing filesystem, database, dialog, shell, or scanner work.
- IPC handlers must validate input shapes and normalize paths before acting on renderer requests.
- IPC handlers should reject unexpected sender frames/origins so privileged methods are only callable from the packaged dashboard or the known local development URL.
- Suggested preload API:
  - `getProjectState()`
  - `saveProjectState(state)`
  - `scanProjectDirectories(scanDirectories, hiddenPaths, thirdPartyPaths)`
  - `pickScanDirectory()`
  - `openProjectShell(path)`

### Packaging

- Build a macOS app artifact for local installation.
- Include the compiled Electron main, preload, renderer, and scanner code.
- Ensure production builds do not depend on files outside the packaged app except user-selected project directories and app data SQLite files.

## UX Requirements

- First launch should create fresh local app state and prompt the user for their initial project location before scanning.
- The first-launch prompt should be a modal that asks where the user's projects are located, with a path input and an OS filesystem selector powered by Electron's native folder dialog.
- The first-launch prompt should allow the user to confirm a selected path, cancel/skip to view the seed snapshot, or retry if the selected path cannot be scanned.
- First launch should not auto-import repo-local state.
- First launch should show the current seed snapshot only until a scan succeeds or when a scan fails before any stored snapshot exists.
- Existing dashboard workflows should remain visually and behaviorally intact.
- Scan, save, picker, and shell errors should be user-visible and actionable.
- The app should not show developer-oriented Vite or Electron chrome in production.

## Technical Approach

1. Scaffold an Electron app inside `electron-app/`.
2. Reuse the dashboard package as the renderer rather than duplicating UI code.
3. Add an Electron main process responsible for filesystem, child process, dialog, and shell behavior.
4. Add a preload script exposing a small typed API to the renderer.
5. Refactor `dashboard/src/services/projectTrackerApi.ts` to use Electron APIs when present and HTTP APIs otherwise.
6. Add a SQLite-backed state repository under Electron `userData`.
7. Move shared project/state types into a reusable location or duplicate minimally at first.
8. Port scanner behavior to TypeScript in the Electron main process.
9. Configure packaging for the compiled Electron app.

## Milestones

### Milestone 1: Functional Desktop MVP

- Electron app launches the dashboard.
- Production build loads without a dev server.
- Project state can be read and saved from SQLite under app data.
- Scan runs from TypeScript code in the Electron main process.
- Folder picker works.
- IPC payload validation is in place for MVP privileged actions.
- Existing tests still pass.

### Milestone 2: Native Polish

- Shell opening works on macOS.
- App name, icon, menu, and window defaults are set.
- Packaged `.app` or `.dmg` artifact is produced.
- First-run fresh state behavior is polished and documented.

### Milestone 3: Hardening

- Failure states are covered with tests.
- Packaged app smoke test is documented.
- Large scans and missing directories are handled gracefully.
- Storage repository boundaries are documented for future cloud/database migration.

## Acceptance Criteria

- A user can install and open the Electron app on macOS.
- The app displays the existing Project Tracker dashboard.
- On first launch, the app prompts the user to choose an initial project directory.
- The app can scan the first-launch project directory and additional selected directories.
- User edits persist after app restart.
- Hidden paths, third-party paths, scan directories, notes, statuses, and priorities survive rescans.
- Folder selection uses a native dialog.
- The app can open or prepare a shell command for a selected project.
- The app does not require `vite dev` or a browser tab in packaged mode.
- Reloading the packaged app window displays the dashboard without a blank screen.
- The first launch starts from fresh local state, asks for an initial project directory, and does not import repo-local JSON automatically.
- SQLite state is stored under Electron's `userData` directory, not in the repository.

## Risks

- macOS shell-opening behavior can vary by terminal app and user configuration.
- SQLite native dependency packaging may need careful configuration for Electron.
- Current scanner behavior may be synchronous or long-running; large directories may need progress reporting later.
- Future cloud or multi-user persistence will need an explicit migration/sync model from local SQLite.

## Open Questions

- Should the Electron app live as a wrapper around `dashboard/`, or should `dashboard/` become a workspace package consumed by `electron-app/`?
- Which packaging tool should be preferred: `electron-builder`, `electron-forge`, or a minimal custom setup?
- Should the app support custom terminal selection in settings?
- Is macOS-only acceptable for the first release, or should the architecture leave room for Windows/Linux soon?

## Estimated Effort

- Functional MVP: about 1 day.
- Polished local macOS app: about 2-4 days.
- Cross-platform, signed, auto-updating app: additional effort beyond the initial scope.
