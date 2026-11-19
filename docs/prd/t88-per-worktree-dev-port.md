# PRD — Ticket #88: Each worktree gets its own dev server port, freed on quit or Ctrl+C

## Problem
`bun run dev` hard-codes port 5173 in vite, `wait-on` and `VITE_DEV_SERVER_URL`. If a second checkout is already running a dev server, vite moves to 5174, `wait-on tcp:5173` passes straight away because the other server holds 5173, and Electron loads the **other** checkout's renderer. The app opens and looks fine but runs the wrong code. This happened while testing #83.

## Goal
Every checkout runs its own dev server on its own port, which stays the same from run to run. vite, `wait-on` and Electron all use that one port. If the port is taken, the run fails loudly. Every way of quitting frees the port.

## Current state (verified in code)
- `package.json:9` `dev`: `concurrently -k "vite --host 127.0.0.1" "wait-on tcp:5173 && tsc -p tsconfig.electron.json && cross-env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron ."`
- `vite.config.ts:27-30` `server: { host: '127.0.0.1', port: 5173 }`. No `strictPort`.
- `electron/main.ts:18-20` `devServerUrl = process.env.VITE_DEV_SERVER_URL`. This is the only dev/packaged switch, and the renderer loads from it.
- `electron/main.ts:306-308` `window-all-closed` calls quit only when the platform is not darwin. On macOS, closing the last window leaves Electron running, and vite with it.
- `electron/trustedSender.ts` compares the sender origin with `devServerUrl`, so it follows the new port with no change. The 5173 fixtures in `trustedSender.test.ts` are unit inputs and stay as they are.
- Web server: `DEFAULT_WEB_PORT = 5174` (`electron/web/server.ts:25`), overridden by `PROJECT_TRACKER_WEB_PORT` (`server.ts:369`).
- Docs that mention 5173: `README.md:44`, `README.md:230` (mermaid label `Vite :5173 (dev)`), `README.md:302`, `feature-map.md:576`.
- `concurrently` is 9.2.1, and its Node API ships the `kill-on-signal` and `kill-others` flow controllers. `wait-on` is ^8.0.3.

## Decisions (resolved, no open questions)
1. **Env var: `PROJECT_TRACKER_DEV_PORT`. Bare `PORT` is not read.** Many tools and shells export a global `PORT`, which would quietly move this app's dev server. The name matches the existing `PROJECT_TRACKER_WEB_PORT`. The ticket's `PORT=5199` was given as an example ("e.g."), so the README documents `PROJECT_TRACKER_DEV_PORT=5199 bun run dev`.
2. **How "main checkout" is detected:** compare `git rev-parse --show-toplevel` with `dirname(git rev-parse --path-format=absolute --git-common-dir)`. If they are equal, it is the main checkout → 5173. A different toplevel means a linked worktree → hashed port. If git is missing or fails (e.g. a tarball checkout), use 5173. This does not depend on directory names such as `.worktrees/`.
3. **Hash:** `5200 + (first 4 bytes of sha256(toplevel path) as uint32) % 700` → range 5200–5899. That avoids 5173 and the web server's 5174. Only the path goes into the hash, so the port stays the same across runs and branch switches. A collision between two worktrees is possible but rare. `--strictPort` turns it into a clear error, and the error message names the override variable.
4. **Override validation:** same rule as the web server. The value must be an integer from 1 to 65535. Anything else exits non-zero with `PROJECT_TRACKER_DEV_PORT must be a port number, got "<value>".`
5. **Launcher: `scripts/dev.mjs` uses the `concurrently` Node API**, not a nested shell string. It runs the same two commands with the port filled in, `killOthers: ['failure', 'success']` (same as `-k`), and exits with concurrently's result code. That gives a single place where the port is filled in, and the API's built-in `kill-on-signal` forwards Ctrl+C to both children.
6. **Where the port flags go: CLI flags only.** vite runs as `vite --host 127.0.0.1 --port <p> --strictPort`. Remove `port: 5173` from `vite.config.ts` and add `strictPort: true`, so a bare `vite` run (default 5173) also refuses to move to another port. The config then holds no port number.
7. **`wait-on tcp:127.0.0.1:<p>`**, not `tcp:<p>`. Without a host, `wait-on` uses `localhost`, which can resolve to `::1`, while vite binds to 127.0.0.1 only. Spelling out the host matches what vite actually binds.
8. **Quit in dev only when the last window closes:** `if (devServerUrl || process.platform !== 'darwin') app.quit()`. Packaged macOS keeps its dock behavior. Cmd+Q already quits in both modes.

## Requirements
- R1: The main checkout always gets 5173.
- R2: A linked worktree gets `5200 + hash % 700`, and repeated runs from that worktree return the same value.
- R3: `PROJECT_TRACKER_DEV_PORT` overrides R1 and R2. An invalid value exits non-zero with the message from decision 4, and no child process starts.
- R4: vite, `wait-on` and `VITE_DEV_SERVER_URL` all get the port from one variable in `scripts/dev.mjs`. No 5173 remains in `package.json` or `vite.config.ts`.
- R5: vite runs with `--strictPort`. If the port is taken, `bun run dev` exits non-zero, vite reports the port as in use, Electron never starts, and the launcher prints one line: `Port <p> is taken. Set PROJECT_TRACKER_DEV_PORT to use another.` The kill-others behavior then stops the waiting `wait-on` command.
- R6: Cmd+Q, or closing the last window in dev, quits Electron. concurrently then stops vite, and the port is freed.
- R7: Ctrl+C in the terminal stops vite and Electron, and the port is freed.
- R8: After R6 or R7, `lsof -nP -iTCP:<p> -sTCP:LISTEN` prints nothing, and `pgrep -fl "<worktree>/node_modules/.bin/(vite|electron)"` (or a `ps` check scoped to the checkout path) finds nothing.
- R9: Two checkouts (main + one worktree, or two worktrees) run `bun run dev` side by side, and each Electron window shows its own checkout's code.
- R10: `start:prod`, `dist`, `release`, `web`, `build` and `start:dev` are unchanged.

