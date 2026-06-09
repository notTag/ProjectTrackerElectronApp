import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanProjectDirectories } from './scanner/projectScanner.js'
import { StateRepository } from './storage/stateRepository.js'
import type { ProjectTrackerState } from '../src/shared/projectTypes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const allowedDevOrigin = 'http://127.0.0.1:5173'
const APP_NAME = 'Project Tracker'

let mainWindow: BrowserWindow | null = null
let stateRepository: StateRepository

app.setName(APP_NAME)

const normalizePath = (value: string) => path.resolve(value).split(path.sep).join(path.posix.sep)
const toPlainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const getIconPath = () => path.join(app.getAppPath(), 'assets/app-icon.png')

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
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

  ipcMain.handle('project:open-shell', async (event, projectPath: unknown) => {
    assertTrustedSender(event)
    if (typeof projectPath !== 'string') throw new Error('Invalid project path.')
    const normalized = normalizePath(projectPath)

    try {
      if (process.platform === 'darwin') {
        const shellPath = process.env.SHELL || '/bin/zsh'
        const command = `cd ${shellQuote(normalized)} && exec ${shellQuote(shellPath)} -l`
        spawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(command)}`], {
          detached: true,
          stdio: 'ignore'
        }).unref()
      } else {
        await shell.openPath(normalized)
      }
      return { ok: true }
    } catch {
      const fallbackCommand = `cd ${JSON.stringify(normalized)}`
      clipboard.writeText(fallbackCommand)
      return { ok: true, fallbackCommand }
    }
  })

  ipcMain.handle('project:read-readme', (event, projectPath: unknown) => {
    assertTrustedSender(event)
    if (typeof projectPath !== 'string') throw new Error('Invalid project path.')
    const normalized = normalizePath(projectPath)
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
