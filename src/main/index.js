import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, shell, powerMonitor } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const store = new Store()

app.setName('TimesUp')

let tray = null
let win = null
let standaloneWin = null

const isDev = !app.isPackaged

// 'idle' | 'checking' | 'downloading' | 'ready'
let updateState = 'idle'

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

function broadcast(channel, payload) {
  for (const w of [win, standaloneWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function setUpdateState(state) {
  updateState = state
  broadcast('update:stateChange', state)
}

autoUpdater.on('checking-for-update', () => setUpdateState('checking'))
autoUpdater.on('update-not-available', () => setUpdateState('idle'))
autoUpdater.on('error', () => setUpdateState('idle'))
autoUpdater.on('download-progress', () => setUpdateState('downloading'))
autoUpdater.on('update-downloaded', () => setUpdateState('ready'))

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) {
      win.hide()
    }
  })
}

function openStandaloneWindow() {
  if (standaloneWin) {
    standaloneWin.show()
    standaloneWin.focus()
    return
  }

  const savedBounds = store.get('standalone_bounds')
  standaloneWin = new BrowserWindow({
    width: savedBounds?.width || 420,
    height: savedBounds?.height || 640,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 340,
    minHeight: 480,
    show: false,
    title: 'TimesUp',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (isDev) {
    standaloneWin.loadURL('http://localhost:5173')
  } else {
    standaloneWin.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  standaloneWin.once('ready-to-show', () => standaloneWin.show())

  if (process.platform === 'darwin') app.dock?.show()

  standaloneWin.on('close', () => {
    store.set('standalone_bounds', standaloneWin.getBounds())
  })
  standaloneWin.on('closed', () => {
    standaloneWin = null
    if (process.platform === 'darwin') app.dock?.hide()
  })
}

function positionWindow() {
  const trayBounds = tray.getBounds()
  const winBounds = win.getBounds()
  const display = screen.getPrimaryDisplay()

  // Position below tray icon (mac) or above (windows)
  let x = Math.round(trayBounds.x + (trayBounds.width / 2) - (winBounds.width / 2))
  let y

  if (process.platform === 'darwin') {
    y = Math.round(trayBounds.y + trayBounds.height + 4)
  } else {
    y = Math.round(trayBounds.y - winBounds.height - 4)
  }

  // Keep on screen
  const { workArea } = display
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - winBounds.width))

  win.setPosition(x, y, false)
}

function toggleWindow() {
  if (win.isVisible()) {
    win.hide()
  } else {
    positionWindow()
    win.show()
    win.focus()
  }
}

let activeTimer = null // { start: number, label: string }
let currentEntry = null // full API entry, served to the renderer's poll
let timerSync = null // in-flight sync, so forced refreshes coalesce

async function syncTimer() {
  const token = store.get('clickup_token')
  const teamId = store.get('team_id')
  if (!token || !teamId) { activeTimer = null; currentEntry = null; updateTrayTitle(); return }
  try {
    const res = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/time_entries/current`, {
      headers: { Authorization: token }
    })
    // Keep the last known state on errors (e.g. 429) instead of flickering
    if (!res.ok) { updateTrayTitle(); return }
    const { data } = await res.json()
    currentEntry = data || null
    activeTimer = data
      ? { start: parseInt(data.start), label: (data.task?.name || data.description || '').slice(0, 30) }
      : null
  } catch {}
  updateTrayTitle()
}

function syncTimerOnce() {
  if (!timerSync) timerSync = syncTimer().finally(() => { timerSync = null })
  return timerSync
}

function updateTrayTitle() {
  if (!tray) return
  if (activeTimer) {
    const sec = Math.floor((Date.now() - activeTimer.start) / 1000)
    const h = Math.floor(sec / 3600).toString()
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0')
    tray.setTitle(activeTimer.label ? `${h}:${m}  ${activeTimer.label}` : `${h}:${m}`)
  } else {
    tray.setTitle(store.get('idleText') || 'not tracking rn')
  }
}

function createTray() {
  const assetsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../src/assets')
  const iconFile = isDev ? 'icon-dev.png' : 'icon.png'
  const icon = nativeImage.createFromPath(path.join(assetsPath, iconFile))
    .resize({ width: 18, height: 18 })
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('TimesUp')
  tray.on('click', toggleWindow)

  syncTimerOnce()
  setInterval(updateTrayTitle, 10_000)
  setInterval(syncTimerOnce, 10_000)

  // Right-click menu for quitting
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Open', click: toggleWindow },
      { label: 'Open in Window', click: openStandaloneWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
    tray.popUpContextMenu(menu)
  })
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }
  createWindow()
  createTray()
  if (!isDev) autoUpdater.checkForUpdatesAndNotify()
})

app.on('window-all-closed', (e) => {
  e.preventDefault() // keep running in tray
})

// IPC: persisted settings
ipcMain.handle('store:get', (_, key) => store.get(key))
ipcMain.handle('store:set', (_, key, value) => store.set(key, value))
ipcMain.handle('store:delete', (_, key) => store.delete(key))

// IPC: ClickUp API proxy (avoids CORS, keeps token in main process)
ipcMain.handle('clickup:request', async (_, { method = 'GET', path, body }) => {
  const token = store.get('clickup_token')
  if (!token) throw new Error('No API token set')

  // Rate-limit bursts degrade into a short wait instead of an error:
  // retry 429s up to 3 times, honoring Retry-After when ClickUp sends it
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
      method,
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })

    if (res.status === 429 && attempt < 3) {
      const after = parseFloat(res.headers.get('retry-after'))
      const waitMs = Math.min((after > 0 ? after : 2 ** attempt) * 1000, 30_000)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      continue
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.err || `HTTP ${res.status}`)
    return data
  }
})

// The renderer reads the tray poll's cached timer instead of polling the
// API itself; force asks for a fresh fetch right now (after start/stop).
ipcMain.handle('clickup:currentTimer', async (_, opts) => {
  if (opts?.force) await syncTimerOnce()
  return currentEntry
})

ipcMain.handle('window:hide', () => win.hide())
ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())
ipcMain.handle('update:check', () => { if (updateState === 'idle') autoUpdater.checkForUpdates() })
ipcMain.handle('update:getState', () => updateState)
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))
ipcMain.handle('app:getLoginItemSettings', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('app:setLoginItemSettings', (_, openAtLogin) => app.setLoginItemSettings({ openAtLogin }))
ipcMain.handle('idle:dismiss', () => { idlePromptShown = false })

let idlePromptShown = false
setInterval(() => {
  if (!win || idlePromptShown) return
  const enabled = store.get('idleDetection')
  if (!enabled) return
  const thresholdMins = store.get('idleThreshold') || 5
  const idleSeconds = powerMonitor.getSystemIdleTime()
  if (idleSeconds >= thresholdMins * 60) {
    idlePromptShown = true
    broadcast('idle:detected', idleSeconds)
  }
}, 15000)
