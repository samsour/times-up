import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, shell, powerMonitor } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import fs from 'node:fs'
import crypto from 'node:crypto'

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
    win.loadURL('http://localhost:5173?win=popover')
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'), { query: { win: 'popover' } })
  }

  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) {
      win.hide()
    }
  })
}

// View the standalone window should show once it has loaded; the renderer
// picks it up through window:getInfo, or via view:set when already open
let pendingStandaloneView = null

function openStandaloneWindow(view = null) {
  if (standaloneWin) {
    standaloneWin.show()
    standaloneWin.focus()
    syncTimerOnce()
    if (view) standaloneWin.webContents.send('view:set', view)
    return
  }
  pendingStandaloneView = view

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
    standaloneWin.loadURL('http://localhost:5173?win=window')
  } else {
    standaloneWin.loadFile(path.join(__dirname, '../../dist/index.html'), { query: { win: 'window' } })
  }

  standaloneWin.once('ready-to-show', () => { standaloneWin.show(); syncTimerOnce() })

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
    syncTimerOnce()
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
    if (isDev) console.log(`[timer] synced, next in ${timerPollInterval() / 1000}s (${anyWindowVisible() ? 'window visible' : activeTimer ? 'timer running' : 'idle'})`)
    currentEntry = data || null
    activeTimer = data
      ? { start: parseInt(data.start), label: (data.task?.name || data.description || '').slice(0, 30) }
      : null
  } catch {}
  updateTrayTitle()
}

let lastTimerSync = 0

function syncTimerOnce() {
  if (!timerSync) {
    lastTimerSync = Date.now()
    timerSync = syncTimer().finally(() => { timerSync = null })
  }
  return timerSync
}

// The running-timer poll is the app's only steady API traffic, so its pace
// follows how likely the answer is to matter: fast while someone is
// looking, slower with just the tray title to keep, slowest when nothing
// is running or the machine sits unused. Windows force a sync on show.
function anyWindowVisible() {
  return (win && !win.isDestroyed() && win.isVisible()) ||
    (standaloneWin && !standaloneWin.isDestroyed() && standaloneWin.isVisible() && !standaloneWin.isMinimized())
}

function timerPollInterval() {
  if (powerMonitor.getSystemIdleTime() > 10 * 60) return 5 * 60_000
  if (anyWindowVisible()) return 10_000
  if (activeTimer) return 30_000
  return 60_000
}

