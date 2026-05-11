import { useState, useEffect } from 'react'
import { getTimeEntries, deleteTimeEntry, updateTimeEntry } from '../lib/clickup.js'
import { formatDurationShort, formatTime, formatDate, startOfDay, endOfDay, parseDurationInput } from '../lib/time.js'
import './History.css'

export default function History({ teamId, onChange }) {
  const [range, setRange] = useState('today') // 'today' | 'week'
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editDuration, setEditDuration] = useState('')

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const now = Date.now()
      let start
      if (range === 'today') start = startOfDay()
      else {
        const d = new Date()
        d.setDate(d.getDate() - 6)
        start = startOfDay(d)
      }
      const data = await getTimeEntries(teamId, start, endOfDay())
      setEntries(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(entry) {
    if (!confirm('Delete this entry?')) return
    try {
      await deleteTimeEntry(teamId, entry.id)
      load()
      onChange?.()
    } catch (e) {
      alert(e.message)
    }
  }

  async function saveEdit(entry) {
    const newDuration = parseDurationInput(editDuration)
    if (!newDuration) {
      setEditingId(null)
      return
    }
    try {
      await updateTimeEntry(teamId, entry.id, { duration: newDuration })
      setEditingId(null)
      load()
      onChange?.()
    } catch (e) {
      alert(e.message)
    }
  }

  // Group by day
  const grouped = {}
  for (const e of entries) {
    const dayKey = startOfDay(new Date(parseInt(e.start)))
    if (!grouped[dayKey]) grouped[dayKey] = []
    grouped[dayKey].push(e)
  }
  const dayKeys = Object.keys(grouped).sort((a, b) => b - a)

  const totalMs = entries.reduce((sum, e) => sum + parseInt(e.duration || 0), 0)

  return (
    <div className="history">
      <div className="history-header">
        <div className="history-tabs">
          <button
            className={`mini-tab ${range === 'today' ? 'mini-tab-active' : ''}`}
            onClick={() => setRange('today')}
          >Today</button>
          <button
            className={`mini-tab ${range === 'week' ? 'mini-tab-active' : ''}`}
            onClick={() => setRange('week')}
          >7 Days</button>
        </div>
        <div className="history-total">
          <span className="total-label">total</span>
          <span className="total-value">{formatDurationShort(totalMs)}</span>
        </div>
      </div>

      <div className="history-list">
        {loading && <div className="history-empty">Loading…</div>}
        {error && <div className="history-error">{error}</div>}
        {!loading && entries.length === 0 && (
          <div className="history-empty">
            <span className="history-empty-em">No entries.</span><br />
            Time tracked here will appear in the log.
          </div>
        )}

        {dayKeys.map(dayKey => {
          const dayEntries = grouped[dayKey]
          const dayTotal = dayEntries.reduce((s, e) => s + parseInt(e.duration || 0), 0)
          return (
            <div key={dayKey} className="day-group">
              <div className="day-header">
                <span className="day-name">{formatDayHeading(parseInt(dayKey))}</span>
                <span className="day-total">{formatDurationShort(dayTotal)}</span>
              </div>
              {dayEntries.map(entry => (
                <div key={entry.id} className="entry">
                  <div className="entry-main">
                    <div className="entry-task">{entry.task?.name || 'Untitled task'}</div>
                    {entry.description && (
                      <div className="entry-desc">{entry.description}</div>
                    )}
                    <div className="entry-meta">
                      {formatTime(entry.start)} · {entry.task?.status?.status || ''}
                    </div>
                  </div>
                  <div className="entry-side">
                    {editingId === entry.id ? (
                      <input
                        className="entry-edit"
                        autoFocus
                        value={editDuration}
                        onChange={e => setEditDuration(e.target.value)}
                        onBlur={() => saveEdit(entry)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveEdit(entry)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        placeholder="1h 30m"
                      />
                    ) : (
                      <button
                        className="entry-duration"
                        onClick={() => {
                          setEditingId(entry.id)
                          setEditDuration(formatDurationShort(parseInt(entry.duration)))
                        }}
                      >
                        {formatDurationShort(parseInt(entry.duration))}
                      </button>
                    )}
                    <button className="entry-delete" onClick={() => handleDelete(entry)} title="Delete">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatDayHeading(ms) {
  const today = startOfDay()
  const yesterday = startOfDay(new Date(Date.now() - 86400000))
  if (ms === today) return 'Today'
  if (ms === yesterday) return 'Yesterday'
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
