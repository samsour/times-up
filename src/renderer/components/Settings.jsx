import { useState, useEffect } from 'react'
import { getTimeEntries, getUser } from '../lib/clickup.js'
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
  const [idleDetection, setIdleDetection] = useState(false)
  const [idleThreshold, setIdleThreshold] = useState(5)
  const [idleText, setIdleText] = useState('not tracking rn')
  const [dailyGoalHours, setDailyGoalHours] = useState('')
  const [exportPreset, setExportPreset] = useState('week') // 'week' | 'month' | 'custom'
  const [exportFrom, setExportFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-01` })
  const [exportTo, setExportTo] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` })
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    window.api.app.getLoginItemSettings().then(setAutoLaunch)
    window.api.store.get('idleDetection').then(v => setIdleDetection(!!v))
    window.api.store.get('idleThreshold').then(v => setIdleThreshold(v || 5))
    window.api.store.get('idleText').then(v => setIdleText(v || 'not tracking rn'))
    window.api.store.get('daily_goal_hours').then(v => setDailyGoalHours(v || ''))
  }, [])

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
      start = lastMon.getTime(); end = lastSun.getTime(); label = 'last-week'
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
          <span className="settings-row-title">Daily goal</span>
          <div className="settings-number-row">
            <input
              className="settings-number"
              type="number"
              min="1"
              max="24"
              placeholder="—"
              value={dailyGoalHours}
              onChange={async e => {
                const raw = e.target.value
                setDailyGoalHours(raw)
                const h = parseFloat(raw)
                if (raw === '' || isNaN(h)) {
                  await window.api.store.delete('daily_goal_hours')
                } else {
                  await window.api.store.set('daily_goal_hours', Math.min(24, Math.max(0.5, h)))
                }
              }}
            />
            <span className="settings-number-unit">h / day</span>
          </div>
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
        <div className="settings-label">Export</div>
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
