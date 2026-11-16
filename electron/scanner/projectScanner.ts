import type { Dirent } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { ProjectRecord, ScanFailure, ScanProgress, ScanResult } from '../../src/shared/projectTypes.js'

const PROGRESS_INTERVAL_MS = 100

const PROJECT_MARKERS = [
  'package.json',
  'pnpm-workspace.yaml',
  'bun.lockb',
  'bun.lock',
  'yarn.lock',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  '.git'
]

const SKIP_NAMES = new Set([
  '.DS_Store',
  '.cache',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'vendor'
])

const normalizePath = (value: string) => path.resolve(value).split(path.sep).join(path.posix.sep)

// Entry sets hold lower-cased names: the old existsSync checks matched any case on
// case-insensitive APFS, and a rescan must not drop projects found that way.
const hasAnyMarker = (lowerCaseEntries: Set<string>) =>
  PROJECT_MARKERS.some((marker) => lowerCaseEntries.has(marker.toLowerCase()))

export const hasReadme = (entries: string[]) => entries.some((entry) => /^readme(\.|$)/i.test(entry))

const detectPackageManager = (entries: Set<string>) => {
  if (entries.has('bun.lock') || entries.has('bun.lockb')) return 'bun'
  if (entries.has('pnpm-lock.yaml')) return 'pnpm'
  if (entries.has('yarn.lock')) return 'yarn'
  if (entries.has('package-lock.json') || entries.has('package.json')) return 'npm'
  return undefined
}

export const toGithubUrl = (remoteUrl: string) => {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '')
  const sshMatch = /^git@github\.com:([^/]+)\/(.+)$/.exec(trimmed)
  if (sshMatch) return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`

  const sshProtocolMatch = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/.exec(trimmed)
  if (sshProtocolMatch) return `https://github.com/${sshProtocolMatch[1]}/${sshProtocolMatch[2]}`

  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/(.+)$/.exec(trimmed)
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`

  return undefined
}

const detectGithubUrl = async (directory: string) => {
  const gitConfigPath = path.join(directory, '.git', 'config')
  try {
    const config = await readFile(gitConfigPath, 'utf8')
    const originBlock = /\[remote "origin"\]([\s\S]*?)(?:\n\[|$)/.exec(config)?.[1]
    const firstRemoteUrl = /url\s*=\s*(.+)/.exec(originBlock ?? config)?.[1]
    return firstRemoteUrl ? toGithubUrl(firstRemoteUrl) : undefined
  } catch {
    return undefined
  }
}

const isInsideAny = (target: string, parents: string[]) =>
  parents.some((parent) => target === parent || target.startsWith(`${parent}/`))

const getProjectName = (directory: string, scanRoot: string) => {
  const relativePath = path.relative(scanRoot, directory)
  if (!relativePath || relativePath.startsWith('..')) return path.basename(directory)
  return relativePath.includes(path.sep) ? relativePath.split(path.sep).join(path.posix.sep) : path.basename(directory)
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export interface ScanOptions {
  onProgress?: (progress: ScanProgress) => void
  signal?: AbortSignal
}

// Async + sequential on purpose: each await yields the main-process event loop so IPC
// (progress events, cancel) keeps flowing during a long walk.
export const scanProjectDirectories = async (
  scanDirectories: string[],
  hiddenPaths: string[],
  thirdPartyPaths: string[],
  { onProgress, signal }: ScanOptions = {}
): Promise<ScanResult> => {
  const failures: ScanFailure[] = []
  const projects = new Map<string, ProjectRecord>()
  const normalizedHidden = hiddenPaths.map(normalizePath)
  const normalizedThirdParty = thirdPartyPaths.map(normalizePath)
  const now = new Date().toISOString()

  let directoriesSeen = 0
  let currentPath = ''
  let lastProgressAt = 0
  const reportProgress = (force: boolean) => {
    if (!onProgress) return
    const reportedAt = Date.now()
    if (!force && reportedAt - lastProgressAt < PROGRESS_INTERVAL_MS) return
    lastProgressAt = reportedAt
    onProgress({ directoriesSeen, currentPath })
  }

  const visit = async (directory: string, depth: number, scanRoot: string) => {
    signal?.throwIfAborted()
    const normalized = normalizePath(directory)
    if (isInsideAny(normalized, normalizedHidden)) return

    let dirents: Dirent[]
    try {
      dirents = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      failures.push({ path: normalized, message: errorMessage(error) })
      return
    }

    directoriesSeen++
    currentPath = normalized
    reportProgress(false)

    const entryNames = dirents.map((dirent) => dirent.name)
    const lowerCaseEntryNames = entryNames.map((name) => name.toLowerCase())
    const entries = new Set(lowerCaseEntryNames)
    if (hasAnyMarker(entries)) {
      // Only projects need an mtime, so non-project folders skip the stat.
      let directoryStat
      try {
        directoryStat = await stat(directory)
      } catch (error) {
        failures.push({ path: normalized, message: errorMessage(error) })
        return
      }
      const lastModifiedAt = directoryStat.mtime.toISOString()
      projects.set(normalized, {
        path: normalized,
        name: getProjectName(directory, scanRoot),
        status: 'unknown',
        priority: 'none',
        notes: '',
        source: isInsideAny(normalized, normalizedThirdParty) ? 'third-party' : 'first-party',
        packageManager: detectPackageManager(entries),
        githubUrl: entries.has('.git') ? await detectGithubUrl(directory) : undefined,
        hasGit: entries.has('.git'),
        hasPackageJson: entries.has('package.json'),
        hasReadme: hasReadme(entryNames),
        lastModifiedAt,
        lastScannedAt: now
      })
      return
    }

    if (depth >= 4) return

    for (const dirent of dirents) {
      signal?.throwIfAborted()
      if (dirent.name.startsWith('.') || SKIP_NAMES.has(dirent.name)) continue
      const next = path.join(directory, dirent.name)
      // Dirent types skip a stat per entry (cache dirs hold thousands of files);
      // only symlinks need a stat, to follow ones that point at directories.
      let isDirectory = dirent.isDirectory()
      if (dirent.isSymbolicLink()) {
        try {
          const symlinkTargetStat = await stat(next)
          isDirectory = symlinkTargetStat.isDirectory()
        } catch (error) {
          failures.push({ path: normalizePath(next), message: errorMessage(error) })
          continue
        }
      }
      if (isDirectory) await visit(next, depth + 1, scanRoot)
    }
  }

  const walkRoots = async () => {
    for (const directory of scanDirectories) {
      await walkRoot(directory)
    }
  }

  const walkRoot = async (directory: string) => {
    signal?.throwIfAborted()
    const normalized = normalizePath(directory)
    let rootStat
    try {
      rootStat = await stat(directory)
    } catch (error) {
      failures.push({ path: normalized, message: errorMessage(error) })
      return
    }
    if (!rootStat.isDirectory()) {
      failures.push({ path: normalized, message: 'Path is not a directory.' })
      return
    }
    await visit(directory, 0, directory)
  }

  // An in-flight fs call can't be aborted, and File Provider folders
  // (~/Library/CloudStorage, Group Containers) can block readdir indefinitely.
  // So abort rejects right away; the orphaned walk stops at its next throwIfAborted.
  const abortRejection = new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  await Promise.race([walkRoots(), abortRejection])

  reportProgress(true)

  return {
    snapshot: {
      scannedAt: now,
      projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)),
      failures
    },
    failures
  }
}
