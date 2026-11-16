import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
// electron-updater exposes `autoUpdater` as a lazy getter on a CommonJS module,
// which Node's ESM named-export detection cannot see. Default import or bust.
import electronUpdater from 'electron-updater'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { startUpdateCheck } from './autoUpdate.js'
import { APP_NAME, EXTERNAL_CHANGE_POLL_MS, createIpcHandlers, type CallContext } from './ipcHandlers.js'
import { DATABASE_FILE_NAME, StateRepository } from './storage/stateRepository.js'
import { assertTrustedSenderUrl, isAppPageUrl } from './trustedSender.js'
import { IPC_CHANNELS } from '../src/shared/bridgeApi.js'
import { isWebUrl } from '../src/shared/projectTypes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL
const bundledPagePath = path.join(app.getAppPath(), 'out/renderer/index.html')
const appPageUrl = devServerUrl ?? pathToFileURL(bundledPagePath).href

let mainWindow: BrowserWindow | null = null
// Runs recorded as running before this moment belong to a process that is gone.
const APP_STARTED_AT = new Date().toISOString()
let stateRepository: StateRepository

app.setName(APP_NAME)

// Point a test run at a throwaway database instead of the user's real one
// (smoke test, corrupt-DB check). Must run before anything reads userData.
const userDataOverride = process.env.PROJECT_TRACKER_USER_DATA
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride))

// Packaged/hardened-runtime builds on some Apple Silicon GPUs garble glyph
// rasterization (correct DOM, scrambled on-screen text). Software compositing
// renders correctly, so disable hardware acceleration. Must run before app ready.
app.disableHardwareAcceleration()

const getIconPath = () => path.join(app.getAppPath(), 'assets/app-icon.png')

const assertTrustedSender = (event: Electron.IpcMainInvokeEvent) =>
  assertTrustedSenderUrl(event.senderFrame?.url, appPageUrl)

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

  mainWindow.webContents.on('found-in-page', (_event, result) => {
    mainWindow?.webContents.send('page-find:result', { activeMatchOrdinal: result.activeMatchOrdinal, matches: result.matches })
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppPageUrl(url, appPageUrl)) return

    event.preventDefault()
    if (isWebUrl(url)) void shell.openExternal(url)
  })

  await mainWindow.loadURL(appPageUrl)
}

// The menu is built before the repository exists, so both handlers guard it.
const backUpDatabaseNow = () => {
  if (!stateRepository) return
  try {
    const snapshotPath = stateRepository.backUpNow()
    shell.showItemInFolder(snapshotPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Backup failed', message)
  }
}

const showBackupsInFinder = async () => {
  if (!stateRepository) return
  const snapshotsPath = stateRepository.snapshotsDirectory
  try {
    // openPath fails on a missing directory, and the first launch has no snapshot yet.
    mkdirSync(snapshotsPath, { recursive: true })
    const openError = await shell.openPath(snapshotsPath)
    if (openError) throw new Error(openError)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('Could not show backups', message)
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
        submenu: [
          { label: 'Back Up Database Now', click: backUpDatabaseNow },
          { label: 'Show Backups in Finder', click: showBackupsInFinder },
          { type: 'separator' },
          { role: 'close' }
        ]
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
  ipcMain.handle('page-find:search', (event, text: unknown, forward: unknown, next: unknown) => {
    assertTrustedSender(event)
    if (typeof text !== 'string' || !text) return
    event.sender.findInPage(text, { forward: forward !== false, findNext: next === true })
  })
  ipcMain.handle('page-find:stop', (event) => {
    assertTrustedSender(event)
    event.sender.stopFindInPage('clearSelection')
  })

  ipcMain.handle('theme:set-native', (event, type: unknown) => {
    assertTrustedSender(event)
    if (type !== 'light' && type !== 'dark') throw new Error('Invalid theme type.')
    // Drives the macOS traffic-light glyph contrast so the controls stay legible
    // against dark themes; the strip color itself is handled in renderer CSS.
    nativeTheme.themeSource = type
  })

  const handlers = createIpcHandlers({
    homeDirectory: app.getPath('home'),
    startedAt: APP_STARTED_AT,
    pickDirectory: async () => {
      const options = {
        title: 'Choose a project folder',
        properties: ['openDirectory', 'createDirectory']
      } satisfies Electron.OpenDialogOptions
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
    writeClipboard: (text) => clipboard.writeText(text),
    openPath: (folderPath) => shell.openPath(folderPath)
  })

  for (const channel of IPC_CHANNELS) {
    const handler = handlers[channel]
    ipcMain.handle(channel, (event, payload: unknown) => {
      assertTrustedSender(event)
      const sender = event.sender
      const context: CallContext = {
        repository: stateRepository,
        onAgentRetry: (notice) => {
          if (!sender.isDestroyed()) sender.send('ticket:agent-retry', notice)
        }
      }
      return handler(payload, context)
    })
  }
}

app.whenReady().then(async () => {
  app.dock?.setIcon(getIconPath())
  app.setAboutPanelOptions({ applicationName: APP_NAME, iconPath: getIconPath() })
  configureApplicationMenu()
  const userDataPath = app.getPath('userData')
  try {
    stateRepository = new StateRepository(userDataPath)
  } catch (error) {
    // Without this the rejection is swallowed by whenReady: no window, the app
    // just sits in the Dock. Recovery stays manual — never move the user's file.
    const databasePath = path.join(userDataPath, DATABASE_FILE_NAME)
    const reason = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox(
      `${APP_NAME} could not open its database`,
      `${databasePath}\n\n${reason}\n\nThe file was left untouched. The app will quit; move the file aside to start fresh, or restore a backup, then reopen it.`
    )
    app.quit()
    return
  }
  registerIpc()
  await createWindow()

  setInterval(() => {
    const window = mainWindow
    const windowIsOpen = window !== null && !window.isDestroyed()
    if (windowIsOpen && stateRepository.hasExternalChanges()) {
      window.webContents.send('project-state:external-change')
    }
  }, EXTERNAL_CHANGE_POLL_MS)

  // ponytail: electron-updater's defaults already download in the background
  // and swap the app in on quit, with a native notification once it lands.
  // Add a restart-now prompt if waiting for the next quit proves too slow.
  if (app.isPackaged) startUpdateCheck(electronUpdater.autoUpdater)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