function pollTimerIfDue() {
  if (Date.now() - lastTimerSync >= timerPollInterval()) syncTimerOnce()
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
  tray.on('click', () => {
    if (store.get('open_as_window')) openStandaloneWindow()
    else toggleWindow()
  })

  syncTimerOnce()
  setInterval(updateTrayTitle, 10_000)
  setInterval(pollTimerIfDue, 10_000)
  // Catch up right away after sleep or a locked screen instead of waiting
  // for the next slow interval
  powerMonitor.on('resume', syncTimerOnce)
  powerMonitor.on('unlock-screen', syncTimerOnce)

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
// Both windows keep their own copy of settings in memory, so every change
// is broadcast and each renderer applies what it cares about
ipcMain.handle('store:set', (_, key, value) => {
  store.set(key, value)
  broadcast('store:changed', { key, value })
})
ipcMain.handle('store:delete', (_, key) => {
  store.delete(key)
  broadcast('store:changed', { key, value: undefined })
})

// Workspace structure (spaces, folders, lists, members) changes rarely but
// is walked by several views in both windows; one shared cache in main
// turns those ~30-request walks into one per few minutes. Any write
// clears it so a list created from the app shows up right away.
const STRUCTURE_TTL = 5 * 60_000
const STRUCTURE_RE = /^\/team(\/\d+\/space)?(\?|$)|^\/space\/\d+\/(folder|list)(\?|$)|^\/folder\/\d+\/list(\?|$)|^\/list\/\d+(\?|$)/
const structureCache = new Map() // path -> { at, data }

// IPC: ClickUp API proxy (avoids CORS, keeps token in main process)
ipcMain.handle('clickup:request', async (_, { method = 'GET', path, body }) => {
  const token = store.get('clickup_token')
  if (!token) throw new Error('No API token set')

  const cacheable = method === 'GET' && STRUCTURE_RE.test(path)
  if (cacheable) {
    const hit = structureCache.get(path)
    if (hit && Date.now() - hit.at < STRUCTURE_TTL) return hit.data
  } else if (method !== 'GET') {
    structureCache.clear()
  }

  // Rate-limit bursts degrade into a short wait instead of an error:
  // retry 429s up to 3 times, honoring Retry-After when ClickUp sends it
  const t0 = Date.now()
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
      if (isDev) console.log(`[api] 429 ${method} ${path} retry in ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      continue
    }

    const data = await res.json().catch(() => ({}))
    if (isDev) console.log(`[api] ${res.status} ${method} ${path.split('?')[0]} ${Date.now() - t0}ms`)
    if (!res.ok) throw new Error(data.err || `HTTP ${res.status}`)
    if (cacheable) structureCache.set(path, { at: Date.now(), data })
    return data
  }
})

// IPC: archived time entries (Toggl CSV exports) fetched from plain share
// links. Files are cached on disk so Reports doesn't hit the network on
// every range change; force re-downloads regardless of age.
const ARCHIVE_MAX_AGE = 24 * 3600 * 1000

// Turns the share links people actually paste into direct-download URLs
function directDownloadUrl(url) {
  let m
  if ((m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/))) {
    const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1]
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`
  }
  if ((m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]+)/))) {
    return `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t`
  }
  if ((m = url.match(/^https?:\/\/(?:www\.)?dropbox\.com\/(.+)$/))) {
    return `https://www.dropbox.com/${m[1].replace(/[?&]dl=0/, '')}${m[1].includes('?') ? '&' : '?'}dl=1`
  }
  return url
}

function archiveDir() {
  const dir = path.join(app.getPath('userData'), 'archive')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function loadArchiveFile(url, force) {
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)
  const file = path.join(archiveDir(), `${key}.csv`)
  const metaFile = path.join(archiveDir(), `${key}.json`)
  let meta = null
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) } catch {}
  const fresh = meta && fs.existsSync(file) && Date.now() - meta.fetchedAt < ARCHIVE_MAX_AGE

  if (!fresh || force) {
    try {
      const res = await fetch(directDownloadUrl(url), { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      const type = res.headers.get('content-type') || ''
      // A login or "confirm download" page means the link isn't public
      if (type.includes('text/html') || /^\s*<(!doctype|html)/i.test(text)) {
        throw new Error('Link is not publicly downloadable')
      }
      fs.writeFileSync(file, text)
      meta = { url, fetchedAt: Date.now(), bytes: text.length }
      fs.writeFileSync(metaFile, JSON.stringify(meta))
      return { url, text, fetchedAt: meta.fetchedAt, error: null }
    } catch (e) {
      // Fall back to a stale copy if there is one
      if (meta && fs.existsSync(file)) {
        return { url, text: fs.readFileSync(file, 'utf8'), fetchedAt: meta.fetchedAt, error: e.message }
      }
      return { url, text: null, fetchedAt: null, error: e.message }
    }
  }
  return { url, text: fs.readFileSync(file, 'utf8'), fetchedAt: meta.fetchedAt, error: null }
}

// A line in the archive setting is either a ClickUp task (link or id) whose
// CSV attachments are the archive, or a direct link to a CSV
function parseTaskRef(line) {
  let m
  if ((m = line.match(/app\.clickup\.com\/t\/(?:\d+\/)?([a-z0-9]+)/i))) return m[1]
  if ((m = line.match(/^#?([a-z0-9]{6,})$/i)) && !/^https?:/i.test(line)) return m[1]
  return null
}

async function expandArchiveSources(lines) {
  const token = store.get('clickup_token')
  const out = []
  for (const line of lines) {
    const taskId = parseTaskRef(line)
    if (!taskId) {
      if (/^https?:\/\//.test(line)) out.push({ url: line, label: line })
      continue
    }
    try {
      const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, { headers: { Authorization: token } })
      if (!res.ok) throw new Error(`task ${taskId}: HTTP ${res.status}`)
      const task = await res.json()
      const csvs = (task.attachments || []).filter(a => /\.csv$/i.test(a.title || '') && a.url)
      if (!csvs.length) out.push({ url: null, label: task.name, error: 'Task has no CSV attachments' })
      for (const a of csvs) out.push({ url: a.url, label: a.title })
    } catch (e) {
      out.push({ url: null, label: line, error: e.message })
    }
  }
  return out
}

// Archive tasks are found by tag, workspace-wide, so nobody has to paste a
// link: every task tagged like this that the user can see is a source.
const ARCHIVE_TAG = 'timesup-archive'

async function discoverArchiveTasks() {
  const token = store.get('clickup_token')
  const teamId = store.get('team_id')
  if (!token || !teamId) return []
  const params = new URLSearchParams({ include_closed: 'true', subtasks: 'true' })
  params.append('tags[]', ARCHIVE_TAG)
  const res = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/task?${params}`, { headers: { Authorization: token } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { tasks } = await res.json()
  return (tasks || []).map(t => ({ id: t.id, name: t.name, url: t.url, listName: t.list?.name }))
}

ipcMain.handle('archive:discover', async () => {
  const tasks = await discoverArchiveTasks()
  // attachment counts need the task detail
  const token = store.get('clickup_token')
  return Promise.all(tasks.map(async t => {
    try {
      const res = await fetch(`https://api.clickup.com/api/v2/task/${t.id}`, { headers: { Authorization: token } })
      const task = await res.json()
      const csvCount = (task.attachments || []).filter(a => /\.csv$/i.test(a.title || '')).length
      return { ...t, csvCount }
    } catch {
      return { ...t, csvCount: 0 }
    }
  }))
})

