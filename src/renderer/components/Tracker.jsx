import { useState, useEffect, useCallback } from 'react'
import TimerPanel from './TimerPanel.jsx'
import TaskPicker from './TaskPicker.jsx'
import History from './History.jsx'
import ManualEntry from './ManualEntry.jsx'
import { getCurrentTimer, startTimer } from '../lib/clickup.js'
import './Tracker.css'

export default function Tracker({ teamId, userId, onReset }) {
  const [view, setView] = useState('timer') // 'timer' | 'tasks' | 'manual' | 'history'
  const [currentEntry, setCurrentEntry] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

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

  function bumpRefresh() {
    setRefreshKey(k => k + 1)
    refreshCurrent()
  }

  async function handleBrowsePick(task) {
    try {
      await startTimer(teamId, task.id, '')
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
        <button className="tracker-settings" onClick={onReset} title="Sign out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
        </button>
      </header>

      <main className="tracker-body">
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
