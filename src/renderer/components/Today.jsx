import { useState, useEffect, useRef } from 'react'
import Timetable, { blockKey } from './Timetable.jsx'
import {
  getTimeEntries,
  updateTimeEntry,
  startTimer,
  stopTimer,
  createTask,
  getAllLists,
  getListColors,
} from '../lib/clickup.js'
import { formatDurationShort, formatTime, startOfDay, endOfDay } from '../lib/time.js'
import { useTaskSuggestions } from '../lib/useTaskSuggestions.js'
import './Today.css'

// One card per task (aggregated), one card per unassigned entry
function buildCards(entries, currentEntry, now) {
  const cards = new Map()
  const all = [...entries]
  if (currentEntry?.id && !all.some(e => e.id === currentEntry.id)) all.push(currentEntry)

  for (const e of all) {
    const key = blockKey(e)
    const isRunning = currentEntry?.id === e.id
    const dur = isRunning ? now - parseInt(e.start) : parseInt(e.duration || 0)
    let card = cards.get(key)
    if (!card) {
      card = {
        key,
        task: e.task || null,
        listId: e.task_location?.list_id || e.task?.list?.id || null,
        listName: e.task_location?.list_name || e.task?.list?.name || null,
        description: e.description || '',
        entries: [],
        total: 0,
        running: false,
        earliest: Infinity,
      }
      cards.set(key, card)
    }
    card.entries.push(e)
    card.total += Math.max(dur, 0)
    card.running = card.running || isRunning
    card.earliest = Math.min(card.earliest, parseInt(e.start))
    if (!card.description && e.description) card.description = e.description
  }
  // Mirror the timeline: first-tracked at the top; a task with several
  // entries is positioned by its first one
  return [...cards.values()].sort((a, b) => a.earliest - b.earliest)
}

