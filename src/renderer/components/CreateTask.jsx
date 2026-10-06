import { useState, useEffect, useRef } from 'react'
import { getAllLists, getTimeEntries } from '../lib/clickup.js'
import { endOfDay } from '../lib/time.js'
import './CreateTask.css'

// The one "new task" form, used by the timer bar, Focus, the task picker,
// the timetable popups and the Today cards: a name and a list. The list is
// preset to the one most recently tracked against (from the stored recents,
// or derived from the last two weeks of entries on first use) and can be
// swapped through a searchable dropdown. onCreate(listId, name) does the
// creating, so each caller decides what happens with the task.
export function CreateTaskForm({ teamId, initialName = '', busy, onCreate, onCancel }) {
  const [name, setName] = useState(initialName)
  const [picked, setPicked] = useState(null)
  const [recents, setRecents] = useState([])
  const [all, setAll] = useState(null) // null = not loaded yet
  const [loadingAll, setLoadingAll] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [listQuery, setListQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const nameRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [saved, last] = await Promise.all([
        window.api.store.get('recent_lists'),
        window.api.store.get('last_list'),
      ])
      const seen = new Set()
      const merged = [...(saved || []), ...(last ? [last] : [])]
        .filter(l => l?.id && !seen.has(String(l.id)) && seen.add(String(l.id)))
        .map(l => ({ id: String(l.id), name: l.name }))
      if (!merged.length) {
        // Nothing remembered yet: the lists behind recent entries
        try {
          const data = await getTimeEntries(teamId, Date.now() - 14 * 86400000, endOfDay())
          const sorted = (data || []).sort((a, b) => parseInt(b.start) - parseInt(a.start))
          for (const e of sorted) {
            const id = e.task_location?.list_id
            if (id && !seen.has(String(id))) {
              seen.add(String(id))
              merged.push({ id: String(id), name: e.task_location.list_name || 'List' })
              if (merged.length >= 4) break
            }
          }
        } catch {}
      }
      if (cancelled) return
      setRecents(merged.slice(0, 4))
      if (merged[0]) setPicked(merged[0])
    })()
    return () => { cancelled = true }
  }, [teamId])

  async function loadAll() {
    if (all !== null || loadingAll) return
    setLoadingAll(true)
    try {
      setAll((await getAllLists(teamId)).map(l => ({ ...l, id: String(l.id) })))
    } catch {
      setAll([])
    } finally {
      setLoadingAll(false)
    }
  }

  function openList() {
    setListOpen(true)
    setListQuery('')
    setHighlight(0)
    loadAll()
  }

  function pick(l) {
    setPicked({ id: l.id, name: l.name })
    setListOpen(false)
    setListQuery('')
    nameRef.current?.focus()
  }

  async function submit() {
    const n = name.trim()
    if (!n || !picked || busy) return
    const nextRecents = [picked, ...recents.filter(l => l.id !== picked.id)].slice(0, 4)
    window.api.store.set('recent_lists', nextRecents)
    await onCreate(picked.id, n)
  }

  const q = listQuery.trim().toLowerCase()
  const options = q
    ? (all || []).filter(l => l.name.toLowerCase().includes(q) || (l.path || '').toLowerCase().includes(q)).slice(0, 8)
    : [
        ...recents.map(r => ({ ...r, recent: true })),
        ...(all || []).filter(l => !recents.some(r => r.id === l.id)),
      ].slice(0, 8)

  function listKeys(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[highlight]) pick(options[highlight]) }
    else if (e.key === 'Escape') { e.stopPropagation(); setListOpen(false); nameRef.current?.focus() }
  }

  return (
    <div className="ct">
      <input
        ref={nameRef}
        className="ct-input"
        placeholder="Task name"
        value={name}
        autoFocus
        disabled={busy}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel?.()
        }}
      />

      <div className="ct-list">
        <span className="ct-list-label">in</span>
        {listOpen ? (
          <input
            className="ct-input ct-list-search"
            placeholder="Find a list…"
            value={listQuery}
            autoFocus
            onChange={e => { setListQuery(e.target.value); setHighlight(0) }}
            onBlur={() => setTimeout(() => setListOpen(false), 120)}
            onKeyDown={listKeys}
          />
        ) : (
          <button className={`ct-list-btn ${picked ? '' : 'ct-list-btn-empty'}`} onClick={openList} disabled={busy} title="Change list">
            <span className="ct-list-btn-name">{picked ? picked.name : 'Choose a list…'}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}
        {listOpen && (
          <div className="ct-options">
            {loadingAll && options.length === 0 && <div className="ct-options-note">Loading lists…</div>}
            {!loadingAll && options.length === 0 && <div className="ct-options-note">No list found.</div>}
            {options.map((l, i) => (
              <button
                key={l.id}
                className={`ct-option ${i === highlight ? 'ct-option-active' : ''}`}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(l)}
              >
                <span className="ct-option-name">{l.name}</span>
                <span className="ct-option-meta">{l.path || (l.recent ? 'recent' : '')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ct-actions">
        {onCancel && <button className="ct-cancel" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button className="ct-go" onClick={submit} disabled={busy || !name.trim() || !picked}>
          {busy ? 'Creating…' : 'Create task'}
        </button>
      </div>
    </div>
  )
}
