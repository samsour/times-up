import { useState, useEffect, useCallback } from 'react'
import TimerPanel from './TimerPanel.jsx'
import TaskPicker from './TaskPicker.jsx'
import History from './History.jsx'
import ManualEntry from './ManualEntry.jsx'
import { getCurrentTimer } from '../lib/clickup.js'
import './Tracker.css'

export default function Tracker({ teamId, onReset }) {
  const [view, setView] = useState('timer') // 'timer' | 'picker' | 'history' | 'manual'
  const [currentEntry, setCurrentEntry] = useState(null)
  const [selectedTask, setSelectedTask] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Poll current running timer (in case started from ClickUp web)
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

  // Restore last picked task
  useEffect(() => {
    window.api.store.get('last_task').then(t => t && setSelectedTask(t))
  }, [])

  function pickTask(task) {
    setSelectedTask(task)
    window.api.store.set('last_task', task)
    setView('timer')
  }

  function bumpRefresh() {
    setRefreshKey(k => k + 1)
    refreshCurrent()
  }

  return (
    <div className="tracker">
      <header className="tracker-header">
<div className="tracker-tabs">
          <TabBtn active={view === 'timer'} onClick={() => setView('timer')}>Timer</TabBtn>
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
            selectedTask={selectedTask}
            currentEntry={currentEntry}
            onPickTask={() => setView('picker')}
            onClearTask={() => { setSelectedTask(null); window.api.store.delete('last_task') }}
            onChange={bumpRefresh}
          />
        )}
        {view === 'picker' && (
          <TaskPicker
            teamId={teamId}
            onPick={pickTask}
            onCancel={() => setView('timer')}
          />
        )}
        {view === 'manual' && (
          <ManualEntry
            teamId={teamId}
            selectedTask={selectedTask}
            onPickTask={() => setView('picker')}
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
