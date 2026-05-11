import './Settings.css'

export default function Settings({ theme, onThemeChange, font, onFontChange, onSignOut }) {
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
            <span className="settings-font-preview" data-font-style={font}>
              {font === 'dotted' ? '0:00' : '0:00'}
            </span>
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
