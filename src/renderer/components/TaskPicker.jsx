import { useState, useEffect } from 'react'
import { getSpaces, getFolders, getFolderlessLists, getListsInFolder, getTasks } from '../lib/clickup.js'
import './TaskPicker.css'

export default function TaskPicker({ teamId, onPick, onCancel }) {
  // breadcrumb: [{ type: 'team', name }, { type: 'space', id, name }, ...]
  const [crumbs, setCrumbs] = useState([{ type: 'team', name: 'Spaces' }])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const current = crumbs[crumbs.length - 1]

  useEffect(() => {
    loadCurrent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crumbs])

  async function loadCurrent() {
    setLoading(true)
    setError('')
    setSearch('')
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

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="picker">
      <div className="picker-bar">
        <button className="picker-back" onClick={onCancel}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <input
          className="picker-search"
          placeholder={`Filter ${current.type === 'list' ? 'tasks' : 'items'}…`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>

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

      <div className="picker-list">
        {loading && <div className="picker-loading">Loading…</div>}
        {error && <div className="picker-error">{error}</div>}
        {!loading && !error && filtered.length === 0 && (
          <div className="picker-empty">
            {current.type === 'list' ? 'No open tasks here.' : 'Nothing in here.'}
          </div>
        )}
        {!loading && filtered.map(item => (
          <button key={`${item.kind}-${item.id}`} className="picker-item" onClick={() => drill(item)}>
            <span className={`picker-icon picker-icon-${item.kind}`}>
              {iconFor(item.kind)}
            </span>
            <span className="picker-item-name">{item.name}</span>
            {item.status && (
              <span className="picker-status" style={{ color: item.statusColor || 'var(--text-muted)' }}>
                {item.status}
              </span>
            )}
            {item.kind !== 'task' && (
              <svg className="picker-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 6l6 6-6 6" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  )
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
