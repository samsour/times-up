import { useState, useEffect, useRef } from 'react'
import {
  startTimer,
  stopTimer,
  updateTimeEntry,
  getTimeEntries,
  createTask,
} from '../lib/clickup.js'
import { formatDuration, formatDurationShort, formatTime, startOfDay, endOfDay } from '../lib/time.js'
import { getGoals } from '../lib/goals.js'
import { useTaskSuggestions } from '../lib/useTaskSuggestions.js'
import { CreateTaskForm } from './CreateTask.jsx'
import './TimerBar.css'

// Compact always-visible timer strip: start/stop, elapsed, task switch,
// start-time edit and the daily goal as a hairline progress bar.
export default function TimerBar({ teamId, userId, currentEntry, pomo, onBrowse, onChange, onTaskTracked, onOpenFocus }) {
  const [elapsed, setElapsed] = useState(0)
  const [pomoLeft, setPomoLeft] = useState(0)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [editingStart, setEditingStart] = useState(false)
  const [startEdit, setStartEdit] = useState('')
  const [switching, setSwitching] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [capacity, setCapacity] = useState(0)
  const [completedToday, setCompletedToday] = useState(0)
  const inputRef = useRef(null)

  const isRunning = !!currentEntry
  const runningTask = currentEntry?.task || null
  // Running without a task: one field is both the note and the task search.
  // Text left in it is the description; a picked row assigns the task.
  const noteMode = isRunning && !runningTask && !switching
  const text = noteMode ? noteDraft : query
  const setText = noteMode ? setNoteDraft : setQuery
  const [navigated, setNavigated] = useState(false) // arrow keys used, so Enter picks
  const [creating, setCreating] = useState(false) // the new-task form under the field

  const { tasks: taskItems, settled: searchSettled } = useTaskSuggestions(teamId, userId, text, {
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

  // Countdown of the current block or break, ticking locally from endsAt
  const pomoEndsAt = pomo?.endsAt || null
  useEffect(() => {
    if (!pomoEndsAt) { setPomoLeft(0); return }
    const update = () => setPomoLeft(Math.max(0, pomoEndsAt - Date.now()))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [pomoEndsAt])

  const pomoOn = !!pomo?.enabled
  const inFocus = pomoOn && pomo.phase === 'focus' && isRunning
  const inBreak = pomoOn && (pomo.phase === 'short' || pomo.phase === 'long')

  function togglePomodoro() {
    window.api.store.set('pomodoro_mode', !pomoOn)
  }

  useEffect(() => {
    getGoals().then(g => setCapacity(g.dailyMs))
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
      // A bare Start in Pomodoro mode still needs something to show in ClickUp
      await startTimer(teamId, null, desc || (pomoOn ? 'Pomodoro' : ''))
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

  async function handleCreateTask(listId, name) {
    if (!name || !listId) return
    setBusy(true)
    try {
      const task = await createTask(listId, name)
      if (isRunning) {
        await updateTimeEntry(teamId, currentEntry.id, { tid: task.id })
      } else {
        await startTimer(teamId, task.id, '')
      }
      setQuery('')
      setOpen(false)
      setSwitching(false)
      setCreating(false)
      onChange()
      onTaskTracked?.(task.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveNote() {
    if (!isRunning || runningTask || noteDraft === (currentEntry.description || '')) return
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

  const q = text.trim().toLowerCase()
  const showStartNote = !isRunning && q.length > 0
  const noMatch = q.length > 0 && searchSettled && taskItems.length === 0
  // Row order mirrors the render. With matches: optional "start unassigned",
  // then the tasks. With none: "create" first, then "start unassigned"
  // Row order, which the keyboard follows: what the search produced first
  // (the tasks, or the create row when nothing matched), then "start
  // unassigned" as the fallback, then browse. Enter on the first row is
  // therefore the most likely intent
  const rowCount = (noMatch ? 1 : taskItems.length) + (showStartNote ? 1 : 0) + 1
  const browseIdx = rowCount - 1
  const noteIdx = showStartNote ? browseIdx - 1 : -1
  const browse = () => { setOpen(false); onBrowse(taskItems.length > 0 ? text.trim() : '') }

  function rowAction(idx) {
    if (idx === browseIdx) return browse
    if (idx === noteIdx) return () => startUnassigned(text.trim())
    if (noMatch) return idx === 0 ? () => { setOpen(false); setCreating(true) } : null
    if (idx < taskItems.length) return () => pickTask(taskItems[idx])
    return null
  }

  const PlusIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M12 5v14M5 12h14" /></svg>
  const PlayIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
  const GridIcon = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M4 6h16M4 12h16M4 18h16" /></svg>

  function handleKeys(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setNavigated(true)
      setHighlight(h => Math.min(h + 1, rowCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setNavigated(true)
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      // In note mode Enter keeps the text as the description unless a row
      // was deliberately chosen with the arrow keys
      if (noteMode && !navigated) { e.target.blur(); return }
      const action = rowAction(highlight)
      if (action) action()
      else if (!isRunning) startUnassigned(text.trim())
    } else if (e.key === 'Escape') {
      e.target.blur()
    }
  }

  const showSearchInput = !isRunning || switching || noteMode
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

        {isRunning && !inFocus && (
          <button
            className="timer-bar-time timer-bar-clock"
            onClick={editingStart ? () => setEditingStart(false) : openStartEdit}
            title={`Started ${formatTime(currentEntry.start)} · click to change`}
          >
            <span>{formatDuration(elapsed)}</span>
            <span className="timer-bar-clock-since">since {formatTime(currentEntry.start)}</span>
          </button>
        )}
        {inFocus && (
          <button className="timer-bar-time timer-bar-time-pomo" onClick={onOpenFocus} title={`Block ends in ${formatDuration(pomoLeft)} · ${formatDuration(elapsed)} tracked. Open Focus`}>
            {formatDuration(pomoLeft)}
          </button>
        )}

        <div className="timer-bar-middle">
          {inBreak ? (
            <div className="timer-bar-break">
              <span className="timer-bar-break-label">
                {pomo.phase === 'long' ? 'Long break' : 'Short break'} · {formatDuration(pomoLeft)}
              </span>
              <button className="timer-bar-break-btn" onClick={() => window.api.pomo.skip()} title={isRunning ? 'End the break and start the next block' : 'End the break now'}>Skip</button>
            </div>
          ) : showSearchInput ? (
            <>
              <input
                ref={inputRef}
                className={`timer-bar-input ${noteMode ? 'timer-bar-note' : ''} ${switching ? 'timer-bar-input-closable' : ''}`}
                placeholder={noteMode
                  ? 'What are you working on? Pick a task or leave a note'
                  : isRunning ? 'Switch task…' : pomoOn ? 'What will you focus on?' : 'Start a task or note…'}
                value={text}
                onChange={e => { setText(e.target.value); setHighlight(0); setNavigated(false) }}
                onFocus={() => { setOpen(true); setNavigated(false) }}
                onBlur={() => { setOpen(false); setNavigated(false); if (switching) setSwitching(false); if (noteMode) saveNote() }}
                onKeyDown={handleKeys}
                autoFocus={switching}
                maxLength={noteMode ? 200 : undefined}
              />
              {switching && (
                <button
                  className="timer-bar-input-close"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setSwitching(false); setQuery(''); setOpen(false) }}
                  title="Keep the current task (Esc)"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              )}
              {creating && (
                <div className="timer-bar-dropdown timer-bar-create">
                  <CreateTaskForm
                    teamId={teamId}
                    initialName={text.trim() || currentEntry?.description || ''}
                    busy={busy}
                    onCreate={(listId, name) => handleCreateTask(listId, name)}
                    onCancel={() => { setCreating(false); inputRef.current?.focus() }}
                  />
                </div>
              )}
              {open && !creating && (
                <div className="timer-bar-dropdown">
                  {noMatch ? (
                    <>
                      <div className="suggestion-note">No task called “{text.trim()}”.</div>
                      <button
                        className={`suggestion-row suggestion-row-action ${highlight === 0 ? 'suggestion-row-active' : ''}`}
                        onMouseDown={e => e.preventDefault()}
                        onMouseEnter={() => setHighlight(0)}
                        onClick={() => { setOpen(false); setCreating(true) }}
                        disabled={busy}
                      >
                        <span className="suggestion-row-icon"><PlusIcon /></span>
                        <span className="suggestion-row-name">Create task “{text.trim()}”</span>
                      </button>
                    </>
                  ) : (
                    <>
                      {taskItems.map((task, i) => (
                        <button
                          key={task.id}
                          className={`suggestion-row ${highlight === i ? 'suggestion-row-active' : ''}`}
                          onMouseDown={e => e.preventDefault()}
                          onMouseEnter={() => setHighlight(i)}
                          onClick={() => pickTask(task)}
                          disabled={busy}
                        >
                          <span className="suggestion-row-name">{task.name}</span>
                          <span className="suggestion-row-meta">
                            <span className="suggestion-row-list">{task.list || '—'}</span>
                            {task.status && (
                              <span className="suggestion-row-status">
                                <span className="suggestion-row-dot" style={{ background: task.statusColor || 'var(--text-muted)' }} />
                                {task.status}
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                      {q && !searchSettled && taskItems.length === 0 && (
                        <div className="suggestion-note">Searching…</div>
                      )}
                    </>
                  )}
                  {showStartNote && (
                    <button
                      className={`suggestion-row suggestion-row-action ${highlight === noteIdx ? 'suggestion-row-active' : ''}`}
                      onMouseDown={e => e.preventDefault()}
                      onMouseEnter={() => setHighlight(noteIdx)}
                      onClick={() => startUnassigned(text.trim())}
                      disabled={busy}
                    >
                      <span className="suggestion-row-icon"><PlayIcon /></span>
                      <span className="suggestion-row-name">Start unassigned “{text.trim()}”</span>
                    </button>
                  )}
                  {/* Carry the query over when it found something, so the
                      same results get the roomier list; a miss starts clean */}
                  <button
                    className={`suggestion-row suggestion-row-action ${highlight === browseIdx ? 'suggestion-row-active' : ''}`}
                    onMouseDown={e => e.preventDefault()}
                    onMouseEnter={() => setHighlight(browseIdx)}
                    onClick={browse}
                  >
                    <span className="suggestion-row-icon"><GridIcon /></span>
                    <span className="suggestion-row-name">{taskItems.length > 0 && q ? 'Show all results' : 'Browse all tasks'}</span>
                    <span className="suggestion-row-arrow">→</span>
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
          ) : null}
        </div>

        {isRunning && !inFocus && editingStart && (
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
        )}

        <button
          className={`timer-bar-pomo ${pomoOn ? 'timer-bar-pomo-on' : ''}`}
          onClick={pomoOn ? onOpenFocus : togglePomodoro}
          title={pomoOn ? 'Open Focus' : 'Pomodoro mode: timed focus blocks with breaks'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2.5M9 3h6" />
          </svg>
        </button>
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
