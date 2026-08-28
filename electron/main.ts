import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { execFile } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanProjectDirectories } from './scanner/projectScanner.js'
import { StateRepository } from './storage/stateRepository.js'
import { findOpenInTarget } from '../src/shared/openInTargets.js'
import type { ProjectTrackerState } from '../src/shared/projectTypes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const allowedDevOrigin = 'http://127.0.0.1:5173'
const APP_NAME = 'Project Tracker'

let mainWindow: BrowserWindow | null = null
let stateRepository: StateRepository

app.setName(APP_NAME)

// Packaged/hardened-runtime builds on some Apple Silicon GPUs garble glyph
// rasterization (correct DOM, scrambled on-screen text). Software compositing
// renders correctly, so disable hardware acceleration. Must run before app ready.
app.disableHardwareAcceleration()

const normalizePath = (value: string) => path.resolve(value).split(path.sep).join(path.posix.sep)
const toPlainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
// Hand a folder to a macOS app via Launch Services. Resolves on a successful
// hand-off; rejects (non-zero exit) when the app isn't installed, which the
// caller turns into the clipboard fallback. Arg-array exec — no shell, so the
// path can't be interpreted as a command.
const openWithApp = (appName: string, target: string) =>
  new Promise<void>((resolve, reject) => {
    execFile('open', ['-a', appName, target], (error) => (error ? reject(error) : resolve()))
  })
const getIconPath = () => path.join(app.getAppPath(), 'assets/app-icon.png')
const isHttpUrl = (value: string) => value.startsWith('https://') || value.startsWith('http://')

// Packaged apps launched from Finder/Launch Services don't inherit the user's
// shell PATH, so `gh` won't resolve by name. Probe the common install locations.
const GH_BIN_CANDIDATES = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']

const runGhAuthToken = (bin: string) =>
  new Promise<string | undefined>((resolve) => {
    execFile(bin, ['auth', 'token'], { timeout: 5000 }, (error, stdout) => {
      if (error) return resolve(undefined)
      resolve(stdout.trim() || undefined)
    })
  })

// Resolve a GitHub token so private repos (which the API hides behind a 404 when
// unauthenticated) can be fetched. Prefer an explicit env token, then fall back
// to the signed-in `gh` CLI. Cached once found; absence is re-probed each call.
let cachedGithubToken: string | undefined
const resolveGithubToken = async (): Promise<string | undefined> => {
  if (cachedGithubToken) return cachedGithubToken
  const fromEnv = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
  if (fromEnv) {
    cachedGithubToken = fromEnv
    return cachedGithubToken
  }
  for (const bin of GH_BIN_CANDIDATES) {
    const token = await runGhAuthToken(bin)
    if (token) {
      cachedGithubToken = token
      return token
    }
  }
  return undefined
}

const parseGithubRepo = (githubUrl: string) => {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/.exec(githubUrl.trim())
  if (!match) throw new Error('Not a recognized GitHub repository URL.')
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') }
}

// Single door to the GitHub REST API so auth, headers and the status-to-message
// mapping stay identical for every caller.
const requestGithub = async <T>(apiPath: string): Promise<T> => {
  const token = await resolveGithubToken()
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': APP_NAME
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`https://api.github.com${apiPath}`, { headers })
  if (response.status === 404) {
    throw new Error(
      token
        ? 'Repository not found on GitHub.'
        : 'Repository not found. If it is private, sign in with the GitHub CLI (gh auth login) or set GITHUB_TOKEN.'
    )
  }
  if (response.status === 401) throw new Error('GitHub rejected the token. Re-run gh auth login or update GITHUB_TOKEN.')
  if (response.status === 403) throw new Error('GitHub rate limit reached. Try again in a while.')
  if (!response.ok) throw new Error(`GitHub request failed (HTTP ${response.status}).`)
  return (await response.json()) as T
}

const isInsideAny = (target: string, parents: string[]) =>
  parents.some((parent) => target === parent || target.startsWith(`${parent}/`))

const assertScannedProjectPath = (projectPath: string) => {
  const normalized = normalizePath(projectPath)
  const scanDirectories = stateRepository.getState().scanDirectories.map(normalizePath)
  if (!isInsideAny(normalized, scanDirectories)) {
    throw new Error('Project path is outside configured scan directories.')
  }
  return normalized
}

