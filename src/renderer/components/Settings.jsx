import { useState, useEffect, useRef } from 'react'
import { getTimeEntries, getUser, getAllLists } from '../lib/clickup.js'
import { getGoals } from '../lib/goals.js'
import { loadArchive, clearArchiveCache } from '../lib/archive.js'
import { TONES, ACCENTS, loadAppearance, applyTone, applyAccent } from '../lib/theme.js'
import './Settings.css'

function pad(n) { return String(n).padStart(2, '0') }

function entriesToCSV(entries, user) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const headers = ['User','Email','Client','Project','Task','Description','Billable','Start date','Start time','Duration','Tags']
  const rows = entries.map(e => {
    const ms = parseInt(e.start)
    const dur = parseInt(e.duration)
    const d = new Date(ms)
    const s = Math.floor(dur / 1000)
    return [
      user?.username ?? '',
      user?.email ?? '',
      '',
      e.task?.list?.name ?? '',
      e.task?.list?.name ? (e.task?.name ?? '') : '',
      [e.task?.name, e.description].filter(Boolean).join(' · '),
      e.billable ? 'Yes' : 'No',
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
      `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`,
      (e.tags ?? []).map(t => t.name).join(', '),
    ].map(q).join(',')
  })
  return [headers.join(','), ...rows].join('\n')
}

function shortUrl(url) {
  try { return new URL(url).hostname } catch { return url.slice(0, 30) }
}

