import { useState, useEffect } from 'react'
import Setup from './components/Setup.jsx'
import Tracker from './components/Tracker.jsx'

export default function App() {
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState(null)
  const [teamId, setTeamId] = useState(null)
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    const init = async () => {
      // On Windows dev the preload can attach slightly after first render
      if (!window.api) {
        setTimeout(init, 50)
        return
      }
      const t = await window.api.store.get('clickup_token')
      const tid = await window.api.store.get('team_id')
      const uid = await window.api.store.get('user_id')
      setToken(t || null)
      setTeamId(tid || null)
      setUserId(uid || null)
      setReady(true)
    }
    init()
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
      userId={userId}
      onReset={async () => {
        await window.api.store.delete('clickup_token')
        await window.api.store.delete('team_id')
        await window.api.store.delete('user_id')
        setToken(null)
        setTeamId(null)
        setUserId(null)
      }}
    />
  )
}
