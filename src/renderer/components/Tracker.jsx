import { useState, useEffect, useCallback, useRef } from 'react'
import TimerBar from './TimerBar.jsx'
import TaskPicker from './TaskPicker.jsx'
import Today from './Today.jsx'
import History from './History.jsx'
import Reports from './Reports.jsx'
import Settings from './Settings.jsx'
import IdlePrompt from './IdlePrompt.jsx'
import Planning from './Planning.jsx'
import { getCurrentTimer, startTimer, updateTimeEntry, advanceTaskStatus, updateTask, getTeamMembers, canViewOthersTime } from '../lib/clickup.js'
import './Tracker.css'

export default function Tracker({ teamId, userId, theme, onThemeChange, font, onFontChange, onReset }) {
  const [view, setView] = useState('today') // 'today' | 'stats' | 'settings'
  const [currentEntry, setCurrentEntry] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [idleSeconds, setIdleSeconds] = useState(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [toast, setToast] = useState(null) // { text, undo }
  const [isAdmin, setIsAdmin] = useState(false)
  const toastTimer = useRef(null)

  useEffect(() => {
    getTeamMembers(teamId)
      .then(ms => setIsAdmin(canViewOthersTime(ms, userId)))
      .catch(() => {})
  }, [teamId, userId])

  const refreshCurrent = useCallback(async (force = false) => {
    try {
      const entry = await getCurrentTimer(teamId, force)
      setCurrentEntry(entry && entry.id ? entry : null)
    } catch {
      setCurrentEntry(null)
    }
  }, [teamId])

  useEffect(() => {
    refreshCurrent(true)
    const interval = setInterval(() => refreshCurrent(), 10000)
    return () => clearInterval(interval)
  }, [refreshCurrent])

  useEffect(() => {
    return window.api.idle.onDetected((seconds) => {
      setIdleSeconds(seconds)
    })
  }, [])

  useEffect(() => {
    return window.api.updater.onStateChange((state) => {
      if (state === 'ready') setUpdateReady(true)
    })
  }, [])

  function bumpRefresh() {
    setRefreshKey(k => k + 1)
    refreshCurrent(true)
  }

  function showToast(next) {
    clearTimeout(toastTimer.current)
    setToast(next)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  // When time lands on a backlog task, move it to "in progress" so the
  // board reflects reality for the whole team. Toggleable in Settings.
  const handleTaskTracked = useCallback(async (taskId) => {
    if (!taskId) return
    try {
      const enabled = await window.api.store.get('auto_progress')
      if (enabled === false) return
      const change = await advanceTaskStatus(taskId)
      if (!change) return
      bumpRefresh()
      showToast({
        text: `“${change.name}” moved to ${change.to}`,
        undo: async () => {
          try {
            await updateTask(taskId, { status: change.from })
          } catch {}
          setToast(null)
          bumpRefresh()
        },
      })
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleBrowsePick(task) {
    try {
      if (currentEntry?.id && !currentEntry.task) {
        await updateTimeEntry(teamId, currentEntry.id, { tid: task.id })
      } else {
        await startTimer(teamId, task.id, '')
      }
      bumpRefresh()
      handleTaskTracked(task.id)
    } catch {}
    setPickerOpen(false)
  }

  return (
    <div className="tracker">
      <header className="tracker-header">
        <div className="tracker-tabs">
          <TabBtn active={view === 'today'} onClick={() => setView('today')}>Today</TabBtn>
          <TabBtn active={view === 'stats'} onClick={() => setView('stats')}>Stats</TabBtn>
          {isAdmin && <TabBtn active={view === 'plan'} onClick={() => setView('plan')}>Plan</TabBtn>}
        </div>
        <button
          className={`tracker-settings ${view === 'settings' ? 'tracker-settings-active' : ''}`}
          onClick={() => setView(v => v === 'settings' ? 'today' : 'settings')}
          title="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </header>

      <TimerBar
        teamId={teamId}
        userId={userId}
        currentEntry={currentEntry}
        onBrowse={() => setPickerOpen(true)}
        onChange={bumpRefresh}
        onTaskTracked={handleTaskTracked}
      />

      <main className="tracker-body" style={{ position: 'relative' }}>
        {view === 'today' && (
          <Today
            teamId={teamId}
            currentEntry={currentEntry}
            refreshKey={refreshKey}
            onChange={bumpRefresh}
            onTaskTracked={handleTaskTracked}
          />
        )}
        {view === 'stats' && (
          <StatsView teamId={teamId} userId={userId} refreshKey={refreshKey} onChange={bumpRefresh} />
        )}
        {view === 'plan' && isAdmin && (
          <Planning teamId={teamId} userId={userId} />
        )}
        {view === 'settings' && (
          <Settings
            teamId={teamId}
            theme={theme}
            onThemeChange={onThemeChange}
            font={font}
            onFontChange={onFontChange}
            onSignOut={onReset}
          />
        )}

        {pickerOpen && (
          <div className="tracker-overlay">
            <TaskPicker
              teamId={teamId}
              userId={userId}
              onPick={handleBrowsePick}
              onCancel={() => setPickerOpen(false)}
            />
          </div>
        )}

        {updateReady && (
          <div className="update-banner">
            <span>Update ready</span>
            <button onClick={() => window.api.updater.install()}>Restart</button>
          </div>
        )}
        {idleSeconds && currentEntry && (
          <IdlePrompt
            idleSeconds={idleSeconds}
            currentEntry={currentEntry}
            teamId={teamId}
            onDismiss={(action) => {
              setIdleSeconds(null)
              if (action === 'removed' || action === 'stopped') {
                bumpRefresh()
                setView('today')
              }
            }}
          />
        )}

        {toast && (
          <div className="tracker-toast">
            <span className="tracker-toast-text">{toast.text}</span>
            {toast.undo && (
              <button className="tracker-toast-undo" onClick={toast.undo}>Undo</button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// Stats keeps the analytics; the old Log lives here as a second mode
function StatsView({ teamId, userId, refreshKey, onChange }) {
  const [mode, setMode] = useState('overview') // 'overview' | 'log'
  return (
    <div className="stats-view">
      <div className="stats-view-switch">
        <button
          className={`mini-tab ${mode === 'overview' ? 'mini-tab-active' : ''}`}
          onClick={() => setMode('overview')}
        >Overview</button>
        <button
          className={`mini-tab ${mode === 'log' ? 'mini-tab-active' : ''}`}
          onClick={() => setMode('log')}
        >Log</button>
      </div>
      {mode === 'overview' && <Reports teamId={teamId} userId={userId} key={refreshKey} />}
      {mode === 'log' && <History teamId={teamId} key={refreshKey} onChange={onChange} />}
    </div>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button className={`tab ${active ? 'tab-active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}
