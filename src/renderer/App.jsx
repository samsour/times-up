import { useState, useEffect } from 'react'
import Setup from './components/Setup.jsx'
import Tracker from './components/Tracker.jsx'
import { loadAppearance, applyTone, applyAccent } from './lib/theme.js'

function resolveTheme(pref) {
  if (pref === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return pref
}

function applyTheme(pref) {
  document.documentElement.dataset.theme = resolveTheme(pref)
}

export default function App() {
  const [ready, setReady] = useState(false)
  const [token, setToken] = useState(null)
  const [teamId, setTeamId] = useState(null)
  const [userId, setUserId] = useState(null)
  const [theme, setTheme] = useState('dark')
  const [font, setFont] = useState('serif')

  useEffect(() => {
    const init = async () => {
      if (!window.api) { setTimeout(init, 50); return }
      const t = await window.api.store.get('clickup_token')
      const tid = await window.api.store.get('team_id')
      const uid = await window.api.store.get('user_id')
      const th = await window.api.store.get('theme')
      const fn = await window.api.store.get('font')
      setToken(t || null)
      setTeamId(tid || null)
      setUserId(uid || null)
      const pref = th || 'dark'
      const resolvedFont = fn || 'serif'
      setTheme(pref)
      setFont(resolvedFont)
      applyTheme(pref)
      document.documentElement.dataset.font = resolvedFont
      const { tone, accent } = await loadAppearance()
      applyTone(tone)
      applyAccent(accent)
      setReady(true)
    }
    init()
  }, [])

  // Appearance changed in the other window: apply it here too
  useEffect(() => {
    if (!ready) return
    return window.api.store.onChange(({ key, value }) => {
      if (key === 'theme') { const t = value || 'dark'; setTheme(t); applyTheme(t) }
      if (key === 'font') { const f = value || 'serif'; setFont(f); document.documentElement.dataset.font = f }
      if (key === 'tone') applyTone(value)
      if (key === 'accent') applyAccent(value)
    })
  }, [ready])

  // Keep auto theme in sync with system changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => { if (theme === 'auto') applyTheme('auto') }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  async function handleThemeChange(t) {
    setTheme(t)
    applyTheme(t)
    await window.api.store.set('theme', t)
  }

  async function handleFontChange(f) {
    setFont(f)
    document.documentElement.dataset.font = f
    await window.api.store.set('font', f)
  }

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
      theme={theme}
      onThemeChange={handleThemeChange}
      font={font}
      onFontChange={handleFontChange}
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