## Implementation
### `scripts/dev.mjs` (new)
- Export pure helpers so they can be tested without git or child processes:
  - `devPortForCheckout({ toplevel, mainCheckout })` → number (R1, R2).
  - `resolveDevPort({ env, toplevel, mainCheckout })` → `{ port }` or `{ error }` (R3).
- `readCheckoutPaths()` runs the two `git rev-parse` calls with `execFileSync`. If either fails, it returns `null`, and the caller then uses 5173.
- Only when the file is run directly (`import.meta.url === pathToFileURL(process.argv[1]).href`): resolve the port, print `Dev server: http://127.0.0.1:<p>`, then call `concurrently` with:
  - `vite --host 127.0.0.1 --port <p> --strictPort` (name `vite`)
  - `wait-on tcp:127.0.0.1:<p> && tsc -p tsconfig.electron.json && electron .` (name `electron`), with `env: { VITE_DEV_SERVER_URL: 'http://127.0.0.1:<p>' }` set on the command. cross-env is not needed inside the API.
  - `killOthers: ['failure', 'success']`. Resolve or reject `result` and call `process.exit` with the matching code.
- Keep each step on its own named line (CLAUDE.md readability rules). For example, the hash → uint32 → offset → port chain gets one named variable per step.

### `package.json`
- `"dev": "node scripts/dev.mjs"`. This matches the other `scripts/*.mjs` entries, which run under `node`.
- Keep `cross-env` in devDependencies only if something else still uses it. Otherwise drop it. Check `package.json` for other uses before removing.

### `vite.config.ts`
- `server: { host: '127.0.0.1', strictPort: true }`, with `port` removed.

### `electron/main.ts`
- Change line 307 as in decision 8. Without it, closing the last window on macOS leaves Electron and vite running.

### Tests: `scripts/dev.test.mjs` (new, vitest, in the style of `check-release-env.test.mjs`)
- Main checkout path → 5173.
- Worktree path → a value from 5200 to 5899, the same on two calls.
- Two different worktree paths → each gets a value in range (no equality assertion, just stability).
- `PROJECT_TRACKER_DEV_PORT=5199` → 5199 for both the main checkout and a worktree.
- `PROJECT_TRACKER_DEV_PORT=abc`, `0` and `70000` → `{ error }` containing the variable name.
- Bare `PORT=5199` → ignored (decision 1).
- `null` checkout paths (no git) → 5173.

### Docs
- `README.md:44`: explain how the port is picked (main = 5173, worktree = stable 5200–5899 from the path), that the launcher prints the URL, and the `PROJECT_TRACKER_DEV_PORT=5199 bun run dev` override.
- `README.md:230`: change the mermaid label to `Vite :5173+ (dev)`, or `Vite dev server`.
- `README.md:302` (troubleshooting): a "Port … is taken" error means another process holds this checkout's port. Use `lsof -nP -iTCP:<port> -sTCP:LISTEN` to find it, or set the override.
- `feature-map.md:576`: replace `http://127.0.0.1:5173` with "the dev server URL (`VITE_DEV_SERVER_URL`, port picked per checkout)".

## Verification (run before merge, per the run-app-before-merge memory)
1. `bun run test` (new test passes) and `bun run typecheck`.
2. From the worktree, `bun run dev` → note the printed port `<p>` (not 5173). The window shows the worktree's code (make a visible throwaway change, or check the title or the branch indicator).
3. Start `bun run dev` in the main checkout at the same time → it gets 5173, and each window shows its own code (R9).
4. Cmd+Q the worktree app → `lsof -nP -iTCP:<p> -sTCP:LISTEN` prints nothing, and no leftover vite/electron process exists for that path (R6, R8).
5. Run again and close the last window (red button) → same checks (R6).
6. Run again and press Ctrl+C in the terminal → same checks (R7).
7. Occupy the port (`python3 -m http.server <p> --bind 127.0.0.1`), then run `bun run dev` → it exits non-zero with the "taken" message, and no Electron window appears (R5). Stop the http server afterwards.
8. `PROJECT_TRACKER_DEV_PORT=5199 bun run dev` → vite is on 5199 and Electron loads it. `PROJECT_TRACKER_DEV_PORT=abc bun run dev` → error, nothing starts (R3).
9. Use the isolated DB copy from the drive-app-via-cdp memory, so dev runs don't touch the real tracker DB.

## Out of scope
- Packaged or production builds, and `start:prod`, `dist`, `release`.
- Picking ports for anything other than the vite dev server, including the web server's 5174.
- Finding a free port automatically. A fixed port per checkout plus a loud failure is the intended design.

## Risks
- concurrently API signal handling: the API's default flow controllers include `kill-on-signal` (present in 9.2.1 `dist/src/flow-control/`). Verification step 6 confirms Ctrl+C reaches both children. If it does not, fall back to spawning the `concurrently` CLI with `-k` and the same commands. [~85% confidence that the API alone is enough; verification step 6 settles it]
- Ports in 5200–5899 could clash with unrelated local services. `--strictPort` plus the override covers that.
