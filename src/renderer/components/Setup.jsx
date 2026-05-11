import { useState } from 'react'
import './Setup.css'

export default function Setup({ onComplete }) {
  const [step, setStep] = useState('token') // 'token' | 'team'
  const [token, setToken] = useState('')
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function verifyToken() {
    if (!token.trim()) return
    setLoading(true)
    setError('')
    try {
      await window.api.store.set('clickup_token', token.trim())
      const res = await window.api.clickup.request({ path: '/team' })
      setTeams(res.teams || [])
      setStep('team')
    } catch (e) {
      setError('Invalid token. Get yours from ClickUp → Settings → Apps.')
      await window.api.store.delete('clickup_token')
    } finally {
      setLoading(false)
    }
  }

  async function pickTeam(team) {
    await window.api.store.set('team_id', team.id)
    try {
      const { user } = await window.api.clickup.request({ path: '/user' })
      await window.api.store.set('user_id', user.id)
    } catch {}
    onComplete(token, team.id)
  }

  return (
    <div className="setup">
      <div className="setup-bg" />
      <div className="setup-inner">
        <h1 className="setup-title">
          <span className="setup-title-italic">Times</span>Up
        </h1>
        <p className="setup-subtitle">ClickUp time tracking made easy.<br />Just enter your API key and you're good to go.</p>

        {step === 'token' && (
          <div className="setup-step">
            <label className="setup-label">ClickUp API Token</label>
            <input
              type="password"
              className="setup-input"
              placeholder="pk_••••••••••••"
              value={token}
              onChange={e => setToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && verifyToken()}
              autoFocus
            />
            <p className="setup-hint">
              Found under <span className="mono">Settings → Apps → Generate</span>
            </p>
            <button
              className="setup-link"
              onClick={() => window.api.shell.openExternal('https://app.clickup.com/settings/apps')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
              Open ClickUp API settings
            </button>
            {error && <div className="setup-error">{error}</div>}
            <button
              className="setup-button"
              onClick={verifyToken}
              disabled={loading || !token.trim()}
            >
              {loading ? 'Verifying…' : 'Continue →'}
            </button>
          </div>
        )}

        {step === 'team' && (
          <div className="setup-step">
            <label className="setup-label">Pick your workspace</label>
            <div className="team-list">
              {teams.map(team => (
                <button
                  key={team.id}
                  className="team-item"
                  onClick={() => pickTeam(team)}
                >
                  <span className="team-dot" style={{ background: team.color || '#ff6b00' }} />
                  <span>{team.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
