import { useState, useEffect, useRef } from 'react'
import { getSpaces, getFolders, getFolderlessLists, getListsInFolder, getTasks, createTask, getAllLists } from '../lib/clickup.js'
import { useTaskSuggestions } from '../lib/useTaskSuggestions.js'
import { CreateTaskForm } from './CreateTask.jsx'
import './TaskPicker.css'

// defaultName: what a new task is called when nothing was searched for,
// typically the running entry's note
export default function TaskPicker({ teamId, userId, initialSearch = '', defaultName = '', onPick, onCancel }) {
  const [crumbs, setCrumbs] = useState([{ type: 'team', name: 'Spaces' }])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState(initialSearch)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState(null) // inline "new task" row inside a list, null = closed
  const [creating, setCreating] = useState(false) // list picker form, from a search with no match
  const [busy, setBusy] = useState(false)
  const [allLists, setAllLists] = useState(null) // for matching lists while searching
  const pendingNewName = useRef(null) // name to offer once a list opened from a search has loaded

  // Lists are searchable too, loaded the first time a query is typed
  useEffect(() => {
    if (!search.trim() || allLists !== null) return
    getAllLists(teamId).then(ls => setAllLists(ls || [])).catch(() => setAllLists([]))
  }, [search, teamId, allLists])

  const qLower = search.trim().toLowerCase()
  const listMatches = qLower
    ? (allLists || []).filter(l => l.name.toLowerCase().includes(qLower) || (l.path || '').toLowerCase().includes(qLower)).slice(0, 4)
    : []

  // Open a list from a search; the typed text becomes the new task's name
  function openListFromSearch(l) {
    pendingNewName.current = search.trim()
    setCrumbs([crumbs[0], { type: 'list', id: l.id, name: l.name }])
  }

  // Create, then hand the new task over as if it had been picked
  async function createAndPick(listId, name) {
    const n = name.trim()
    if (!n) return
    setBusy(true)
    try {
      const task = await createTask(listId, n)
      onPick({ id: task.id, name: task.name })
    } catch (e) {
      alert(e.message)
    } finally {
      setBusy(false)
    }
  }

  const { tasks: searchResults, settled } = useTaskSuggestions(teamId, userId, search, { limit: 12 })
  // With no query the hook yields recent and assigned tasks: a shortcut
  // row at the top level, before drilling into spaces
  const recent = !search.trim() ? searchResults.slice(0, 5) : []

  const current = crumbs[crumbs.length - 1]
  const [highlight, setHighlight] = useState(0)
  const listRef = useRef(null)

  useEffect(() => {
    loadCurrent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crumbs])

  async function loadCurrent() {
    setLoading(true)
    setError('')
    if (crumbs.length > 1 || !initialSearch) setSearch('')
    setNewName(null)
    try {
      let result = []
      if (current.type === 'team') {
        const spaces = await getSpaces(teamId)
        result = spaces.map(s => ({ kind: 'space', id: s.id, name: s.name, color: s.color }))
      } else if (current.type === 'space') {
        const [folders, lists] = await Promise.all([
          getFolders(current.id),
          getFolderlessLists(current.id)
        ])
        result = [
          ...folders.map(f => ({ kind: 'folder', id: f.id, name: f.name })),
          ...lists.map(l => ({ kind: 'list', id: l.id, name: l.name }))
        ]
      } else if (current.type === 'folder') {
        const lists = await getListsInFolder(current.id)
        result = lists.map(l => ({ kind: 'list', id: l.id, name: l.name }))
      } else if (current.type === 'list') {
        const tasks = await getTasks(current.id)
        result = tasks.map(t => ({
          kind: 'task',
          id: t.id,
          name: t.name,
          status: t.status?.status,
          statusColor: t.status?.color
        }))
      }
      setItems(result)
      // Arrived here from a search: offer the typed name as a new task
      if (current.type === 'list' && pendingNewName.current !== null) {
        setNewName(pendingNewName.current)
        pendingNewName.current = null
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function drill(item) {
    if (item.kind === 'task') {
      onPick({ id: item.id, name: item.name })
    } else {
      const typeMap = { space: 'space', folder: 'folder', list: 'list' }
      setCrumbs([...crumbs, { type: typeMap[item.kind], id: item.id, name: item.name }])
    }
  }

  function jumpTo(idx) {
    setCrumbs(crumbs.slice(0, idx + 1))
  }

  const isSearching = search.trim().length > 0

  // Every clickable row in render order, so the arrow keys can walk them
  const rows = []
  if (!isSearching) {
    if (current.type === 'team') {
      for (const t of recent) rows.push({ key: `recent-${t.id}`, run: () => onPick({ id: t.id, name: t.name }) })
    }
    if (!loading && !error) {
      for (const g of groupItems(items, current.type)) {
        if (g.label === 'Tasks' && newName === null) rows.push({ key: 'new', run: () => setNewName(defaultName) })
        for (const item of g.items) rows.push({ key: `${item.kind}-${item.id}`, run: () => drill(item) })
      }
    }
  } else if (!creating) {
    for (const l of listMatches) rows.push({ key: `list-${l.id}`, run: () => openListFromSearch(l) })
    for (const t of searchResults) rows.push({ key: `task-${t.id}`, run: () => onPick({ id: t.id, name: t.name }) })
    if (settled) rows.push({ key: 'create', run: () => setCreating(true) })
  }
  const rowIdx = key => rows.findIndex(r => r.key === key)
  const rowProps = key => {
    const i = rowIdx(key)
    return {
      className: `picker-item ${i === highlight ? 'picker-item-active' : ''}`,
      onMouseEnter: () => setHighlight(i),
    }
  }

  // Back to the first row whenever the list changes under the cursor
  useEffect(() => { setHighlight(0) }, [search, crumbs, items.length, searchResults.length])

  // Keep the highlighted row in view
  useEffect(() => {
    listRef.current?.querySelector('.picker-item-active')?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  function handleKeys(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
      if (rows[highlight]) { e.preventDefault(); rows[highlight].run() }
    } else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && !search) {
      // Up one level, like a folder tree
      if (crumbs.length > 1) { e.preventDefault(); jumpTo(crumbs.length - 2) }
    } else if (e.key === 'Escape') {
      if (search) setSearch('')
      else onCancel()
    }
  }

  return (
    <div className="picker">
      <div className="picker-bar">
        <button className="picker-back" onClick={onCancel} title="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="picker-search-wrap">
          <svg className="picker-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            className="picker-search"
            placeholder="Search tasks"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleKeys}
            autoFocus
          />
          {search && (
            <button className="picker-search-clear" onClick={() => setSearch('')} title="Clear">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      {!isSearching && (
        <div className="picker-crumbs">
          {crumbs.map((c, i) => (
            <span key={i} className="crumb-group">
              <button
                className={`crumb ${i === crumbs.length - 1 ? 'crumb-active' : ''}`}
                onClick={() => jumpTo(i)}
              >
                {c.name}
              </button>
              {i < crumbs.length - 1 && <span className="crumb-sep">›</span>}
            </span>
          ))}
        </div>
      )}

      <div className="picker-list" ref={listRef}>
        {/* Normal drill-down mode */}
        {!isSearching && current.type === 'team' && recent.length > 0 && (
          <>
            <div className="picker-section">Recent</div>
            {recent.map(task => (
              <button key={task.id} {...rowProps(`recent-${task.id}`)} onClick={() => onPick({ id: task.id, name: task.name })}>
                <span className="picker-icon picker-icon-task">{iconFor('task')}</span>
                <span className="picker-item-info">
                  <span className="picker-item-name">{task.name}</span>
                  {task.list && <span className="picker-item-context">{task.list}</span>}
                </span>
                {task.status && <StatusPill status={task.status} color={task.statusColor} />}
              </button>
            ))}
          </>
        )}
        {!isSearching && loading && (
          <div className="picker-skeleton">
            {[0, 1, 2, 3].map(i => <div key={i} className="picker-skeleton-row" style={{ opacity: 1 - i * 0.2 }} />)}
          </div>
        )}
        {!isSearching && error && <div className="picker-error">{error}</div>}
        {!isSearching && !loading && !error && items.length === 0 && (
          <div className="picker-empty">Nothing in here.</div>
        )}
        {!isSearching && !loading && !error && groupItems(items, current.type).map(group => (
          <div key={group.label}>
            <div className="picker-section">{group.label}</div>
            {group.label === 'Tasks' && (
              newName === null ? (
                <button {...rowProps('new')} className={`${rowProps('new').className} picker-item-create`} onClick={() => setNewName(defaultName)}>
                  <span className="picker-icon picker-icon-create">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
                  </span>
                  <span className="picker-item-name">New task in {current.name}</span>
                </button>
              ) : (
                <div className="picker-item picker-item-new">
                  <span className="picker-icon picker-icon-create">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
                  </span>
                  <input
                    className="picker-new-input"
                    placeholder="Task name"
                    value={newName}
                    autoFocus
                    disabled={busy}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') createAndPick(current.id, newName)
                      if (e.key === 'Escape') setNewName(null)
                    }}
                  />
                  <button className="picker-new-go" onClick={() => createAndPick(current.id, newName)} disabled={busy || !newName.trim()}>
                    {busy ? '…' : 'Create'}
                  </button>
                </div>
              )
            )}
            {group.items.map(item => (
              <button key={`${item.kind}-${item.id}`} {...rowProps(`${item.kind}-${item.id}`)} onClick={() => drill(item)}>
                <span
                  className={`picker-icon picker-icon-${item.kind}`}
                  style={item.color ? { background: `color-mix(in srgb, ${item.color} 18%, transparent)`, color: item.color } : undefined}
                >
                  {iconFor(item.kind)}
                </span>
                <span className="picker-item-name">{item.name}</span>
                {item.status && <StatusPill status={item.status} color={item.statusColor} />}
                {item.kind !== 'task' && (
                  <svg className="picker-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        ))}

        {/* Search results mode: local matches render instantly and stay
            visible while the server search tops the list up */}
        {isSearching && !settled && searchResults.length === 0 && (
          <div className="picker-skeleton">
            {[0, 1, 2].map(i => <div key={i} className="picker-skeleton-row" style={{ opacity: 1 - i * 0.25 }} />)}
          </div>
        )}
        {isSearching && creating && (
          <div className="picker-create-form">
            <CreateTaskForm
              teamId={teamId}
              initialName={search.trim() || defaultName}
              busy={busy}
              onCreate={createAndPick}
              onCancel={() => setCreating(false)}
            />
          </div>
        )}
        {isSearching && !creating && listMatches.length > 0 && (
          <>
            <div className="picker-section">Lists</div>
            {listMatches.map(l => (
              <button key={`list-${l.id}`} {...rowProps(`list-${l.id}`)} onClick={() => openListFromSearch(l)} title={`Open ${l.name}; the text becomes the new task's name`}>
                <span className="picker-icon picker-icon-list" style={l.color ? { background: `color-mix(in srgb, ${l.color} 18%, transparent)`, color: l.color } : undefined}>{iconFor('list')}</span>
                <span className="picker-item-info">
                  <span className="picker-item-name">{l.name}</span>
                  {l.path && <span className="picker-item-context">{l.path}</span>}
                </span>
                <svg className="picker-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            ))}
            {searchResults.length > 0 && <div className="picker-section">Tasks</div>}
          </>
        )}
        {isSearching && !creating && searchResults.map(task => (
          <button
            key={task.id}
            {...rowProps(`task-${task.id}`)}
            onClick={() => onPick({ id: task.id, name: task.name })}
          >
            <span className="picker-icon picker-icon-task">{iconFor('task')}</span>
            <span className="picker-item-info">
              <span className="picker-item-name">{task.name}</span>
              {task.list && <span className="picker-item-context">{task.list}</span>}
            </span>
            {task.status && <StatusPill status={task.status} color={task.statusColor} />}
          </button>
        ))}
        {isSearching && !creating && settled && (
          <>
            {searchResults.length === 0 && <div className="picker-empty">No task called “{search.trim()}”.</div>}
            <button {...rowProps('create')} className={`${rowProps('create').className} picker-item-create`} onClick={() => setCreating(true)} disabled={busy}>
              <span className="picker-icon picker-icon-create">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
              </span>
              <span className="picker-item-name">Create task “{search.trim()}”</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Status as a coloured dot plus quiet text, not a shouting box
function StatusPill({ status, color }) {
  return (
    <span className="picker-status">
      <span className="picker-status-dot" style={{ background: color || 'var(--text-muted)' }} />
      {status}
    </span>
  )
}

// Section headings per level, so a space shows its folders and lists apart
function groupItems(items, level) {
  if (level === 'team') return [{ label: 'Spaces', items }]
  if (level === 'space') {
    const folders = items.filter(i => i.kind === 'folder')
    const lists = items.filter(i => i.kind === 'list')
    return [
      ...(folders.length ? [{ label: 'Folders', items: folders }] : []),
      ...(lists.length ? [{ label: 'Lists', items: lists }] : []),
    ]
  }
  if (level === 'folder') return [{ label: 'Lists', items }]
  return [{ label: 'Tasks', items }]
}

function iconFor(kind) {
  if (kind === 'space') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
      </svg>
    )
  }
  if (kind === 'folder') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
    )
  }
  if (kind === 'list') {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    )
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h11" />
    </svg>
  )
}
