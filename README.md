# Project Tracker (Electron)

Native macOS desktop app for managing local project directories. It scans folders on disk, tracks priority and status, and gives every project a Jira-style ticket board. State persists in a local SQLite database.

## Features

- **Dashboard** — scans configured folders, showing each project's status, priority, notes, README and GitHub stats
- **Ticket boards** — one board per project, with any number of swim lanes tickets are dragged between
- **Per-lane agents** — every lane, including the built-in No status column, carries its own agent prompt and an optional path to a markdown file that supplements it
- **GitHub import** — pulls a repository's open issues in as tickets, deduplicated by issue number so re-pulling is safe
- **Assignment** — tickets are shared and assigned to a user, with an *Assigned to me* filter

> Agent prompts are stored and editable, but nothing executes them yet — wiring a provider is still to do.

## Prerequisites

- **macOS** (required for packaged builds; development may work on other platforms)
- **Node.js 18+** (22+ recommended)
- **Bun** or **npm** for installing dependencies

## Setup

Clone the repository and install dependencies from the project root:

```bash
cd electron-app
bun install
```

Using npm instead:

```bash
npm install
```

## Development

Start the Vite dev server and Electron together with hot reload:

```bash
bun run dev
```

This runs Vite on `http://127.0.0.1:5173` and launches Electron once the server is ready. No environment variables need to be configured manually.

## Production build

Build the renderer and Electron main process:

```bash
bun run build
```

Run the raw Electron app locally against built output (mostly useful for debugging):

```bash
bun run build
bun run start:dev
```

Create a macOS distributable (`.dmg` and `.zip`):

```bash
bun run dist
```

Output is written to the `release/` directory. Open the packaged `.app` with:

```bash
bun run start:prod
```

## Other scripts

| Command | Description |
|---------|-------------|
| `bun run typecheck` | Run TypeScript checks for Vue and Electron code |
| `bun run test` | Run Vitest unit tests |
| `bun run start:dev` | Run Electron's raw dev host against built output |
| `bun run start:prod` | Open the packaged `Project Tracker.app` from `release/` |

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

The app is **TypeScript end to end**. There is no backend server — the "backend" is Electron's main process, a Node.js runtime that owns everything privileged.

| Process | Runtime | Responsibilities |
|---------|---------|------------------|
| **Main** (`electron/`) | Node.js, ES2022/NodeNext ESM | SQLite, filesystem scanning, GitHub API, window lifecycle, IPC handlers |
| **Preload** (`electron/preload.cts`) | sandboxed bridge | `contextBridge` — the only surface the renderer can reach. Compiled to CommonJS (`.cts`), since sandboxed preloads cannot load ESM |
| **Renderer** (`src/`) | Chromium, sandboxed | Vue 3 UI. No filesystem or database access; everything goes through `window.projectTracker` IPC |

`src/shared/` is compiled into *both* sides, so a field added to `Ticket` updates the Vue components and the SQLite layer from one definition. That directory also holds the pure reducers (lane deletion, ticket numbering, GitHub import), which is what the unit tests exercise.

SQLite is embedded rather than a service: **sql.js** is SQLite compiled to WebAssembly, running in-process in the main process. `sql-wasm.wasm` ships as a packaged extra resource.

## Data storage

State lives outside the repository, at Electron's `userData` path:

```
~/Library/Application Support/Project Tracker/project-tracker.sqlite
```

The schema is normalized. Projects, swim lanes and tickets are **shared rows** — an edit is what every member sees, not a per-user copy. Users attach to that shared data through membership (who can see a project) and assignment (who is working a ticket).

| Table | Notes |
|-------|-------|
| `users` | one local user today; the schema does not assume that |
| `projects` | keyed by absolute path |
| `project_members` | who can see a project — scanning grants it |
| `swim_lanes` | ordered by `position`; `is_unassigned` flags the undeletable No status column |
| `tickets` | `assignee_id` is nullable and `ON DELETE SET NULL`, so removing a user releases their tickets rather than deleting the work |
| `project_paths` | hidden / third-party classification, shared like the project |
| `user_paths` | scan directories — genuinely per-machine, never shared |
| `user_settings` | per-user scalars |
| `schema_meta` | schema version, for future migrations |

Two deliberate departures from strict normalization, both commented in `electron/storage/schema.ts`: `tickets.lane_id` is not a foreign key, because a ticket may sit in the virtual unassigned column that has no `swim_lanes` row until its prompt is configured; and labels, checklists and agent runs are JSON columns rather than child tables.

### Known limits

- The renderer still exchanges the **entire state** over IPC on every save, so each write replaces the visible rows. Normalized tables are the prerequisite for per-entity writes, not the delivery of them.
- sql.js exports the whole database to disk on every write, so file I/O is O(database size).
- Two app instances would clobber each other — writes are serialized within one instance only.

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [Vue 3](https://vuejs.org/) + [Pinia](https://pinia.vuejs.org/) + [vue-router](https://router.vuejs.org/) — UI, state and routing
- [Vite](https://vitejs.dev/) — dev server and bundler
- [sql.js](https://sql.js.org/) — SQLite compiled to WebAssembly, embedded in the main process
- [electron-builder](https://www.electron.build/) — macOS packaging

## Troubleshooting

**Dev server won't start**

Ensure port `5173` is free. The dev script binds Vite to `127.0.0.1:5173`.

**`bun run start:dev` shows a blank window**

Run `bun run build` first. The `start:dev` script expects built output in `dist/` and `dist-electron/`.

**Dock or menu bar still says Electron**

Use `bun run dist` followed by `bun run start:prod`. `start:dev` runs Electron's stock development host, which macOS labels as Electron.

**Packaged app fails to persist state**

The build bundles `sql-wasm.wasm` as an extra resource. If you change the sql.js version, rebuild with `bun run dist`.
