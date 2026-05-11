import { useState, useEffect, useCallback } from 'react'
import TimerPanel from './TimerPanel.jsx'
import TaskPicker from './TaskPicker.jsx'
import History from './History.jsx'
import ManualEntry from './ManualEntry.jsx'
import Settings from './Settings.jsx'
import IdlePrompt from './IdlePrompt.jsx'
import { getCurrentTimer, startTimer, updateTimeEntry } from '../lib/clickup.js'
import './Tracker.css'

export default function Tracker({ teamId, userId, theme, onThemeChange, font, onFontChange, onReset }) {
  const [view, setView] = useState('timer') // 'timer' | 'tasks' | 'manual' | 'history' | 'settings'
  const [currentEntry, setCurrentEntry] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [idleSeconds, setIdleSeconds] = useState(null)

  const refreshCurrent = useCallback(async () => {
    try {
      const entry = await getCurrentTimer(teamId)
      setCurrentEntry(entry && entry.id ? entry : null)
    } catch {
      setCurrentEntry(null)
    }
  }, [teamId])

  useEffect(() => {
    refreshCurrent()
    const interval = setInterval(refreshCurrent, 10000)
    return () => clearInterval(interval)
  }, [refreshCurrent])

  useEffect(() => {
    return window.api.idle.onDetected((seconds) => {
      setIdleSeconds(seconds)
    })
  }, [])

  function bumpRefresh() {
    setRefreshKey(k => k + 1)
    refreshCurrent()
  }

  async function handleBrowsePick(task) {
    try {
      if (currentEntry?.id && !currentEntry.task) {
        await updateTimeEntry(teamId, currentEntry.id, { tid: task.id })
      } else {
        await startTimer(teamId, task.id, '')
      }
      bumpRefresh()
    } catch {}
    setView('timer')
  }

  return (
    <div className="tracker">
      <header className="tracker-header">
        <div className="tracker-tabs">
          <TabBtn active={view === 'timer'} onClick={() => setView('timer')}>Timer</TabBtn>
          <TabBtn active={view === 'tasks'} onClick={() => setView('tasks')}>Tasks</TabBtn>
          <TabBtn active={view === 'manual'} onClick={() => setView('manual')}>Add</TabBtn>
          <TabBtn active={view === 'history'} onClick={() => setView('history')}>Log</TabBtn>
        </div>
        <button
          className={`tracker-settings ${view === 'settings' ? 'tracker-settings-active' : ''}`}
          onClick={() => setView(v => v === 'settings' ? 'timer' : 'settings')}
          title="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </header>

      <main className="tracker-body" style={{ position: 'relative' }}>
        {view === 'timer' && (
          <TimerPanel
            teamId={teamId}
            userId={userId}
            currentEntry={currentEntry}
            onBrowse={() => setView('tasks')}
            onChange={bumpRefresh}
          />
        )}
        {view === 'tasks' && (
          <TaskPicker
            teamId={teamId}
            onPick={handleBrowsePick}
            onCancel={() => setView('timer')}
          />
        )}
        {view === 'manual' && (
          <ManualEntry
            teamId={teamId}
            selectedTask={null}
            onPickTask={() => setView('tasks')}
            onSaved={() => { bumpRefresh(); setView('history') }}
          />
        )}
        {view === 'history' && (
          <History teamId={teamId} key={refreshKey} onChange={bumpRefresh} onRestart={() => setView('timer')} />
        )}
        {view === 'settings' && (
          <Settings
            theme={theme}
            onThemeChange={onThemeChange}
            font={font}
            onFontChange={onFontChange}
            onSignOut={onReset}
          />
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
                setView('timer')
              }
            }}
          />
        )}
      </main>
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
