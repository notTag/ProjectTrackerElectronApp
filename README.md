# Project Tracker (Electron)

Native macOS desktop app for managing local project directories. It scans folders on disk, tracks priority and status, and persists your dashboard state in a local SQLite database.

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
├── electron/          # Main process, IPC handlers, scanner, SQLite storage
├── src/               # Vue 3 renderer (dashboard UI)
├── assets/            # App icon and static assets
├── dist/              # Built renderer (generated)
├── dist-electron/     # Built main process (generated)
└── release/           # Packaged macOS app and installers (generated)
```

## Data storage

App state (scan directories, project metadata, hidden paths, etc.) is stored in a SQLite database at:

```
~/Library/Application Support/project-tracker-electron/project-tracker.sqlite
```

State lives outside the repository and is managed by Electron's `userData` path.

## Tech stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [Vue 3](https://vuejs.org/) + [Pinia](https://pinia.vuejs.org/) — UI and state
- [Vite](https://vitejs.dev/) — dev server and bundler
- [sql.js](https://sql.js.org/) — local SQLite persistence
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
