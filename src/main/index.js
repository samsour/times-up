import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const store = new Store()

let tray = null
let win = null

const isDev = !app.isPackaged

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
    backgroundColor: '#0a0a0a',
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

async function syncTimer() {
  const token = store.get('clickup_token')
  const teamId = store.get('team_id')
  if (!token || !teamId) { activeTimer = null; updateTrayTitle(); return }
  try {
    const res = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/time_entries/current`, {
      headers: { Authorization: token }
    })
    const { data } = await res.json()
    activeTimer = data
      ? { start: parseInt(data.start), label: (data.task?.name || data.description || '').slice(0, 30) }
      : null
  } catch {
    activeTimer = null
  }
  updateTrayTitle()
}

function updateTrayTitle() {
  if (!tray) return
  if (activeTimer) {
    const sec = Math.floor((Date.now() - activeTimer.start) / 1000)
    const h = Math.floor(sec / 3600).toString().padStart(2, '0')
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0')
    tray.setTitle(activeTimer.label ? `${h}:${m}  ${activeTimer.label}` : `${h}:${m}`)
  } else {
    tray.setTitle('not tracking rn')
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../src/assets/icon.png'))
    .resize({ width: 18, height: 18 })
  icon.setTemplateImage(true)

  tray = new Tray(icon)
  tray.setToolTip('ClickUp Tracker')
  tray.on('click', toggleWindow)

  syncTimer()
  setInterval(updateTrayTitle, 10_000)
  setInterval(syncTimer, 10_000)

  // Right-click menu for quitting
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Open', click: toggleWindow },
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

  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    method,
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.err || `HTTP ${res.status}`)
  return data
})

ipcMain.handle('window:hide', () => win.hide())