export default function Today({ teamId, currentEntry, refreshKey, onChange, onTaskTracked }) {
  const [offset, setOffset] = useState(0) // days back from today
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [hoverKey, setHoverKey] = useState(null)
  const [dragCard, setDragCard] = useState(null)
  const [railW, setRailW] = useState(190)
  const [resizing, setResizing] = useState(false)
  const loadedRef = useRef(false)
  const bodyRef = useRef(null)

  const d = new Date(now)
  d.setDate(d.getDate() - offset)
  const day = startOfDay(d)
  const dayEndMs = endOfDay(d)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    window.api.store.get('rail_width').then(w => { if (w) setRailW(w) })
  }, [])

  const [listColors, setListColors] = useState({})
  useEffect(() => {
    getListColors(teamId).then(setListColors).catch(() => {})
  }, [teamId])

  function handleDividerMouseDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = railW
    setResizing(true)

    function onMove(ev) {
      const max = (bodyRef.current?.clientWidth || 600) * 0.6
      const next = Math.round(Math.min(Math.max(startW + ev.clientX - startX, 140), max))
      setRailW(next)
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setResizing(false)
      const max = (bodyRef.current?.clientWidth || 600) * 0.6
      const next = Math.round(Math.min(Math.max(startW + ev.clientX - startX, 140), max))
      window.api.store.set('rail_width', next)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!loadedRef.current) setLoading(true)
      try {
        // include the previous day so overnight entries can render their overflow
        const data = await getTimeEntries(teamId, day - 86400000, dayEndMs)
        if (!cancelled) setEntries(data || [])
        loadedRef.current = true
      } catch {}
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, day, refreshKey])

  async function reload() {
    try {
      const data = await getTimeEntries(teamId, day - 86400000, dayEndMs)
      setEntries(data || [])
    } catch {}
    onChange?.()
  }

  const cards = buildCards(
    entries.filter(e => {
      const s = parseInt(e.start)
      return s >= day && s <= dayEndMs
    }),
    offset === 0 ? currentEntry : null,
    now
  )
  const dayTotal = cards.reduce((s, c) => s + c.total, 0)

  const dayLabel = offset === 0
    ? 'Today'
    : offset === 1
      ? 'Yesterday'
      : new Date(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="today">
      <div className="today-header">
        <div className="today-nav">
          <button className="today-nav-btn" onClick={() => setOffset(o => o + 1)} title="Previous day">‹</button>
          <button
            className={`today-nav-label ${offset !== 0 ? 'today-nav-label-off' : ''}`}
            onClick={() => setOffset(0)}
            title={offset !== 0 ? 'Jump to today' : undefined}
          >
            {dayLabel}
          </button>
          <button
            className="today-nav-btn"
            onClick={() => setOffset(o => Math.max(0, o - 1))}
            disabled={offset === 0}
            title="Next day"
          >›</button>
        </div>
        <div className="today-total">
          <span className="today-total-label">total</span>
          <span className="today-total-value">{formatDurationShort(dayTotal)}</span>
        </div>
      </div>

      <div className={`today-body ${resizing ? 'today-body-resizing' : ''}`} ref={bodyRef}>
        <div className="today-rail" style={{ width: railW }}>
          {!loading && cards.length === 0 && (
            <div className="today-rail-empty">
              Nothing tracked{offset === 0 ? ' yet' : ''}.<br />
              <span className="today-rail-empty-dim">Drag on the timeline to add an entry.</span>
            </div>
          )}
          {cards.map(card => (
            <EntryCard
              key={card.key}
              card={card}
              teamId={teamId}
              isRunning={card.running}
              highlighted={hoverKey === card.key}
              onHover={setHoverKey}
              onChange={reload}
              onTaskTracked={onTaskTracked}
              currentEntry={currentEntry}
              onDragCard={setDragCard}
              dragCard={dragCard}
              color={card.listId ? listColors[card.listId] : null}
            />
          ))}
        </div>
        <div
          className="today-divider"
          onMouseDown={handleDividerMouseDown}
          title="Drag to resize"
        />
        <Timetable
          teamId={teamId}
          day={day}
          entries={entries}
          loading={loading}
          currentEntry={offset === 0 ? currentEntry : null}
          onChange={reload}
          onTaskTracked={onTaskTracked}
          hoverKey={hoverKey}
          onHoverBlock={setHoverKey}
          dragCard={dragCard}
          listColors={listColors}
        />
      </div>
    </div>
  )
}

