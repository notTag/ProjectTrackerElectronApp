// `bun run dev` launcher. Gives each checkout its own vite port so two
// worktrees can run side by side without one Electron loading the other's
// renderer (#88).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import concurrently from 'concurrently'

export const MAIN_CHECKOUT_PORT = 5173
export const WORKTREE_PORT_BASE = 5200
// 5200–5899: clear of the main checkout's 5173 and the web server's 5174.
export const WORKTREE_PORT_SPAN = 700
export const PORT_OVERRIDE_VAR = 'PROJECT_TRACKER_DEV_PORT'
const DEV_HOST = '127.0.0.1'

export const devPortForCheckout = (checkoutPaths) => {
  const isUnknownCheckout = checkoutPaths === null
  if (isUnknownCheckout) return MAIN_CHECKOUT_PORT

  const { toplevel, mainCheckout } = checkoutPaths
  const isMainCheckout = toplevel === mainCheckout
  if (isMainCheckout) return MAIN_CHECKOUT_PORT

  const pathDigest = createHash('sha256').update(toplevel).digest()
  const pathHash = pathDigest.readUInt32BE(0)
  const portOffset = pathHash % WORKTREE_PORT_SPAN
  return WORKTREE_PORT_BASE + portOffset
}

export const resolveDevPort = (env, checkoutPaths) => {
  const override = env[PORT_OVERRIDE_VAR]
  if (override === undefined || override === '') return { port: devPortForCheckout(checkoutPaths) }

  const overridePort = Number(override)
  const isValidPort = Number.isInteger(overridePort) && overridePort >= 1 && overridePort <= 65535
  if (!isValidPort) return { error: `${PORT_OVERRIDE_VAR} must be a port number, got "${override}".` }
  return { port: overridePort }
}

const gitOutput = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

const readCheckoutPaths = () => {
  try {
    const toplevel = gitOutput(['rev-parse', '--show-toplevel'])
    const commonGitDir = gitOutput(['rev-parse', '--path-format=absolute', '--git-common-dir'])
    return { toplevel, mainCheckout: dirname(commonGitDir) }
  } catch {
    return null
  }
}

// ponytail: check-then-bind race; vite's --strictPort still fails loudly if
// something grabs the port in between.
const isPortFree = (port) =>
  new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, DEV_HOST, () => probe.close(() => resolve(true)))
  })

const runDevServer = async () => {
  const resolved = resolveDevPort(process.env, readCheckoutPaths())
  if (resolved.error) {
    console.error(resolved.error)
    process.exit(1)
  }

  const { port } = resolved
  if (!(await isPortFree(port))) {
    console.error(`Port ${port} is taken. Set ${PORT_OVERRIDE_VAR} to use another.`)
    process.exit(1)
  }

  const devServerUrl = `http://${DEV_HOST}:${port}`
  console.log(`Dev server: ${devServerUrl}`)

  const viteCommand = {
    name: 'vite',
    command: `vite --host ${DEV_HOST} --port ${port} --strictPort`
  }
  const electronCommand = {
    name: 'electron',
    command: `wait-on tcp:${DEV_HOST}:${port} && tsc -p tsconfig.electron.json && electron .`,
    env: { VITE_DEV_SERVER_URL: devServerUrl }
  }
  // 'first': quitting Electron exits 0 even though vite then dies by SIGTERM.
  const { result } = concurrently([viteCommand, electronCommand], {
    killOthersOn: ['failure', 'success'],
    successCondition: 'first'
  })

  try {
    await result
    process.exit(0)
  } catch {
    process.exit(1)
  }
}

const entryScriptPath = process.argv[1]
const entryScriptUrl = entryScriptPath ? pathToFileURL(realpathSync(entryScriptPath)).href : null
const isRunDirectly = import.meta.url === entryScriptUrl

if (isRunDirectly) await runDevServer()
