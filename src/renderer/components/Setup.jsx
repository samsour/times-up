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
          <span className="setup-title-italic">time</span>track
        </h1>
        <p className="setup-subtitle">A quieter way to log hours.</p>

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
              Get it from <span className="mono">ClickUp → Settings → Apps → Generate</span>
            </p>
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