const assertTrustedSender = (event: Electron.IpcMainInvokeEvent) => {
  const senderUrl = event.senderFrame?.url
  if (!senderUrl) throw new Error('Rejected IPC call from an unknown renderer frame.')
  if (devServerUrl && senderUrl.startsWith(allowedDevOrigin)) return
  if (!devServerUrl && senderUrl.startsWith('file://')) return
  throw new Error('Rejected IPC call from an unexpected renderer origin.')
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const isProjectTrackerState = (value: unknown): value is ProjectTrackerState => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as ProjectTrackerState
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.updatedAt === 'string' &&
    isStringArray(candidate.scanDirectories) &&
    isStringArray(candidate.hiddenPaths) &&
    isStringArray(candidate.thirdPartyPaths) &&
    !!candidate.snapshot &&
    Array.isArray(candidate.snapshot.projects)
  )
}

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 680,
    title: 'Project Tracker',
    icon: getIconPath(),
    backgroundColor: '#f7f7f2',
    // Hide the native title bar so the renderer paints a themed strip into that
    // space; the traffic lights stay and are inset to sit inside the strip.
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 17 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedDevNavigation = !!devServerUrl && url.startsWith(allowedDevOrigin)
    const allowedFileNavigation = !devServerUrl && url.startsWith('file://')
    if (allowedDevNavigation || allowedFileNavigation) return

    event.preventDefault()
    if (isHttpUrl(url)) void shell.openExternal(url)
  })

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'))
  }
}

const configureApplicationMenu = () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: `About ${APP_NAME}` },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide', label: `Hide ${APP_NAME}` },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: `Quit ${APP_NAME}` }
        ]
      },
      {
        label: 'File',
        submenu: [{ role: 'close' }]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      }
    ])
  )
}

