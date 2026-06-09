import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import type { ProjectRecord, ScanFailure, ScanResult } from '../../src/shared/projectTypes.js'

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

const hasAnyMarker = (directory: string) =>
  PROJECT_MARKERS.some((marker) => existsSync(path.join(directory, marker)))

const detectPackageManager = (directory: string) => {
  if (existsSync(path.join(directory, 'bun.lock')) || existsSync(path.join(directory, 'bun.lockb'))) return 'bun'
  if (existsSync(path.join(directory, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(directory, 'yarn.lock'))) return 'yarn'
  if (existsSync(path.join(directory, 'package-lock.json'))) return 'npm'
  if (existsSync(path.join(directory, 'package.json'))) return 'npm'
  return undefined
}

const toGithubUrl = (remoteUrl: string) => {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '')
  const sshMatch = /^git@github\.com:([^/]+)\/(.+)$/.exec(trimmed)
  if (sshMatch) return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`

  const sshProtocolMatch = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/.exec(trimmed)
  if (sshProtocolMatch) return `https://github.com/${sshProtocolMatch[1]}/${sshProtocolMatch[2]}`

  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/(.+)$/.exec(trimmed)
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}`

  return undefined
}

const detectGithubUrl = (directory: string) => {
  const gitConfigPath = path.join(directory, '.git', 'config')
  if (!existsSync(gitConfigPath)) return undefined

  try {
    const config = readFileSync(gitConfigPath, 'utf8')
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

export const scanProjectDirectories = (
  scanDirectories: string[],
  hiddenPaths: string[],
  thirdPartyPaths: string[]
): ScanResult => {
  const failures: ScanFailure[] = []
  const projects = new Map<string, ProjectRecord>()
  const normalizedHidden = hiddenPaths.map(normalizePath)
  const normalizedThirdParty = thirdPartyPaths.map(normalizePath)
  const now = new Date().toISOString()

  const visit = (directory: string, depth: number, scanRoot: string) => {
    const normalized = normalizePath(directory)
    if (isInsideAny(normalized, normalizedHidden)) return

    let entries: string[]
    try {
      entries = readdirSync(directory)
    } catch (error) {
      failures.push({ path: normalized, message: error instanceof Error ? error.message : String(error) })
      return
    }

    const stat = statSync(directory)
    if (hasAnyMarker(directory)) {
      projects.set(normalized, {
        path: normalized,
        name: getProjectName(directory, scanRoot),
        status: 'unknown',
        priority: 'none',
        notes: '',
        source: isInsideAny(normalized, normalizedThirdParty) ? 'third-party' : 'first-party',
        packageManager: detectPackageManager(directory),
        githubUrl: detectGithubUrl(directory),
        hasGit: existsSync(path.join(directory, '.git')),
        hasPackageJson: existsSync(path.join(directory, 'package.json')),
        hasReadme: entries.some((entry) => entry.toLowerCase().startsWith('readme.')),
        lastModifiedAt: stat.mtime.toISOString(),
        lastScannedAt: now
      })
      return
    }

    if (depth >= 4) return

    for (const entry of entries) {
      if (entry.startsWith('.') || SKIP_NAMES.has(entry)) continue
      const next = path.join(directory, entry)
      try {
        if (statSync(next).isDirectory()) visit(next, depth + 1, scanRoot)
      } catch (error) {
        failures.push({ path: normalizePath(next), message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  for (const directory of scanDirectories) {
    const normalized = normalizePath(directory)
    try {
      const stat = statSync(directory)
      if (!stat.isDirectory()) {
        failures.push({ path: normalized, message: 'Path is not a directory.' })
        continue
      }
      visit(directory, 0, directory)
    } catch (error) {
      failures.push({ path: normalized, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    snapshot: {
      scannedAt: now,
      projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)),
      failures
    },
    failures
  }
}
