import { existsSync, readdirSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'

const APP_NAME = 'Project Tracker'
const outputRoots = [path.resolve('release'), path.resolve('dist')]

// Quit any running instance so `open` can't just refocus a stale window from a
// previous (possibly mid-build) launch, then force a brand-new instance with -n.
// Without this, `open` reuses the existing process and the freshly built app is
// never actually loaded — old broken windows appear to "survive" rebuilds.
const launchFresh = (target) => {
  try {
    execFileSync('osascript', ['-e', `quit app "${APP_NAME}"`], { stdio: 'ignore' })
  } catch {
    // app wasn't running — nothing to quit
  }
  spawn('open', ['-n', target], { stdio: 'inherit' })
}

const findFiles = (directory, predicate) => {
  if (!existsSync(directory)) return []

  const matches = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (predicate(entryPath, entry)) matches.push(entryPath)
    if (entry.isDirectory() && !entry.name.endsWith('.app')) matches.push(...findFiles(entryPath, predicate))
  }
  return matches
}

const appPath = outputRoots
  .flatMap((root) => findFiles(root, (entryPath, entry) => entry.isDirectory() && entryPath.endsWith('.app')))
  .find((candidate) => path.basename(candidate) === 'Project Tracker.app') ??
  outputRoots.flatMap((root) => findFiles(root, (entryPath, entry) => entry.isDirectory() && entryPath.endsWith('.app')))[0]

if (appPath) {
  launchFresh(appPath)
} else {
  const installerPath = outputRoots
    .flatMap((root) => findFiles(root, (entryPath, entry) => entry.isFile() && /\.(dmg|zip)$/.test(entryPath)))
    .find((candidate) => candidate.endsWith('.dmg')) ??
    outputRoots.flatMap((root) => findFiles(root, (entryPath, entry) => entry.isFile() && /\.(dmg|zip)$/.test(entryPath)))[0]

  if (!installerPath) {
    throw new Error('No packaged Project Tracker app or installer found. Run `bun run dist` first.')
  }

  console.log(`No unpacked .app found. Opening installer artifact: ${installerPath}`)
  spawn('open', [installerPath], { stdio: 'inherit' })
}