function downloadCSV(content, filename) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Settings({ teamId, theme, onThemeChange, font, onFontChange, onSignOut }) {
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [openAsWindow, setOpenAsWindow] = useState(false)
  const [tone, setTone] = useState('warm')
  const [accent, setAccent] = useState('coral')
  const [idleDetection, setIdleDetection] = useState(false)
  const [idleThreshold, setIdleThreshold] = useState(5)
  const [idleText, setIdleText] = useState('not tracking rn')
  const [weeklyGoalHours, setWeeklyGoalHours] = useState('')
  const [workdays, setWorkdays] = useState([1, 2, 3, 4, 5]) // getDay() numbers
  const [autoProgress, setAutoProgress] = useState(true)
  const [updateState, setUpdateState] = useState('idle')
  const [exportPreset, setExportPreset] = useState('week') // 'week' | 'month' | 'custom'
  const [exportFrom, setExportFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-01` })
  const [exportTo, setExportTo] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` })
  const [exporting, setExporting] = useState(false)
  const [archiveUrls, setArchiveUrls] = useState('')
  const [archiveStatus, setArchiveStatus] = useState(null) // { files, entries }
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveTasks, setArchiveTasks] = useState(null) // null = not looked up yet
  const [archiveAdvanced, setArchiveAdvanced] = useState(false)
  const [archiveLists, setArchiveLists] = useState([])
  const [archiveListId, setArchiveListId] = useState('')
  const [archiveCreating, setArchiveCreating] = useState(false)
  const [archiveError, setArchiveError] = useState('')
  const archiveSaveTimer = useRef(null)

  useEffect(() => {
    window.api.app.getLoginItemSettings().then(setAutoLaunch)
    window.api.store.get('open_as_window').then(v => setOpenAsWindow(!!v))
    loadAppearance().then(a => { setTone(a.tone); setAccent(a.accent) })
    const offStore = window.api.store.onChange(({ key, value }) => {
      if (key === 'tone') setTone(value || 'warm')
      if (key === 'accent') setAccent(value || 'coral')
      if (key === 'open_as_window') setOpenAsWindow(!!value)
      if (key === 'archive_urls') setArchiveUrls(value || '')
    })
    window.api.store.get('idleDetection').then(v => setIdleDetection(!!v))
    window.api.store.get('idleThreshold').then(v => setIdleThreshold(v || 5))
    window.api.store.get('idleText').then(v => setIdleText(v || 'not tracking rn'))
    getGoals().then(g => {
      setWeeklyGoalHours(g.weeklyH || '')
      setWorkdays(g.workdays)
    })
    window.api.store.get('auto_progress').then(v => setAutoProgress(v !== false))
    window.api.updater.getState().then(setUpdateState)
    window.api.store.get('archive_urls').then(v => {
      setArchiveUrls(v || '')
      if (v) setArchiveAdvanced(true)
    })
    discoverArchive().then(found => { if (found || archiveUrls) refreshArchive(false) })
    const offUpdater = window.api.updater.onStateChange(setUpdateState)
    return () => { offUpdater(); offStore() }
  }, [])

  // Finds tagged archive tasks; returns whether any exist
  async function discoverArchive() {
    try {
      const tasks = await window.api.archive.discover()
      setArchiveTasks(tasks)
      setArchiveError('')
      if (!tasks.length && !archiveLists.length) {
        getAllLists(teamId).then(ls => {
          setArchiveLists(ls || [])
          // default to the planning list when there is one, it's already the app's home in ClickUp
          window.api.store.get('planning_list_id').then(pid => {
            setArchiveListId(pid && ls.some(l => String(l.id) === String(pid)) ? String(pid) : (ls[0] ? String(ls[0].id) : ''))
          })
        }).catch(() => {})
      }
      return tasks.length > 0
    } catch (e) {
      setArchiveTasks([])
      setArchiveError(e.message)
      return false
    }
  }

  async function createArchiveTask() {
    if (!archiveListId) return
    setArchiveCreating(true)
    setArchiveError('')
    try {
      const task = await window.api.archive.createTask(archiveListId)
      await discoverArchive()
      window.api.shell.openExternal(task.url || `https://app.clickup.com/t/${task.id}`)
    } catch (e) {
      setArchiveError(e.message)
    } finally {
      setArchiveCreating(false)
    }
  }

  async function refreshArchive(force) {
    setArchiveLoading(true)
    try {
      if (force) { clearArchiveCache(); await discoverArchive() }
      const { files, entries } = await loadArchive(force)
      setArchiveStatus({ files, entries: entries.length })
    } catch (e) {
      setArchiveStatus({ files: [], entries: 0, error: e.message })
    } finally {
      setArchiveLoading(false)
    }
  }

  async function handleArchiveUrls(val) {
    setArchiveUrls(val)
    await window.api.store.set('archive_urls', val)
    clearArchiveCache()
    // Wait for typing/pasting to settle before downloading
    clearTimeout(archiveSaveTimer.current)
    archiveSaveTimer.current = setTimeout(() => refreshArchive(true), 800)
  }

  async function handleIdleText(val) {
    setIdleText(val)
    await window.api.store.set('idleText', val)
  }

  async function handleIdleDetection(val) {
    setIdleDetection(val)
    await window.api.store.set('idleDetection', val)
  }

  async function handleIdleThreshold(val) {
    const clamped = Math.max(1, Math.min(120, parseInt(val) || 1))
    setIdleThreshold(clamped)
    await window.api.store.set('idleThreshold', clamped)
  }

  async function handleExport() {
    const now = new Date()
    let start, end, label
    if (exportPreset === 'week') {
      const lastMon = new Date(now)
      lastMon.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7)
      lastMon.setHours(0, 0, 0, 0)
      const lastSun = new Date(lastMon)
      lastSun.setDate(lastMon.getDate() + 6)
      lastSun.setHours(23, 59, 59, 999)
      start = lastMon.getTime(); end = lastSun.getTime()
      label = `${lastMon.getFullYear()}-${pad(lastMon.getMonth()+1)}-${pad(lastMon.getDate())}-to-${lastSun.getFullYear()}-${pad(lastSun.getMonth()+1)}-${pad(lastSun.getDate())}`
    } else if (exportPreset === 'month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).getTime()
      const d = new Date(start)
      label = `${d.getFullYear()}-${pad(d.getMonth()+1)}`
    } else {
      start = new Date(exportFrom).getTime()
      end = new Date(`${exportTo}T23:59:59`).getTime()
      label = `${exportFrom}-to-${exportTo}`
    }
    setExporting(true)
    try {
      const [entries, user] = await Promise.all([getTimeEntries(teamId, start, end), getUser()])
      const completed = (entries || []).filter(e => parseInt(e.duration) > 0)
      downloadCSV(entriesToCSV(completed, user), `timesup-${label}.csv`)
    } catch {}
    setExporting(false)
  }

  async function toggleWorkday(d) {
    const has = workdays.includes(d)
    if (has && workdays.length === 1) return // keep at least one working day
    const next = has ? workdays.filter(x => x !== d) : [...workdays, d]
    setWorkdays(next)
    await window.api.store.set('workdays', next)
  }

  async function handleAutoLaunch(val) {
    await window.api.app.setLoginItemSettings(val)
    setAutoLaunch(val)
  }

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-label">Appearance</div>
        <div className="settings-row">
          <span className="settings-row-title">Theme</span>
          <div className="theme-toggle">
            <button
              className={`theme-btn ${theme === 'dark' ? 'theme-btn-active' : ''}`}
              onClick={() => onThemeChange('dark')}
            >
              Dark
            </button>
            <button
              className={`theme-btn ${theme === 'auto' ? 'theme-btn-active' : ''}`}
              onClick={() => onThemeChange('auto')}
            >
              Auto
            </button>
            <button
              className={`theme-btn ${theme === 'light' ? 'theme-btn-active' : ''}`}
              onClick={() => onThemeChange('light')}
            >
              Light
            </button>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-title">Tone</span>
          <div className="theme-toggle">
            {TONES.map(t => (
              <button
                key={t.id}
                className={`theme-btn ${tone === t.id ? 'theme-btn-active' : ''}`}
                onClick={async () => { setTone(t.id); applyTone(t.id); await window.api.store.set('tone', t.id) }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-title">Accent</span>
          <div className="accent-swatches">
            {ACCENTS.map(a => (
              <button
                key={a.id}
                className={`accent-swatch ${accent === a.id ? 'accent-swatch-active' : ''}`}
                style={{ '--swatch': a.swatch }}
                title={a.label}
                onClick={async () => { setAccent(a.id); applyAccent(a.id); await window.api.store.set('accent', a.id) }}
              />
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-title">
            Timer font
            <span className="settings-font-preview" data-font-style={font}>0:00</span>
          </div>
          <div className="theme-toggle">
            <button
              className={`theme-btn ${font === 'serif' ? 'theme-btn-active' : ''}`}
              onClick={() => onFontChange('serif')}
            >
              Serif
            </button>
            <button
              className={`theme-btn ${font === 'dotted' ? 'theme-btn-active' : ''}`}
              onClick={() => onFontChange('dotted')}
            >
              Dotted
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">System</div>
        <div className="settings-row">
          <span className="settings-row-title">Launch at login</span>
          <button
            className={`settings-toggle ${autoLaunch ? 'settings-toggle-on' : ''}`}
            onClick={() => handleAutoLaunch(!autoLaunch)}
          >
            <span className="settings-toggle-knob" />
          </button>
        </div>
        <div className="settings-row">
          <span className="settings-row-title" title="Clicking the menu bar icon opens the persistent window instead of the popover">
            Open as window
          </span>
          <button
            className={`settings-toggle ${openAsWindow ? 'settings-toggle-on' : ''}`}
            onClick={async () => {
              const next = !openAsWindow
              setOpenAsWindow(next)
              await window.api.store.set('open_as_window', next)
            }}
          >
            <span className="settings-toggle-knob" />
          </button>
        </div>
        <div className="settings-row">
          <span className="settings-row-title">Idle detection</span>
          <button
            className={`settings-toggle ${idleDetection ? 'settings-toggle-on' : ''}`}
            onClick={() => handleIdleDetection(!idleDetection)}
          >
            <span className="settings-toggle-knob" />
          </button>
        </div>
        {idleDetection && (
          <div className="settings-row">
            <span className="settings-row-title">Prompt after</span>
            <div className="settings-number-row">
              <input
                className="settings-number"
                type="number"
                min="1"
                max="120"
                value={idleThreshold}
                onChange={e => handleIdleThreshold(e.target.value)}
              />
              <span className="settings-number-unit">min</span>
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-label">Tracking</div>
        <div className="settings-row">
          <span className="settings-row-title">
            Weekly goal
            {weeklyGoalHours > 0 && workdays.length > 0 && (
              <span className="settings-goal-hint">
                ≈ {Math.round((weeklyGoalHours / workdays.length) * 10) / 10}h / day
              </span>
            )}
          </span>
          <div className="settings-number-row">
            <input
              className="settings-number"
              type="number"
              min="1"
              max="100"
              placeholder="—"
              value={weeklyGoalHours}
              onChange={async e => {
                const raw = e.target.value
                setWeeklyGoalHours(raw)
                const h = parseFloat(raw)
                // Single source of truth: the legacy daily key is dropped
                // so it can't shadow the weekly value after clearing it
                await window.api.store.delete('daily_goal_hours')
                if (raw === '' || isNaN(h)) {
                  await window.api.store.delete('weekly_goal_hours')
                } else {
                  await window.api.store.set('weekly_goal_hours', Math.min(100, Math.max(1, h)))
                }
              }}
            />
            <span className="settings-number-unit">h / week</span>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-title" title="Days you normally work — your average divides by these; time tracked on other days only adds on top">
            Working days
          </span>
          <div className="workday-chips">
            {[
              { d: 1, label: 'M' }, { d: 2, label: 'T' }, { d: 3, label: 'W' },
              { d: 4, label: 'T' }, { d: 5, label: 'F' }, { d: 6, label: 'S' }, { d: 0, label: 'S' },
            ].map(({ d, label }) => (
              <button
                key={d}
                className={`workday-chip ${workdays.includes(d) ? 'workday-chip-active' : ''}`}
                onClick={() => toggleWorkday(d)}
              >{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">ClickUp</div>
        <div className="settings-row">
          <span className="settings-row-title" title="When you track time on a task that is still in a backlog status, move it to the list's In Progress status">
            Auto-move to In Progress
          </span>
          <button
            className={`settings-toggle ${autoProgress ? 'settings-toggle-on' : ''}`}
            onClick={async () => {
              const next = !autoProgress
              setAutoProgress(next)
              await window.api.store.set('auto_progress', next)
            }}
          >
            <span className="settings-toggle-knob" />
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Menu bar</div>
        <div className="settings-row">
          <span className="settings-row-title">Idle text</span>
          <input
            className="settings-text-input"
            value={idleText}
            maxLength={40}
            onChange={e => handleIdleText(e.target.value)}
            placeholder="not tracking rn"
          />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">
          Export
          <span className="settings-label-badge">Toggl</span>
        </div>
        <div className="export-card">
          <div className="export-controls">
            <div className="export-presets">
              {[
                { key: 'week', label: 'Last week' },
                { key: 'month', label: 'Last month' },
                { key: 'custom', label: 'Custom' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  className={`export-preset-btn ${exportPreset === key ? 'export-preset-btn-active' : ''}`}
                  onClick={() => setExportPreset(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="export-btn" disabled={exporting} onClick={handleExport}>
              {exporting ? '…' : (
                <>
                  Export
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </>
              )}
            </button>
          </div>
          {exportPreset === 'custom' && (
            <div className="export-custom">
              <div className="export-date-field">
                <span className="export-date-label">From</span>
                <input
                  type="date"
                  className="export-date-input"
                  value={exportFrom}
                  max={exportTo}
                  onChange={e => setExportFrom(e.target.value)}
                />
              </div>
              <div className="export-date-field">
                <span className="export-date-label">To</span>
                <input
                  type="date"
                  className="export-date-input"
                  value={exportTo}
                  min={exportFrom}
                  onChange={e => setExportTo(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">
          Archive
          <span className="settings-label-badge">Toggl</span>
        </div>
        <div className="export-card">
          <div className="archive-hint">
            Old time entries live as CSV attachments on a ClickUp task tagged{' '}
            <code className="archive-tag">timesup-archive</code>. Everyone who can see that task
            gets the archive in Reports, nothing to configure.
          </div>

          {archiveTasks === null && <span className="archive-status-line">Looking for archive tasks…</span>}

          {archiveTasks && archiveTasks.length > 0 && (
            <div className="archive-tasks">
              {archiveTasks.map(t => (
                <div key={t.id} className="archive-task">
                  <div className="archive-task-main">
                    <span className="archive-task-name" title={t.name}>{t.name}</span>
                    <span className="archive-task-meta">
                      {t.listName ? `${t.listName} · ` : ''}{t.csvCount} {t.csvCount === 1 ? 'CSV' : 'CSVs'}
                    </span>
                  </div>
                  <button
                    className="entry-card-open archive-task-open"
                    title="Open in ClickUp"
                    onClick={() => window.api.shell.openExternal(t.url || `https://app.clickup.com/t/${t.id}`)}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {archiveTasks && archiveTasks.length === 0 && !archiveError && (
            <div className="archive-create">
              <span className="archive-status-line">No archive task yet. Create one, then attach the CSV exports to it.</span>
              <div className="archive-create-row">
                <select
                  className="draft-input archive-list-select"
                  value={archiveListId}
                  onChange={e => setArchiveListId(e.target.value)}
                  disabled={!archiveLists.length}
                >
                  {!archiveLists.length && <option value="">Loading lists…</option>}
                  {archiveLists.map(l => (
                    <option key={l.id} value={String(l.id)}>{l.path} / {l.name}</option>
                  ))}
                </select>
                <button className="settings-update-btn" disabled={archiveCreating || !archiveListId} onClick={createArchiveTask}>
                  {archiveCreating ? '…' : 'Create task'}
                </button>
              </div>
            </div>
          )}

          {archiveError && <span className="archive-status-line archive-status-error">{archiveError}</span>}

          {(archiveTasks?.length > 0 || archiveUrls.trim()) && (
            <div className="archive-status">
              <div className="archive-status-lines">
                {archiveLoading && <span className="archive-status-line">Loading…</span>}
                {!archiveLoading && archiveStatus && (
                  <>
                    <span className="archive-status-line">
                      {archiveStatus.entries} {archiveStatus.entries === 1 ? 'entry' : 'entries'}
                      {' · '}{archiveStatus.files.length} {archiveStatus.files.length === 1 ? 'file' : 'files'}
                    </span>
                    {archiveStatus.files.filter(f => f.error).map(f => (
                      <span key={f.url} className="archive-status-line archive-status-error" title={f.url}>
                        {f.label && !/^https?:/.test(f.label) ? f.label : shortUrl(f.url)}: {f.error}
                      </span>
                    ))}
                  </>
                )}
              </div>
              <button className="settings-update-btn" disabled={archiveLoading} onClick={() => refreshArchive(true)}>
                Refresh
              </button>
            </div>
          )}

          <button className="archive-advanced-toggle" onClick={() => setArchiveAdvanced(v => !v)}>
            {archiveAdvanced ? 'Hide' : 'Advanced'}: direct CSV links
          </button>
          {archiveAdvanced && (
            <textarea
              className="archive-urls"
              rows={2}
              spellCheck={false}
              placeholder="https://…/export.csv or a ClickUp task link, one per line"
              value={archiveUrls}
              onChange={e => handleArchiveUrls(e.target.value)}
            />
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Updates</div>
        <div className="settings-row">
          <span className="settings-row-title">
            {updateState === 'idle' && 'Up to date'}
            {updateState === 'checking' && 'Checking…'}
            {updateState === 'downloading' && 'Downloading…'}
            {updateState === 'ready' && 'Ready to install'}
          </span>
          {updateState === 'idle' && (
            <button className="settings-update-btn" onClick={() => window.api.updater.check()}>
              Check
            </button>
          )}
          {updateState === 'ready' && (
            <button className="settings-update-btn settings-update-btn-ready" onClick={() => window.api.updater.install()}>
              Restart
            </button>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">Account</div>
        <button className="settings-signout" onClick={onSignOut}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  )
}
