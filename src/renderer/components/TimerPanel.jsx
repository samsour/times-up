import { useState, useEffect } from 'react'
import { startTimer, stopTimer, updateTimeEntry } from '../lib/clickup.js'
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

  // Sync description from running entry when a new timer starts
  useEffect(() => {
    if (currentEntry?.id) setDescription(currentEntry.description || '')
  }, [currentEntry?.id])

  // Show task from running timer if available
  const displayTask = currentEntry?.task
    ? { id: currentEntry.task.id, name: currentEntry.task.name }
    : selectedTask

  async function handleStart() {
    setBusy(true)
    setError('')
    try {
      await startTimer(teamId, selectedTask?.id || null, description)
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
      {/* Main action button */}
      <button
        className={`timer-action ${isRunning ? 'timer-action-stop' : 'timer-action-start'}`}
        onClick={isRunning ? handleStop : handleStart}
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
            Start
          </>
        )}
      </button>
    </div>
  )
}
