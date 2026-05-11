import { useState, useEffect } from 'react'
import { startTimer, stopTimer, updateTimeEntry, getTimeEntries, getMyTasks } from '../lib/clickup.js'
import { formatDuration, formatDurationShort, endOfDay } from '../lib/time.js'
import './TimerPanel.css'

export default function TimerPanel({ teamId, userId, currentEntry, onBrowse, onChange }) {
  const [elapsed, setElapsed] = useState(0)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [suggestedTasks, setSuggestedTasks] = useState([])
  const [lastEntry, setLastEntry] = useState(null)

  const isRunning = !!currentEntry

  // Tick elapsed time
  useEffect(() => {
    if (!isRunning) { setElapsed(0); return }
    const startMs = parseInt(currentEntry.start)
    const update = () => setElapsed(Date.now() - startMs)
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [isRunning, currentEntry])

  // Sync description from running entry
  useEffect(() => {
    if (currentEntry?.id) setDescription(currentEntry.description || '')
  }, [currentEntry?.id])

  // Fetch suggestions + last entry when idle
  useEffect(() => {
    if (isRunning) return
    if (userId) {
      getMyTasks(teamId, userId)
        .then(tasks => setSuggestedTasks(tasks.slice(0, 5)))
        .catch(() => {})
    }
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    getTimeEntries(teamId, sevenDaysAgo, endOfDay())
      .then(data => {
        const sorted = (data || []).sort((a, b) => parseInt(b.start) - parseInt(a.start))
        setLastEntry(sorted[0] || null)
      })
      .catch(() => {})
  }, [teamId, userId, isRunning])

  async function handleStop() {
    setBusy(true)
    setError('')
    try {
      await stopTimer(teamId)
      onChange()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function startWithTask(taskId, desc = '') {
    setBusy(true)
    setError('')
    try {
      await startTimer(teamId, taskId, desc)
      onChange()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="timer-panel">
      {/* Start / Stop */}
      <button
        className={`timer-action ${isRunning ? 'timer-action-stop' : 'timer-action-start'}`}
        onClick={isRunning ? handleStop : () => startWithTask(null, description)}
        disabled={busy}
      >
        {busy ? '...' : isRunning ? (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Start unassigned
          </>
        )}
      </button>

      {/* Clock */}
      <div className="timer-display">
        <div className={`timer-time ${isRunning ? 'timer-time-running' : ''}`}>
          {formatDuration(elapsed)}
        </div>
        <div className="timer-status">
          {isRunning ? (
            <>
              <span className="status-dot status-running" />
              <span>{currentEntry.task?.name || 'unassigned'}</span>
            </>
          ) : (
            <>
              <span className="status-dot" />
              <span>stopped</span>
            </>
          )}
        </div>
      </div>

      {/* Notes */}
      <input
        className="timer-description"
        placeholder="Notes... (optional)"
        value={description}
        onChange={e => setDescription(e.target.value)}
        onBlur={async () => {
          if (isRunning && currentEntry?.id) {
            try { await updateTimeEntry(teamId, currentEntry.id, { description }) } catch {}
          }
        }}
        maxLength={200}
      />

      {error && <div className="timer-error">{error}</div>}

      {/* Suggested tasks — only when idle */}
      {!isRunning && (
        <div className="suggestions">
          <div className="suggestions-header">
            <span className="suggestions-label">your tasks</span>
            <button className="suggestions-browse" onClick={onBrowse}>Browse all →</button>
          </div>
          {suggestedTasks.length === 0 && !userId && (
            <div className="suggestions-empty">Sign out and back in to enable quick tasks.</div>
          )}
          {suggestedTasks.length === 0 && userId && (
            <div className="suggestions-empty">No open tasks assigned to you.</div>
          )}
          {suggestedTasks.map(task => (
            <button key={task.id} className="suggestion-item" onClick={() => startWithTask(task.id)}>
              <div className="suggestion-info">
                <span className="suggestion-name">{task.name}</span>
                {task.status?.status && (
                  <span className="suggestion-status" style={{ color: task.status.color || 'var(--text-muted)' }}>
                    {task.status.status}
                  </span>
                )}
              </div>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="suggestion-play">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          ))}
        </div>
      )}

      {/* Last entry quick-start */}
      {!isRunning && lastEntry && (
        <button
          className="last-entry"
          onClick={() => startWithTask(lastEntry.task?.id || null, lastEntry.description || '')}
        >
          <div className="last-entry-info">
            <span className="last-entry-label">last</span>
            <span className="last-entry-name">{lastEntry.task?.name || lastEntry.description || 'Unassigned'}</span>
            <span className="last-entry-meta">
              {new Date(parseInt(lastEntry.start)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              {' · '}{formatDurationShort(parseInt(lastEntry.duration))} tracked
            </span>
          </div>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="last-entry-play">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}
    </div>
  )
}