ipcMain.handle('archive:createTask', async (_, { listId }) => {
  const token = store.get('clickup_token')
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'TimesUp · Time tracking archive',
      tags: [ARCHIVE_TAG],
      description:
        'Managed by TimesUp. Attach Toggl "detailed report" CSV exports to this task; ' +
        'TimesUp reads every CSV attached here into its Reports. ' +
        'The tag marks the task as an archive source, keep it.',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.err || `HTTP ${res.status}`)
  structureCache.clear()
  return { id: data.id, name: data.name, url: data.url }
})

ipcMain.handle('archive:load', async (_, { force = false } = {}) => {
  const lines = String(store.get('archive_urls') || '')
    .split(/\s+/)
    .map(u => u.trim())
    .filter(Boolean)
  let discovered = []
  try { discovered = await discoverArchiveTasks() } catch (e) { discovered = [{ id: null, name: 'Archive lookup', error: e.message }] }
  const manual = await expandArchiveSources(lines)
  const tagged = await expandArchiveSources(discovered.filter(t => t.id).map(t => t.id))
  const sources = [
    ...discovered.filter(t => !t.id).map(t => ({ url: null, label: t.name, error: t.error })),
    ...tagged,
    ...manual.filter(m => !tagged.some(t => t.url === m.url)),
  ]
  return Promise.all(sources.map(async src => {
    if (!src.url) return { url: src.label, label: src.label, text: null, fetchedAt: null, error: src.error }
    const r = await loadArchiveFile(src.url, force)
    return { ...r, label: src.label }
  }))
})

// The renderer reads the tray poll's cached timer instead of polling the
// API itself; force asks for a fresh fetch right now (after start/stop).
ipcMain.handle('clickup:currentTimer', async (_, opts) => {
  if (opts?.force) await syncTimerOnce()
  return currentEntry
})

ipcMain.handle('window:hide', () => win.hide())
ipcMain.handle('window:getInfo', (e) => {
  const kind = standaloneWin && e.sender === standaloneWin.webContents ? 'window' : 'popover'
  const view = kind === 'window' ? pendingStandaloneView : null
  pendingStandaloneView = null
  return { kind, view }
})
ipcMain.handle('window:openStandalone', (_, view) => openStandaloneWindow(view || null))
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
