import { useState, useEffect } from 'react'
import './Settings.css'

export default function Settings({ theme, onThemeChange, font, onFontChange, onSignOut }) {
  const [autoLaunch, setAutoLaunch] = useState(false)
  const [idleDetection, setIdleDetection] = useState(false)
  const [idleThreshold, setIdleThreshold] = useState(5)

  useEffect(() => {
    window.api.app.getLoginItemSettings().then(setAutoLaunch)
    window.api.store.get('idleDetection').then(v => setIdleDetection(!!v))
    window.api.store.get('idleThreshold').then(v => setIdleThreshold(v || 5))
  }, [])

  async function handleIdleDetection(val) {
    setIdleDetection(val)
    await window.api.store.set('idleDetection', val)
  }

  async function handleIdleThreshold(val) {
    const clamped = Math.max(1, Math.min(120, parseInt(val) || 1))
    setIdleThreshold(clamped)
    await window.api.store.set('idleThreshold', clamped)
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