function EntryCard({ card, teamId, isRunning, highlighted, onHover, onChange, onTaskTracked, currentEntry, onDragCard, dragCard, color }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(null) // null | 'assign' | 'create'
  const [dropOver, setDropOver] = useState(false)

  const name = card.task?.name || card.description || 'Untitled'
  const isUnassigned = !card.task
  const status = card.task?.status

  // Dropping an unassigned card onto this task card moves its entries here
  const canReceiveDrop =
    !!dragCard && !dragCard.task && dragCard.key !== card.key && !!card.task?.id

  async function receiveDrop() {
    setDropOver(false)
    if (!canReceiveDrop || busy) return
    setBusy(true)
    try {
      for (const e of dragCard.entries) {
        await updateTimeEntry(teamId, e.id, { tid: card.task.id })
      }
      await onChange()
      onTaskTracked?.(card.task.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handlePlay() {
    setBusy(true)
    try {
      if (currentEntry?.id) await stopTimer(teamId)
      await startTimer(teamId, card.task?.id || null, isUnassigned ? card.description : '')
      await onChange()
      if (card.task?.id) onTaskTracked?.(card.task.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleStop() {
    setBusy(true)
    try {
      await stopTimer(teamId)
      await onChange()
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Attach every entry of this card to the task (unassigned cards have one)
  async function attachTask(task) {
    setBusy(true)
    try {
      for (const e of card.entries) {
        await updateTimeEntry(teamId, e.id, { tid: task.id })
      }
      setMode(null)
      await onChange()
      onTaskTracked?.(task.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={[
        'entry-card',
        isRunning ? 'entry-card-running' : '',
        highlighted ? 'entry-card-hl' : '',
        dropOver ? 'entry-card-drop' : '',
      ].filter(Boolean).join(' ')}
      style={color && !isRunning ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}
      onMouseEnter={() => onHover(card.key)}
      onMouseLeave={() => onHover(null)}
      draggable={mode === null}
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('text/plain', name)
        onDragCard(card)
      }}
      onDragEnd={() => onDragCard(null)}
      onDragOver={e => {
        if (!canReceiveDrop) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropOver(true)
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={e => { e.preventDefault(); receiveDrop() }}
    >
      <div className="entry-card-top">
        <div className="entry-card-info">
          <div className="entry-card-name" title={name}>{name}</div>
          <div className="entry-card-meta">
            {isUnassigned ? (
              <span className="entry-card-unassigned">unassigned</span>
            ) : (
              <>
                {status?.status && (
                  <span className="entry-card-status" style={{ color: status.color || undefined }}>
                    {status.status}
                  </span>
                )}
                {card.listName && (
                  <span className="entry-card-list" style={color ? { color } : undefined}>
                    {card.listName}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="entry-card-side">
          <span className={`entry-card-total ${isRunning ? 'entry-card-total-live' : ''}`}>
            {formatDurationShort(card.total)}
          </span>
          {isRunning ? (
            <button className="entry-card-btn entry-card-btn-stop" onClick={handleStop} disabled={busy} title="Stop timer">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            </button>
          ) : (
            <button className="entry-card-btn" onClick={handlePlay} disabled={busy} title="Start timer">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="entry-card-times">
        {card.entries
          .slice()
          .sort((a, b) => parseInt(a.start) - parseInt(b.start))
          .map(e => {
            const s = parseInt(e.start)
            const running = currentEntry?.id === e.id
            return (
              <span key={e.id} className="entry-card-range">
                {formatTime(s)}–{running ? 'now' : formatTime(s + parseInt(e.duration || 0))}
              </span>
            )
          })}
        {!isUnassigned && card.task?.id && (
          <>
            <button
              className="entry-card-open"
              title="Open in ClickUp"
              onClick={() => window.api.shell.openExternal(`https://app.clickup.com/t/${card.task.id}`)}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
            </button>
            <button
              className="entry-card-open"
              title="Change task"
              onClick={() => setMode(mode === 'assign' ? null : 'assign')}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </>
        )}
      </div>

      {isUnassigned && mode === null && (
        <div className="entry-card-actions">
          <button className="entry-card-action" onClick={() => setMode('assign')}>Link task</button>
          <button className="entry-card-action entry-card-action-primary" onClick={() => setMode('create')}>
            + Create task
          </button>
        </div>
      )}

      {mode === 'assign' && (
        <AssignForm
          teamId={teamId}
          excludeId={card.task?.id ?? null}
          onPick={attachTask}
          onCancel={() => setMode(null)}
          busy={busy}
        />
      )}
      {mode === 'create' && (
        <CreateTaskForm
          teamId={teamId}
          initialName={card.description}
          onCreate={async (listId, taskName) => {
            setBusy(true)
            try {
              const task = await createTask(listId, taskName)
              for (const e of card.entries) {
                await updateTimeEntry(teamId, e.id, { tid: task.id })
              }
              setMode(null)
              await onChange()
              onTaskTracked?.(task.id)
            } catch (err) {
              alert(err.message)
            } finally {
              setBusy(false)
            }
          }}
          onCancel={() => setMode(null)}
          busy={busy}
        />
      )}
    </div>
  )
}

function AssignForm({ teamId, excludeId = null, onPick, onCancel, busy }) {
  const [query, setQuery] = useState('')
  // Recents show before typing; local matches stay visible while the
  // server search runs, same behavior as the timer bar dropdown
  const { tasks, settled } = useTaskSuggestions(teamId, undefined, query, { limit: 6, excludeId })

  return (
    <div className="entry-card-form">
      <input
        className="draft-input"
        autoFocus
        placeholder="Search tasks…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
      />
      <div className="edit-task-results">
        {tasks.length === 0 && !settled && <div className="edit-task-empty">Searching…</div>}
        {tasks.length === 0 && settled && query.trim() && <div className="edit-task-empty">No tasks found.</div>}
        {tasks.map(t => (
          <button key={t.id} className="edit-task-result" disabled={busy} onClick={() => onPick(t)}>
            <span className="edit-task-result-name">{t.name}</span>
            {t.list && <span className="edit-task-result-meta">{t.list}</span>}
          </button>
        ))}
      </div>
      <div className="draft-actions">
        <button className="draft-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function CreateTaskForm({ teamId, initialName, onCreate, onCancel, busy }) {
  const [name, setName] = useState(initialName || '')
  const [recents, setRecents] = useState([])
  const [picked, setPicked] = useState(null)
  const [allLists, setAllLists] = useState(null) // null = not loaded
  const [listQuery, setListQuery] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [listsLoading, setListsLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.store.get('recent_lists'),
      window.api.store.get('last_list'),
    ]).then(([saved, last]) => {
      const seen = new Set()
      const merged = [...(saved || []), ...(last ? [last] : [])]
        .filter(l => l?.id && !seen.has(l.id) && seen.add(l.id))
        .slice(0, 4)
      setRecents(merged)
      if (merged[0]) setPicked(merged[0])
    })
  }, [])

  async function browseAll() {
    setBrowsing(true)
    if (allLists === null) {
      setListsLoading(true)
      try {
        setAllLists(await getAllLists(teamId))
      } catch {
        setAllLists([])
      } finally {
        setListsLoading(false)
      }
    }
  }

  async function submit() {
    const n = name.trim()
    if (!n || !picked) return
    const seen = new Set([picked.id])
    const nextRecents = [
      { id: picked.id, name: picked.name },
      ...recents.filter(l => !seen.has(l.id)),
    ].slice(0, 4)
    window.api.store.set('recent_lists', nextRecents)
    await onCreate(picked.id, n)
  }

  const q = listQuery.trim().toLowerCase()
  const filtered = (allLists || [])
    .filter(l => !q || l.name.toLowerCase().includes(q) || l.path.toLowerCase().includes(q))
    .slice(0, 8)

  return (
    <div className="entry-card-form">
      <input
        className="draft-input"
        autoFocus
        placeholder="Task name"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="create-list-row">
        <span className="create-list-label">in</span>
        {recents.map(l => (
          <button
            key={l.id}
            className={`create-list-chip ${picked?.id === l.id ? 'create-list-chip-active' : ''}`}
            onClick={() => { setPicked(l); setBrowsing(false) }}
          >
            {l.name}
          </button>
        ))}
        <button
          className={`create-list-chip ${browsing || (picked && !recents.some(l => l.id === picked.id)) ? 'create-list-chip-active' : ''}`}
          onClick={browseAll}
        >
          {picked && !recents.some(l => l.id === picked.id) ? picked.name : 'All lists…'}
        </button>
      </div>
      {browsing && (
        <>
          <input
            className="draft-input"
            placeholder="Filter lists…"
            value={listQuery}
            onChange={e => setListQuery(e.target.value)}
          />
          <div className="edit-task-results">
            {listsLoading && <div className="edit-task-empty">Loading lists…</div>}
            {!listsLoading && filtered.length === 0 && <div className="edit-task-empty">No lists found.</div>}
            {filtered.map(l => (
              <button
                key={l.id}
                className="edit-task-result"
                onClick={() => { setPicked({ id: l.id, name: l.name }); setBrowsing(false) }}
              >
                <span className="edit-task-result-name">{l.name}</span>
                <span className="edit-task-result-meta">{l.path}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="draft-actions">
        <button className="draft-cancel" onClick={onCancel}>Cancel</button>
        <button className="draft-save" onClick={submit} disabled={busy || !name.trim() || !picked}>
          {busy ? 'Creating…' : `Create${picked ? ` in ${picked.name}` : ''}`}
        </button>
      </div>
    </div>
  )
}
