import { useState, useEffect } from 'react'
import { startTimer, stopTimer, getTimeEntries, createTask } from '../lib/clickup.js'
import { CreateTaskForm } from './CreateTask.jsx'
import { formatDuration, formatDurationShort, formatTime, startOfDay, endOfDay } from '../lib/time.js'
import { useTaskSuggestions } from '../lib/useTaskSuggestions.js'
import './Focus.css'

// The Pomodoro surface: phase, big clock, the one task you are on, and a
// way to start or stop. Nothing to review here; that is what Today is for.
export default function Focus({ teamId, userId, currentEntry, pomo, refreshKey, onChange, onTaskTracked, onExit }) {
  const [left, setLeft] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [todayEntries, setTodayEntries] = useState([])
  const [creating, setCreating] = useState(false) // the new-task form

  const isRunning = !!currentEntry
  const phase = pomo?.phase || null
  const inFocus = phase === 'focus' && isRunning
  const inBreak = phase === 'short' || phase === 'long'
  const phaseKey = inFocus ? 'focus' : inBreak ? phase : 'ready'

  const { tasks, settled } = useTaskSuggestions(teamId, userId, query, {
    limit: 6,
    excludeId: currentEntry?.task?.id ?? null,
    refreshKey,
  })

  // One ticker for the countdown and the elapsed time
  const endsAt = pomo?.endsAt || null
  const startMs = currentEntry ? parseInt(currentEntry.start) : null
  useEffect(() => {
    const update = () => {
      const now = Date.now()
      setLeft(endsAt ? Math.max(0, endsAt - now) : 0)
      setElapsed(startMs ? now - startMs : 0)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [endsAt, startMs])

  useEffect(() => {
    getTimeEntries(teamId, startOfDay(), endOfDay())
      .then(d => setTodayEntries(d || []))
      .catch(() => {})
  }, [teamId, refreshKey, currentEntry?.id])

  const finished = todayEntries.filter(e => e.id !== currentEntry?.id)
  const dayTotal = finished.reduce((s, e) => s + Math.max(parseInt(e.duration || 0), 0), 0) + elapsed
  const sameTask = e => currentEntry?.task?.id
    ? e.task?.id === currentEntry.task.id
    : !e.task && (e.description || '') === (currentEntry?.description || '')
  const taskTotal = finished.filter(sameTask).reduce((s, e) => s + Math.max(parseInt(e.duration || 0), 0), 0) + elapsed

  async function start(task, desc) {
    setBusy(true)
    try {
      await startTimer(teamId, task?.id || null, task ? '' : (desc?.trim() || 'Pomodoro'))
      setQuery('')
      onChange?.()
      if (task?.id) onTaskTracked?.(task.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  // New task in a list, then straight into a block on it
  async function createAndStart(listId, name) {
    setBusy(true)
    try {
      const task = await createTask(listId, name)
      await startTimer(teamId, task.id, '')
      setQuery('')
      setCreating(false)
      onChange?.()
      onTaskTracked?.(task.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      await stopTimer(teamId)
      onChange?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const clockMs = (inFocus || inBreak) ? left : (pomo?.lengths?.focus || 0)
  const label = currentEntry?.task?.name || currentEntry?.description || 'Untitled'
  const round = pomo?.round || 1
  const every = pomo?.every || 4
  const caption = inFocus
    ? 'Time to focus'
    : inBreak
      ? (phase === 'long' ? 'Long break, step away' : 'Short break')
      : 'Ready for the next block'

  return (
    <div className="focus">
      <div className="pomo-phases">
        <button
          className={`pomo-phase ${phaseKey === 'focus' || phaseKey === 'ready' ? 'pomo-phase-on' : ''}`}
          onClick={() => { if (inBreak) window.api.pomo.skip() }}
          title={inBreak ? 'End the break and get ready' : 'Focus block'}
        >
          Focus
        </button>
        <button
          className={`pomo-phase ${phaseKey === 'short' ? 'pomo-phase-on' : ''}`}
          onClick={() => window.api.pomo.startBreak('short')}
          disabled={inFocus}
          title={inFocus ? 'Stop the block first' : 'Take a short break now'}
        >
          Short break
        </button>
        <button
          className={`pomo-phase ${phaseKey === 'long' ? 'pomo-phase-on' : ''}`}
          onClick={() => window.api.pomo.startBreak('long')}
          disabled={inFocus}
          title={inFocus ? 'Stop the block first' : 'Take a long break now'}
        >
          Long break
        </button>
        <button className="pomo-exit" onClick={onExit} title="Leave Pomodoro mode">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className={`focus-clock focus-clock-${phaseKey}`} title={inFocus ? `${formatDuration(elapsed)} tracked on this entry` : undefined}>
        {formatDuration(clockMs)}
      </div>
      <div className="focus-caption">
        <span className="pomo-cycle" title={`Block ${round} of ${every}. The break after block ${every} is the long one`}>
          {Array.from({ length: every }, (_, i) => (
            <span
              key={i}
              className={`pomo-dot ${i < round - 1 ? 'pomo-dot-done' : i === round - 1 && !inBreak ? 'pomo-dot-now' : ''}`}
            />
          ))}
        </span>
        {caption}
      </div>

      {isRunning ? (
        <div className="focus-card">
          <div className="focus-card-main">
            <div className="focus-card-name">{label}</div>
            <div className="focus-card-meta">
              {formatDurationShort(taskTotal)} today · since {formatTime(startMs)}
              {inBreak && ' · timer keeps running'}
            </div>
          </div>
          {inFocus && (
            <button className="focus-mini" onClick={() => window.api.pomo.extend(5)} title="Add five minutes to this block">+5</button>
          )}
          {inBreak && (
            <>
              <button className="focus-mini" onClick={() => window.api.pomo.extend(5)} title="Five more minutes">+5</button>
              <button className="focus-mini" onClick={() => window.api.pomo.skip()} title="End the break and start the next block">Skip</button>
            </>
          )}
          <button className="focus-stop" onClick={stop} disabled={busy} title="Stop the timer and end the session">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            Stop
          </button>
        </div>
      ) : inBreak ? (
        <div className="focus-card">
          <div className="focus-card-main">
            <div className="focus-card-name">{pomo.task?.name || pomo.description || 'Break'}</div>
            <div className="focus-card-meta">Next block starts after the break</div>
          </div>
          <button className="focus-mini" onClick={() => window.api.pomo.extend(5)} title="Five more minutes">+5</button>
          <button className="focus-mini" onClick={() => window.api.pomo.skip()} title="End the break now">Skip</button>
        </div>
      ) : (
        <div className="focus-start">
          <div className="focus-start-row">
            <input
              className="focus-input"
              placeholder="What will you focus on?"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') start(null, query) }}
              autoFocus
            />
            <button className="focus-go" onClick={() => start(null, query)} disabled={busy}>
              Start
            </button>
          </div>
          {creating ? (
            <CreateTaskForm
              teamId={teamId}
              initialName={query.trim()}
              busy={busy}
              onCreate={createAndStart}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <div className="focus-recent">
              {tasks.map(t => (
                <button key={t.id} className="focus-recent-row" onClick={() => start(t)} disabled={busy}>
                  <span className="focus-recent-name">{t.name}</span>
                  {t.list && <span className="focus-recent-list">{t.list}</span>}
                </button>
              ))}
              {query.trim() && settled && tasks.length === 0 && (
                <>
                  <div className="focus-recent-note">No task called “{query.trim()}”.</div>
                  <button className="focus-recent-row focus-recent-create" onClick={() => setCreating(true)} disabled={busy}>
                    <span className="focus-recent-name">+ Create task “{query.trim()}”</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="focus-footer">
        {formatDurationShort(dayTotal)} today
        {pomo?.completed > 0 && ` · ${pomo.completed} block${pomo.completed === 1 ? '' : 's'} done`}
      </div>
    </div>
  )
}
