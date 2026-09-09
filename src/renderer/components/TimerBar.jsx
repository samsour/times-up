import { useState, useEffect, useRef } from 'react'
import {
  startTimer,
  stopTimer,
  updateTimeEntry,
  getTimeEntries,
  createTask,
} from '../lib/clickup.js'
import { formatDuration, formatDurationShort, startOfDay, endOfDay } from '../lib/time.js'
import { getGoals } from '../lib/goals.js'
import { useTaskSuggestions } from '../lib/useTaskSuggestions.js'
import './TimerBar.css'

// Compact always-visible timer strip: start/stop, elapsed, task switch,
// start-time edit and the daily goal as a hairline progress bar.
export default function TimerBar({ teamId, userId, currentEntry, onBrowse, onChange, onTaskTracked }) {
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [lastList, setLastList] = useState(null)
  const [editingStart, setEditingStart] = useState(false)
  const [startEdit, setStartEdit] = useState('')
  const [switching, setSwitching] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [capacity, setCapacity] = useState(0)
  const [completedToday, setCompletedToday] = useState(0)
  const inputRef = useRef(null)

  const isRunning = !!currentEntry
  const runningTask = currentEntry?.task || null

  const { tasks: taskItems, settled: searchSettled } = useTaskSuggestions(teamId, userId, query, {
    excludeId: runningTask?.id ?? null,
    refreshKey: currentEntry?.id ?? null,
  })

  useEffect(() => {
    if (!isRunning) { setElapsed(0); return }
    const startMs = parseInt(currentEntry.start)
    const update = () => setElapsed(Date.now() - startMs)
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [isRunning, currentEntry])

  useEffect(() => {
    getGoals().then(g => setCapacity(g.dailyMs))
    window.api.store.get('last_list').then(l => l && setLastList(l))
  }, [])

  useEffect(() => {
    getTimeEntries(teamId, startOfDay(), endOfDay())
      .then(data => {
        const ms = (data || [])
          .filter(e => !currentEntry || e.id !== currentEntry.id)
          .reduce((sum, e) => sum + parseInt(e.duration || 0), 0)
        setCompletedToday(ms)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, currentEntry?.id])

  useEffect(() => {
    setNoteDraft(currentEntry?.description || '')
    setSwitching(false)
    setEditingStart(false)
  }, [currentEntry?.id])

  async function handleStop() {
    setBusy(true)
    try {
      await stopTimer(teamId)
      onChange()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function startUnassigned(desc) {
    setBusy(true)
    try {
      await startTimer(teamId, null, desc)
      setQuery('')
      setOpen(false)
      onChange()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Start a timer on this task, or move the running entry onto it
  async function pickTask(task) {
    setBusy(true)
    try {
      if (isRunning) {
        await updateTimeEntry(teamId, currentEntry.id, { tid: task.id })
      } else {
        await startTimer(teamId, task.id, '')
      }
      setQuery('')
      setOpen(false)
      setSwitching(false)
      onChange()
      onTaskTracked?.(task.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateTask() {
    const name = query.trim()
    if (!name || !lastList) return
    setBusy(true)
    try {
      const task = await createTask(lastList.id, name)
      if (isRunning) {
        await updateTimeEntry(teamId, currentEntry.id, { tid: task.id })
      } else {
        await startTimer(teamId, task.id, '')
      }
      setQuery('')
      setOpen(false)
      setSwitching(false)
      onChange()
      onTaskTracked?.(task.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveNote() {
    if (!isRunning || noteDraft === (currentEntry.description || '')) return
    try {
      await updateTimeEntry(teamId, currentEntry.id, { description: noteDraft })
      onChange()
    } catch {}
  }

  function openStartEdit() {
    const d = new Date(parseInt(currentEntry.start))
    const pad = n => String(n).padStart(2, '0')
    setStartEdit(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
    setEditingStart(true)
  }

  async function saveStartEdit() {
    const newMs = new Date(startEdit).getTime()
    if (!newMs || newMs >= Date.now()) { setEditingStart(false); return }
    setBusy(true)
    try {
      await updateTimeEntry(teamId, currentEntry.id, { start: newMs })
      setEditingStart(false)
      onChange()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const q = query.trim().toLowerCase()
  const showStartNote = !isRunning && q.length > 0
  const showCreate = q && searchSettled && taskItems.length === 0 && lastList
  // Row order mirrors the render: optional note row, tasks, optional create row
  const rowCount = (showStartNote ? 1 : 0) + taskItems.length + (showCreate ? 1 : 0)

  function rowAction(idx) {
    if (showStartNote && idx === 0) return () => startUnassigned(query.trim())
    const taskIdx = idx - (showStartNote ? 1 : 0)
    if (taskIdx < taskItems.length) return () => pickTask(taskItems[taskIdx])
    if (showCreate) return handleCreateTask
    return null
  }

  function handleKeys(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, rowCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      const action = rowAction(highlight)
      if (action) action()
      else if (!isRunning) startUnassigned(query.trim())
    } else if (e.key === 'Escape') {
      e.target.blur()
    }
  }

  const showSearchInput = !isRunning || switching
  const total = completedToday + (isRunning ? elapsed : 0)
  const pct = capacity > 0 ? Math.min(total / capacity, 1) : 0

  return (
    <div className="timer-bar-wrap">
      <div className="timer-bar">
        <button
          className={`timer-bar-btn ${isRunning ? 'timer-bar-btn-stop' : 'timer-bar-btn-start'}`}
          onClick={isRunning ? handleStop : () => startUnassigned(query.trim())}
          disabled={busy}
          title={isRunning ? 'Stop timer' : 'Start timer (unassigned)'}
        >
          {isRunning ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>

        {isRunning && (
          <span className="timer-bar-time">{formatDuration(elapsed)}</span>
        )}

        <div className="timer-bar-middle">
          {showSearchInput ? (
            <>
              <input
                ref={inputRef}
                className="timer-bar-input"
                placeholder={isRunning ? (runningTask ? 'Switch task…' : 'Assign a task…') : 'Start a task or note…'}
                value={query}
                onChange={e => { setQuery(e.target.value); setHighlight(0) }}
                onFocus={() => setOpen(true)}
                onBlur={() => { setOpen(false); if (switching) setSwitching(false) }}
                onKeyDown={handleKeys}
                autoFocus={switching}
              />
              {open && (
                <div className="timer-bar-dropdown">
                  {showStartNote && (
                    <button
                      className={`suggestion-row ${highlight === 0 ? 'suggestion-row-active' : ''}`}
                      onMouseDown={e => e.preventDefault()}
                      onMouseEnter={() => setHighlight(0)}
                      onClick={() => startUnassigned(query.trim())}
                      disabled={busy}
                    >
                      <span className="suggestion-row-name">Start unassigned: “{query.trim()}”</span>
                    </button>
                  )}
                  {taskItems.map((task, i) => {
                    const idx = i + (showStartNote ? 1 : 0)
                    return (
                      <button
                        key={task.id}
                        className={`suggestion-row ${highlight === idx ? 'suggestion-row-active' : ''}`}
                        onMouseDown={e => e.preventDefault()}
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => pickTask(task)}
                        disabled={busy}
                      >
                        <span className="suggestion-row-name">{task.name}</span>
                        <span className="suggestion-row-meta">
                          {task.recent && <span className="suggestion-row-recent">recent</span>}
                          {task.list && <span>{task.list}</span>}
                          {task.status && (
                            <span style={{ color: task.statusColor || undefined }}>{task.status}</span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                  {q && !searchSettled && taskItems.length === 0 && (
                    <div className="suggestion-note">Searching…</div>
                  )}
                  {showCreate && (
                    <button
                      className={`suggestion-row ${highlight === rowCount - 1 ? 'suggestion-row-active' : ''}`}
                      onMouseDown={e => e.preventDefault()}
                      onMouseEnter={() => setHighlight(rowCount - 1)}
                      onClick={handleCreateTask}
                      disabled={busy}
                    >
                      <span className="suggestion-row-name">+ Create “{query.trim()}” in {lastList.name}</span>
                    </button>
                  )}
                  <button
                    className="suggestion-browse"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setOpen(false); onBrowse() }}
                  >
                    Browse all tasks →
                  </button>
                </div>
              )}
            </>
          ) : runningTask ? (
            <button className="timer-bar-task" onClick={() => setSwitching(true)} title="Switch task">
              <span className="timer-bar-task-name">{runningTask.name}</span>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 7l4-4 4 4M8 17l4 4 4-4" />
              </svg>
            </button>
          ) : (
            // Running without a task: note input plus a way to attach one
            <div className="timer-bar-unassigned">
              <input
                className="timer-bar-input timer-bar-note"
                placeholder="What are you working on?"
                value={noteDraft}
                onChange={e => setNoteDraft(e.target.value)}
                onBlur={saveNote}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                maxLength={200}
              />
              <button
                className="timer-bar-assign"
                onClick={() => setSwitching(true)}
                title="Assign this entry to a task"
              >
                + task
              </button>
            </div>
          )}
        </div>

        {isRunning && (
          editingStart ? (
            <div className="timer-bar-since-edit">
              <input
                type="datetime-local"
                className="timer-bar-since-input"
                value={startEdit}
                onChange={e => setStartEdit(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveStartEdit()
                  if (e.key === 'Escape') setEditingStart(false)
                }}
                autoFocus
              />
              <button className="timer-bar-since-ok" onClick={saveStartEdit} disabled={busy}>✓</button>
              <button className="timer-bar-since-cancel" onClick={() => setEditingStart(false)}>✕</button>
            </div>
          ) : (
            <button className="timer-bar-since" onClick={openStartEdit} title="Edit start time">
              since {new Date(parseInt(currentEntry.start)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </button>
          )
        )}
      </div>

      {capacity > 0 && (
        <div className="timer-bar-progress" title={`${formatDurationShort(total)} of ${formatDurationShort(capacity)} today`}>
          <div
            className={`timer-bar-progress-fill ${pct >= 1 ? 'timer-bar-progress-done' : ''}`}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
