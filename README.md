# Project Tracker (Electron)

Project Tracker is a macOS desktop app for keeping track of projects on your machine. Point it at the folders where you keep your work, then use the dashboard to check priorities and status or open a project's ticket board. Your data stays in a local SQLite database.

## Features

- See each project's status, priority, notes, README and GitHub stats on the dashboard.
- Give each project its own ticket board. Add as many swim lanes as you need and drag tickets between them.
- Save an agent prompt for each lane, including the built-in No status column. You can also point it at a markdown file for extra instructions.
- Import open GitHub issues as tickets. Importing again skips issues you've already pulled in, using the issue number to avoid duplicates.
- Assign shared tickets to a user and use the *Assigned to me* filter to find your work.

Agent prompts can be saved and edited, but they don't run yet. Connecting an agent provider is still on the to-do list.

## Prerequisites

- macOS for packaged builds; development may work on other platforms
- Node.js 18+ (22+ recommended)
- Bun or npm to install dependencies

## Setup

Clone the repository, then open the app directory and install dependencies:

```bash
cd electron-app
bun install
```

If you use npm:

```bash
npm install
```

## Development

Start the Vite dev server and Electron together with hot reload:

```bash
bun run dev
```

Vite runs on `http://127.0.0.1:5173`, and Electron opens once the server is ready. You don't need to set any environment variables.

## Production build

Build the renderer and Electron main process:

```bash
bun run build
```

To debug the build locally, run it with Electron:

```bash
bun run build
bun run start:dev
```

Create a macOS `.dmg` and `.zip`:

```bash
bun run dist
```

You'll find the files in `release/`. To open the packaged `.app`:

```bash
bun run start:prod
```

## Releasing

To publish an update for people who already have the app installed:

```bash
GH_TOKEN=<token with repo scope> bun run release
```

This uploads the `.dmg`, `.zip`, and `latest-mac.yml` update manifest to a draft
GitHub release. The app checks for updates on launch, downloads newer versions
in the background, and installs them when you quit. `bun run dist` builds the
same files without publishing them, so those builds won't reach the updater.

Sign each release with the same Developer ID certificate as the installed app.
The updater won't accept a build with a different code signature.

## Other scripts

| Command | Description |
|---------|-------------|
| `bun run typecheck` | Run TypeScript checks for Vue and Electron code |
| `bun run test` | Run Vitest unit tests |
| `bun run start:dev` | Run the built app with Electron's development host |
| `bun run start:prod` | Open the packaged `Project Tracker.app` from `release/` |
| `bun run release` | Build and upload a GitHub release for automatic updates |

## Project structure

```
electron-app/
├── electron/
│   ├── main.ts        # Window lifecycle, IPC handlers, GitHub API
│   ├── preload.cts    # contextBridge (compiled to CommonJS)
│   ├── scanner/       # Filesystem project discovery
│   └── storage/       # SQLite schema and repository
├── src/
│   ├── views/         # DashboardView, BoardView
│   ├── stores/        # Pinia stores
│   ├── shared/        # Types and pure reducers — compiled into both processes
│   └── services/      # IPC client wrapper
├── assets/            # App icon and static assets
├── dist/              # Built renderer (generated)
├── dist-electron/     # Built main process (generated)
└── release/           # Packaged macOS app and installers (generated)
```

## Architecture

The app is written in TypeScript. Electron's main process handles database access, files and GitHub requests, so there's no separate backend server to run.

| Process | Runtime | Responsibilities |
|---------|---------|------------------|
| **Main** (`electron/`) | Node.js, ES2022/NodeNext ESM | SQLite, filesystem scanning, GitHub API, window lifecycle, IPC handlers |
| **Preload** (`electron/preload.cts`) | sandboxed bridge | Exposes the renderer's API through `contextBridge`. Compiled to CommonJS (`.cts`) because sandboxed preloads cannot load ESM |
| **Renderer** (`src/`) | Chromium, sandboxed | Vue 3 UI. No filesystem or database access; everything goes through `window.projectTracker` IPC |

Both processes compile `src/shared/`, so the Vue components and SQLite layer use the same type definitions, including `Ticket`. This directory also holds the pure reducers for lane deletion, ticket numbering and GitHub import. The unit tests cover these reducers.

The main process runs SQLite through sql.js, a WebAssembly build of SQLite. The packaged app includes `sql-wasm.wasm` as an extra resource.

## Data storage

The app saves its data outside the repository, in Electron's `userData` directory:

```
~/Library/Application Support/Project Tracker/project-tracker.sqlite
```

Projects, swim lanes and tickets are stored as shared rows, so every member sees the same edits. Project membership determines who can see a project; ticket assignment records who's working on it.

| Table | Notes |
|-------|-------|
| `users` | currently one local user, with room for more in the schema |
| `projects` | keyed by absolute path |
| `project_members` | who can see a project; scanning a project adds membership |
| `swim_lanes` | ordered by `position`; `is_unassigned` flags the undeletable No status column |
| `tickets` | `assignee_id` is nullable and `ON DELETE SET NULL`, so removing a user releases their tickets rather than deleting the work |
| `project_paths` | hidden / third-party classification, shared like the project |
| `user_paths` | scan directories specific to each machine, never shared |
| `user_settings` | individual settings for each user |
| `schema_meta` | schema version, for future migrations |

There are two exceptions to the normalized schema, documented in `electron/storage/schema.ts`:

- `tickets.lane_id` isn't a foreign key. Tickets can sit in the virtual unassigned column, which only gets a `swim_lanes` row when you configure its prompt.
- Labels, checklists and agent runs are stored in JSON columns rather than separate tables.

### Known limits

- Every save still sends the entire state over IPC and replaces the visible rows. The tables are normalized, but saving individual records isn't implemented yet.
- sql.js exports the whole database to disk on every write, so file I/O is O(database size).
- Running two app instances can overwrite data. Writes are only serialized within a single instance.

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [Vue 3](https://vuejs.org/) + [Pinia](https://pinia.vuejs.org/) + [vue-router](https://router.vuejs.org/) — UI, state and routing
- [Vite](https://vitejs.dev/) — dev server and bundler
- [sql.js](https://sql.js.org/) — SQLite compiled to WebAssembly, embedded in the main process
- [electron-builder](https://www.electron.build/) — macOS packaging

## Troubleshooting

**Dev server won't start**

Check that nothing else is using port `5173`. The dev script runs Vite at `127.0.0.1:5173`.

**`bun run start:dev` shows a blank window**

Run `bun run build` first. The `start:dev` script expects built output in `dist/` and `dist-electron/`.

**Dock or menu bar still says Electron**

Use `bun run dist` followed by `bun run start:prod`. `start:dev` runs Electron's stock development host, which macOS labels as Electron.

**Packaged app isn't saving data**

The build bundles `sql-wasm.wasm` as an extra resource. If you change the sql.js version, rebuild with `bun run dist`.
