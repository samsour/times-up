import { useState, useEffect } from 'react'
import Setup from './components/Setup.jsx'
import Tracker from './components/Tracker.jsx'

export default function App() {
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState(null)
  const [teamId, setTeamId] = useState(null)

  useEffect(() => {
    (async () => {
      const t = await window.api.store.get('clickup_token')
      const tid = await window.api.store.get('team_id')
      setToken(t || null)
      setTeamId(tid || null)
      setReady(true)
    })()
  }, [])

  if (!ready) return <div style={{ padding: 40, color: 'var(--text-dim)' }}>Loading…</div>

  if (!token || !teamId) {
    return (
      <Setup
        onComplete={(t, tid) => {
          setToken(t)
          setTeamId(tid)
        }}
      />
    )
  }

  return (
    <Tracker
      teamId={teamId}
      onReset={async () => {
        await window.api.store.delete('clickup_token')
        await window.api.store.delete('team_id')
        setToken(null)
        setTeamId(null)
      }}
    />
  )
}