const registerIpc = () => {
  ipcMain.handle('theme:set-native', (event, type: unknown) => {
    assertTrustedSender(event)
    if (type !== 'light' && type !== 'dark') throw new Error('Invalid theme type.')
    // Drives the macOS traffic-light glyph contrast so the controls stay legible
    // against dark themes; the strip color itself is handled in renderer CSS.
    nativeTheme.themeSource = type
  })

  ipcMain.handle('project-state:get', (event) => {
    assertTrustedSender(event)
    return toPlainJson(stateRepository.getState())
  })

  ipcMain.handle('project-state:save', (event, state: unknown) => {
    assertTrustedSender(event)
    if (!isProjectTrackerState(state)) throw new Error('Invalid project state payload.')
    return toPlainJson(stateRepository.saveState({
      ...state,
      scanDirectories: state.scanDirectories.map(normalizePath),
      hiddenPaths: state.hiddenPaths.map(normalizePath),
      thirdPartyPaths: state.thirdPartyPaths.map(normalizePath)
    }))
  })

  ipcMain.handle('projects:scan', (event, payload: unknown) => {
    assertTrustedSender(event)
    const candidate = payload as {
      scanDirectories?: unknown
      hiddenPaths?: unknown
      thirdPartyPaths?: unknown
    }
    if (
      !isStringArray(candidate.scanDirectories) ||
      !isStringArray(candidate.hiddenPaths) ||
      !isStringArray(candidate.thirdPartyPaths)
    ) {
      throw new Error('Invalid scan payload.')
    }

    return toPlainJson(scanProjectDirectories(
      candidate.scanDirectories.map(normalizePath),
      candidate.hiddenPaths.map(normalizePath),
      candidate.thirdPartyPaths.map(normalizePath)
    ))
  })

  ipcMain.handle('dialog:pick-scan-directory', async (event) => {
    assertTrustedSender(event)
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory']
    } satisfies Electron.OpenDialogOptions
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizePath(result.filePaths[0])
  })

  ipcMain.handle('project:open-in', async (event, payload: unknown) => {
    assertTrustedSender(event)
    const { projectPath, targetId, command } = (payload ?? {}) as {
      projectPath?: unknown
      targetId?: unknown
      command?: unknown
    }
    if (typeof projectPath !== 'string') throw new Error('Invalid project path.')
    if (typeof targetId !== 'string') throw new Error('Invalid open-in target.')
    // Resolve against the shared allowlist so only known apps are ever launched.
    const target = findOpenInTarget(targetId)
    if (!target) throw new Error(`Unknown open-in target: ${targetId}`)
    const normalized = assertScannedProjectPath(projectPath)

    // The clipboard is the hand-off: allowlisted apps are launched with `open -a`,
    // which takes a directory and no argv, so a command cannot be passed to the
    // shell directly. Nothing here is ever executed — the caller pastes it.
    // ponytail: clipboard hand-off, swap for per-app osascript if pasting grates.
    const copiedCommand = typeof command === 'string' && command.trim() ? command : undefined
    if (copiedCommand) clipboard.writeText(copiedCommand)

    try {
      if (process.platform === 'darwin') {
        await openWithApp(target.appName, normalized)
      } else {
        await shell.openPath(normalized)
      }
      return { ok: true, appLabel: target.label, copiedCommand }
    } catch {
      const fallbackCommand = `cd ${JSON.stringify(normalized)}`
      clipboard.writeText(fallbackCommand)
      return { ok: true, appLabel: target.label, fallbackCommand }
    }
  })

  ipcMain.handle('project:fetch-github', async (event, githubUrl: unknown) => {
    assertTrustedSender(event)
    if (typeof githubUrl !== 'string') throw new Error('Invalid GitHub URL.')
    const { owner, repo } = parseGithubRepo(githubUrl)

    const data = await requestGithub<{
      default_branch?: string
      open_issues_count?: number
      stargazers_count?: number
      forks_count?: number
      description?: string | null
      pushed_at?: string
    }>(`/repos/${owner}/${repo}`)

    return toPlainJson({
      defaultBranch: data.default_branch ?? 'main',
      openIssues: data.open_issues_count ?? 0,
      stars: data.stargazers_count ?? 0,
      forks: data.forks_count ?? 0,
      description: data.description ?? undefined,
      pushedAt: data.pushed_at,
      fetchedAt: new Date().toISOString()
    })
  })

  ipcMain.handle('project:fetch-github-issues', async (event, githubUrl: unknown) => {
    assertTrustedSender(event)
    if (typeof githubUrl !== 'string') throw new Error('Invalid GitHub URL.')
    const { owner, repo } = parseGithubRepo(githubUrl)

    type GithubIssueResponse = {
      number: number
      title: string
      body?: string | null
      html_url: string
      pull_request?: unknown
    }

    // ponytail: 5 pages (500 open issues) is far past any board that stays
    // readable. Raise the cap if a real repo ever hits it.
    const MAX_PAGES = 5
    const PER_PAGE = 100
    const issues: GithubIssueResponse[] = []
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = `state=open&per_page=${PER_PAGE}&page=${page}`
      const batch = await requestGithub<GithubIssueResponse[]>(`/repos/${owner}/${repo}/issues?${query}`)
      issues.push(...batch)
      if (batch.length < PER_PAGE) break
    }

    // The issues endpoint returns pull requests too; only real issues become tickets.
    const issuesOnly = issues.filter((issue) => !issue.pull_request)
    return toPlainJson(
      issuesOnly.map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        htmlUrl: issue.html_url
      }))
    )
  })

  ipcMain.handle('project:read-readme', (event, projectPath: unknown) => {
    assertTrustedSender(event)
    if (typeof projectPath !== 'string') throw new Error('Invalid project path.')
    const normalized = assertScannedProjectPath(projectPath)
    if (!statSync(normalized).isDirectory()) throw new Error('Project path is not a directory.')

    const readmeName = readdirSync(normalized).find((entry) => /^readme(\.|$)/i.test(entry))
    if (!readmeName) return { content: null, fileName: null }

    const readmePath = path.join(normalized, readmeName)
    if (!statSync(readmePath).isFile()) return { content: null, fileName: null }
    return toPlainJson({ content: readFileSync(readmePath, 'utf8'), fileName: readmeName })
  })
}

app.whenReady().then(async () => {
  app.dock?.setIcon(getIconPath())
  app.setAboutPanelOptions({ applicationName: APP_NAME, iconPath: getIconPath() })
  configureApplicationMenu()
  stateRepository = await StateRepository.create(app.getPath('userData'))
  registerIpc()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
