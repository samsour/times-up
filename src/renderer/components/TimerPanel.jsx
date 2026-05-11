import { useState, useEffect } from 'react'
import { startTimer, stopTimer } from '../lib/clickup.js'
import { formatDuration } from '../lib/time.js'
import './TimerPanel.css'

export default function TimerPanel({ teamId, selectedTask, currentEntry, onPickTask, onClearTask, onChange }) {
  const [elapsed, setElapsed] = useState(0)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isRunning = !!currentEntry

  // Tick elapsed time when running
  useEffect(() => {
    if (!isRunning) {
      setElapsed(0)
      return
    }
    const startMs = parseInt(currentEntry.start)
    const update = () => setElapsed(Date.now() - startMs)
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [isRunning, currentEntry])

  // Show task from running timer if available
  const displayTask = currentEntry?.task
    ? { id: currentEntry.task.id, name: currentEntry.task.name }
    : selectedTask

  async function handleStart() {
    if (!selectedTask) {
      onPickTask()
      return
    }
    setBusy(true)
    setError('')
    try {
      await startTimer(teamId, selectedTask.id, description)
      setDescription('')
      onChange()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

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

  return (
    <div className="timer-panel">
      {/* Big clock */}
      <div className="timer-display">
        <div className={`timer-time ${isRunning ? 'timer-time-running' : ''}`}>
          {formatDuration(elapsed)}
        </div>
        <div className="timer-status">
          {isRunning ? (
            <>
              <span className="status-dot status-running" />
              <span>tracking</span>
            </>
          ) : (
            <>
              <span className="status-dot" />
              <span>stopped</span>
            </>
          )}
        </div>
      </div>

      {/* Task selector */}
      <button className="task-selector" onClick={onPickTask}>
        <div className="task-selector-label">
          {displayTask ? 'Working on' : 'Pick a task'}
        </div>
        <div className="task-selector-name">
          {displayTask?.name || (
            <span className="task-selector-placeholder">Browse Space → List → Task</span>
          )}
        </div>
        <svg className="task-selector-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      {!isRunning && selectedTask && (
        <button className="task-clear" onClick={onClearTask}>× clear task</button>
      )}

      {/* Description (only when not running) */}
      {!isRunning && (
        <input
          className="timer-description"
          placeholder="What are you doing? (optional)"
          value={description}
          onChange={e => setDescription(e.target.value)}
          maxLength={200}
        />
      )}

      {/* Running description */}
      {isRunning && currentEntry?.description && (
        <div className="timer-description-readonly">
          “{currentEntry.description}”
        </div>
      )}

      {error && <div className="timer-error">{error}</div>}

      {/* Main action button */}
      <button
        className={`timer-action ${isRunning ? 'timer-action-stop' : 'timer-action-start'}`}
        onClick={isRunning ? handleStop : handleStart}
        disabled={busy || (!isRunning && !selectedTask)}
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
            Start
          </>
        )}
      </button>
    </div>
  )
}
