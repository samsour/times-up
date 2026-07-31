import { useState, useEffect, useRef } from 'react'
import { getTimeEntries, createTimeEntry, updateTimeEntry, searchTasks } from '../lib/clickup.js'
import { formatDurationShort, formatTime, startOfDay, endOfDay } from '../lib/time.js'
import './Timetable.css'

const PX_PER_HOUR = 72
const LABEL_W = 44
const SNAP_MS = 15 * 60 * 1000
const HOUR_MS = 3600000
const DAY_MS = 24 * HOUR_MS
const MIN_DAY_W = 220 // each extra day column needs at least this much width
const COLS_X = LABEL_W + 6

function snap(ms) {
  return Math.round(ms / SNAP_MS) * SNAP_MS
}

export default function Timetable({ teamId, currentEntry, onChange }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [width, setWidth] = useState(0)
  const [dragRange, setDragRange] = useState(null)
  const [draft, setDraft] = useState(null)
  const [draftDesc, setDraftDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [draggingBlock, setDraggingBlock] = useState(null)
  const [editing, setEditing] = useState(null) // { entry, dayIdx }
  const [editStart, setEditStart] = useState(0)
  const [editEnd, setEditEnd] = useState(0)
  const [editTaskText, setEditTaskText] = useState('')
  const [editTaskPicked, setEditTaskPicked] = useState(null)
  const [editTaskResults, setEditTaskResults] = useState(null)
  const editSearchRef = useRef(null)
  const draggingRef = useRef(null)
  const scrollRef = useRef(null)
  const innerRef = useRef(null)
  const rangeStartOffRef = useRef(0)
  const geomRef = useRef(null)
  const loadedOnceRef = useRef(false)

  const dayCount = width
    ? Math.max(1, Math.min(7, Math.floor((width - LABEL_W) / MIN_DAY_W)))
    : 1

  // Visible days, oldest first, ending with today
  const days = []
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push({ start: startOfDay(d), end: endOfDay(d), date: new Date(startOfDay(d)) })
  }

  useEffect(() => {
    load(loadedOnceRef.current)
    loadedOnceRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, dayCount])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  // Track container width to decide how many day columns fit
  useEffect(() => {
    if (loading) return
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    setWidth(el.clientWidth)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  useEffect(() => {
    if (loading || !scrollRef.current) return
    const nowOff = Date.now() - startOfDay()
    const nowY = ((nowOff - rangeStartOffRef.current) / HOUR_MS) * PX_PER_HOUR
    const el = scrollRef.current
    el.scrollTop = nowY - el.clientHeight / 2
  }, [loading])

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const first = new Date()
      first.setDate(first.getDate() - (dayCount - 1))
      const data = await getTimeEntries(teamId, startOfDay(first), endOfDay())
      setEntries(data || [])
    } catch {}
    if (!silent) setLoading(false)
  }

  function getTimeFromEvent(e, lockDayIdx = null) {
    const g = geomRef.current
    if (!innerRef.current || !g) return null
    const rect = innerRef.current.getBoundingClientRect()
    const y = e.clientY - rect.top
    let idx = lockDayIdx ?? Math.floor((e.clientX - rect.left - COLS_X) / g.colW)
    idx = Math.max(0, Math.min(idx, g.days.length - 1))
    return snap(g.days[idx].start + g.minOff + (y / PX_PER_HOUR) * HOUR_MS)
  }

  function getDayIdxFromEvent(e) {
    const g = geomRef.current
    if (!innerRef.current || !g) return 0
    const rect = innerRef.current.getBoundingClientRect()
    const idx = Math.floor((e.clientX - rect.left - COLS_X) / g.colW)
    return Math.max(0, Math.min(idx, g.days.length - 1))
  }

  // ── entry editor popup ────────────────────────────────────────────────────
  function openEditor(entry) {
    const g = geomRef.current
    const start = parseInt(entry.start)
    const dayIdx = Math.max(g.days.findIndex(d => start >= d.start && start <= d.end), 0)
    const snappedStart = snap(start)
    let snappedEnd = snap(start + Math.max(parseInt(entry.duration || 0), 0))
    if (snappedEnd <= snappedStart) snappedEnd = snappedStart + SNAP_MS
    setDraft(null)
    setDraftDesc('')
    setEditing({ entry, dayIdx })
    setEditStart(snappedStart)
    setEditEnd(Math.min(snappedEnd, g.days[dayIdx].start + DAY_MS))
    setEditTaskText(entry.task?.name || '')
    setEditTaskPicked(null)
    setEditTaskResults(null)
  }

  // Debounced task search inside the editor
  useEffect(() => {
    clearTimeout(editSearchRef.current)
    const q = editTaskText.trim()
    if (!editing || editTaskPicked || q.length < 2 || q === (editing.entry.task?.name || '')) {
      setEditTaskResults(null)
      return
    }
    editSearchRef.current = setTimeout(async () => {
      try {
        setEditTaskResults(await searchTasks(teamId, q))
      } catch {
        setEditTaskResults([])
      }
    }, 300)
    return () => clearTimeout(editSearchRef.current)
  }, [editTaskText, editTaskPicked, editing, teamId])

  async function saveEdit() {
    setSaving(true)
    try {
      const body = { start: editStart, duration: editEnd - editStart }
      if (editTaskPicked) body.tid = editTaskPicked.id
      await updateTimeEntry(teamId, editing.entry.id, body)
      setEditing(null)
      await load(true)
      onChange?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── drag-to-create (locked to the column the drag started in) ────────────
  function handleInnerMouseDown(e) {
    if (e.button !== 0) return
    if (e.target.closest('.timetable-block') || e.target.closest('.timetable-draft-form')) return
    if (editing) { setEditing(null); return }
    if (draft) { setDraft(null); setDraftDesc(''); return }
    e.preventDefault()

    const dayIdx = getDayIdxFromEvent(e)
    const anchor = getTimeFromEvent(e, dayIdx)
    setDragRange({ anchor, current: anchor })

    function onMove(ev) {
      const current = getTimeFromEvent(ev, dayIdx)
      if (current !== null) setDragRange({ anchor, current })
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const current = getTimeFromEvent(ev, dayIdx) ?? anchor
      const start = Math.min(anchor, current)
      const end = Math.max(anchor, current)
      setDragRange(null)
      if (end - start >= SNAP_MS) { setDraft({ start, end }); setDraftDesc('') }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── drag existing block (move across days, or resize within its day) ─────
  function handleBlockMouseDown(e, entry, type) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    const g = geomRef.current
    const origStart = parseInt(entry.start)
    const origDuration = parseInt(entry.duration || 0)
    const entryDayIdx = g.days.findIndex(d => origStart >= d.start && origStart <= d.end)
    const lockIdx = type === 'resize' ? entryDayIdx : null
    const anchorMs = getTimeFromEvent(e, lockIdx)

    const initial = {
      id: entry.id,
      type,
      origStart,
      origDuration,
      currentStart: origStart,
      currentEnd: origStart + origDuration,
    }
    draggingRef.current = initial
    const downX = e.clientX
    const downY = e.clientY
    let dragStarted = false

    function onMove(ev) {
      if (!dragStarted && Math.abs(ev.clientX - downX) < 4 && Math.abs(ev.clientY - downY) < 4) return
      dragStarted = true
      const t = getTimeFromEvent(ev, lockIdx)
      if (t === null) return
      let next
      if (type === 'move') {
        const first = geomRef.current.days[0].start
        const last = geomRef.current.days[geomRef.current.days.length - 1]
        let newStart = snap(origStart + (t - anchorMs))
        newStart = Math.max(first, Math.min(newStart, last.start + DAY_MS - origDuration))
        next = { ...draggingRef.current, currentStart: newStart, currentEnd: newStart + origDuration }
      } else {
        const newEnd = Math.max(snap(t), origStart + SNAP_MS)
        next = { ...draggingRef.current, currentEnd: newEnd }
      }
      draggingRef.current = next
      setDraggingBlock(next)
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const d = draggingRef.current
      draggingRef.current = null
      setDraggingBlock(null)
      if (!d) return

      // A click without movement opens the editor instead
      if (!dragStarted) {
        openEditor(entry)
        return
      }

      const changed = d.type === 'move'
        ? d.currentStart !== d.origStart
        : d.currentEnd !== d.origStart + d.origDuration
      if (!changed) return

      const body = d.type === 'move'
        ? { start: d.currentStart, duration: d.origDuration }
        : { start: d.origStart, duration: d.currentEnd - d.origStart }

      updateTimeEntry(teamId, d.id, body)
        .then(() => load(true))
        .then(() => onChange?.())
        .catch(err => alert(err.message))
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── draft save/cancel ─────────────────────────────────────────────────────
  async function saveDraft() {
    setSaving(true)
    try {
      await createTimeEntry(teamId, {
        start: draft.start,
        duration: draft.end - draft.start,
        description: draftDesc.trim(),
      })
      setDraft(null)
      setDraftDesc('')
      await load(true)
      onChange?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  function cancelDraft() { setDraft(null); setDraftDesc('') }

  // ── render ────────────────────────────────────────────────────────────────
  const allBlocks = [...entries]
  if (currentEntry?.id) {
    const idx = allBlocks.findIndex(e => e.id === currentEntry.id)
    const live = { ...currentEntry, duration: String(now - parseInt(currentEntry.start)) }
    if (idx !== -1) allBlocks[idx] = live
    else allBlocks.push(live)
  }

  if (loading) return <div className="timetable-state">Loading…</div>

  const colsW = Math.max((width || 380) - COLS_X - 8, 50)
  const colW = colsW / dayCount
  const dayLeft = (i) => COLS_X + i * colW

  const dayIndexFor = (ms) => days.findIndex(d => ms >= d.start && ms <= d.end)

  // Shared vertical range across all days, as offsets from midnight
  let minOff = 7 * HOUR_MS
  let maxOff = 12 * HOUR_MS
  for (const e of allBlocks) {
    const bStart = parseInt(e.start)
    const bEnd = bStart + Math.max(parseInt(e.duration || 0), 0)
    const dIdx = dayIndexFor(bStart)
    if (dIdx === -1) continue
    minOff = Math.min(minOff, bStart - days[dIdx].start)
    maxOff = Math.max(maxOff, Math.min(bEnd - days[dIdx].start, DAY_MS))
  }
  minOff = Math.max(Math.floor(minOff / HOUR_MS) * HOUR_MS, 0)
  maxOff = Math.min(Math.ceil(maxOff / HOUR_MS) * HOUR_MS, DAY_MS)
  rangeStartOffRef.current = minOff
  geomRef.current = { days, colW, minOff }

  const hours = []
  for (let off = minOff; off <= maxOff; off += HOUR_MS) hours.push(off)

  const offToY = (off) => ((off - minOff) / HOUR_MS) * PX_PER_HOUR

  const todayIdx = days.length - 1
  const nowOff = now - days[todayIdx].start

  const dragPreview = dragRange
    ? { start: Math.min(dragRange.anchor, dragRange.current), end: Math.max(dragRange.anchor, dragRange.current) }
    : null

  const innerClass = [
    'timetable-inner',
    dragRange ? 'timetable-inner-dragging' : '',
    draggingBlock ? 'timetable-inner-block-dragging' : '',
  ].filter(Boolean).join(' ')

  const draftIdx = draft ? Math.max(dayIndexFor(draft.start), 0) : 0
  const draftW = draft ? Math.min(Math.max(colW - 6, 240), colsW) : 0
  const draftLeft = draft ? Math.min(dayLeft(draftIdx), COLS_X + colsW - draftW) : 0

  return (
    <div className="timetable">
      {dayCount > 1 && (
        <div className="timetable-days-header">
          <div className="timetable-days-spacer" style={{ width: COLS_X }} />
          {days.map((d, i) => (
            <div
              key={d.start}
              className={`timetable-day-label ${i === todayIdx ? 'timetable-day-today' : ''}`}
              style={{ width: colW }}
            >
              {i === todayIdx
                ? 'Today'
                : d.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
            </div>
          ))}
        </div>
      )}
      <div className="timetable-scroll" ref={scrollRef}>
        <div
          className={innerClass}
          ref={innerRef}
          style={{ height: hours.length * PX_PER_HOUR }}
          onMouseDown={handleInnerMouseDown}
        >
          {hours.map((off, i) => (
            <div key={off} className="timetable-hour" style={{ top: i * PX_PER_HOUR }}>
              <span className="timetable-hour-label">{formatHour(days[todayIdx].start + off)}</span>
              <div className="timetable-hour-line" />
            </div>
          ))}

          {days.slice(1).map((d, i) => (
            <div key={d.start} className="timetable-day-sep" style={{ left: dayLeft(i + 1) - 3 }} />
          ))}

          {nowOff >= minOff && nowOff <= maxOff && (
            <div
              className="timetable-now-line"
              style={{ top: offToY(nowOff), left: dayLeft(todayIdx), width: colW - 4 }}
            />
          )}

          {(() => {
            // Resolve display times, then assign overlapping entries to
            // side-by-side lanes within each day column
            const renderBlocks = allBlocks.map(entry => {
              const isRunning = currentEntry?.id === entry.id
              const isDragging = draggingBlock?.id === entry.id
              let blockStart, blockEnd
              if (isDragging) {
                blockStart = draggingBlock.type === 'move' ? draggingBlock.currentStart : draggingBlock.origStart
                blockEnd = draggingBlock.currentEnd
              } else {
                blockStart = parseInt(entry.start)
                blockEnd = isRunning
                  ? now
                  : blockStart + parseInt(entry.duration || 0)
              }
              const dIdx = dayIndexFor(blockStart)
              return { entry, isRunning, isDragging, blockStart, blockEnd, dIdx, lane: 0, laneCount: 1 }
            }).filter(b => b.dIdx !== -1)

            for (let dIdx = 0; dIdx < days.length; dIdx++) {
              const dayBlocks = renderBlocks
                .filter(b => b.dIdx === dIdx)
                .sort((a, b) => a.blockStart - b.blockStart || b.blockEnd - a.blockEnd)
              let cluster = []
              let lanes = [] // effective end time of the last block in each lane
              const finalize = () => {
                for (const b of cluster) b.laneCount = lanes.length
                cluster = []
                lanes = []
              }
              for (const b of dayBlocks) {
                // treat blocks as at least one slot tall so the 18px minimum height can't hide anything
                const effEnd = Math.max(b.blockEnd, b.blockStart + SNAP_MS)
                if (cluster.length && b.blockStart >= Math.max(...lanes)) finalize()
                let lane = lanes.findIndex(end => end <= b.blockStart)
                if (lane === -1) {
                  lane = lanes.length
                  lanes.push(effEnd)
                } else {
                  lanes[lane] = effEnd
                }
                b.lane = lane
                cluster.push(b)
              }
              finalize()
            }

            return renderBlocks.map(({ entry, isRunning, isDragging, blockStart, blockEnd, dIdx, lane, laneCount }) => {
              const duration = blockEnd - blockStart
              const startOff = blockStart - days[dIdx].start
              const endOff = Math.min(blockEnd - days[dIdx].start, DAY_MS)
              const top = offToY(startOff)
              const height = Math.max(offToY(endOff) - top, 18)
              const label = entry.task?.name || entry.description || 'Untitled'
              const subW = (colW - 6) / laneCount
              const left = dayLeft(dIdx) + lane * subW
              const blockW = subW - (lane < laneCount - 1 ? 2 : 0)

              return (
                <div
                  key={entry.id}
                  className={[
                    'timetable-block',
                    isRunning ? 'timetable-block-live' : '',
                    isDragging ? 'timetable-block-dragging' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ top, height, left, width: blockW }}
                  title={!isDragging ? `${label} · ${formatDurationShort(duration)}` : undefined}
                  onMouseDown={!isRunning ? e => handleBlockMouseDown(e, entry, 'move') : undefined}
                >
                  {height >= 18 && <span className="timetable-block-name">{label}</span>}
                  {height >= 34 && (
                    <span className="timetable-block-dur">
                      {isDragging
                        ? `${formatTime(blockStart)} – ${formatTime(blockEnd)}`
                        : formatDurationShort(duration)}
                    </span>
                  )}
                  {!isRunning && (
                    <div
                      className="timetable-block-resize-handle"
                      onMouseDown={e => { e.stopPropagation(); handleBlockMouseDown(e, entry, 'resize') }}
                    />
                  )}
                </div>
              )
            })
          })()}

          {dragPreview && (
            <div
              className="timetable-drag-preview"
              style={{
                top: offToY(dragPreview.start - days[Math.max(dayIndexFor(dragPreview.start), 0)].start),
                height: Math.max(((dragPreview.end - dragPreview.start) / HOUR_MS) * PX_PER_HOUR, 2),
                left: dayLeft(Math.max(dayIndexFor(dragPreview.start), 0)),
                width: colW - 6,
              }}
            >
              <span className="timetable-drag-label">
                {formatTime(dragPreview.start)} – {formatTime(dragPreview.end)}
              </span>
            </div>
          )}

          {draft && (
            <div
              className="timetable-draft-form"
              style={{ top: offToY(draft.start - days[draftIdx].start), left: draftLeft, width: draftW }}
            >
              <div className="draft-time">
                {formatTime(draft.start)} – {formatTime(draft.end)}
                <span className="draft-dur">{formatDurationShort(draft.end - draft.start)}</span>
              </div>
              <input
                className="draft-input"
                autoFocus
                placeholder="What did you work on?"
                value={draftDesc}
                onChange={e => setDraftDesc(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveDraft()
                  if (e.key === 'Escape') cancelDraft()
                }}
              />
              <div className="draft-actions">
                <button className="draft-cancel" onClick={cancelDraft}>Cancel</button>
                <button className="draft-save" onClick={saveDraft} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {editing && (() => {
            const day = days[Math.min(editing.dayIdx, days.length - 1)]
            const formW = Math.min(Math.max(colW - 6, 260), colsW)
            const left = Math.min(dayLeft(Math.min(editing.dayIdx, days.length - 1)), COLS_X + colsW - formW)
            const totalH = hours.length * PX_PER_HOUR
            const top = Math.max(Math.min(offToY(editStart - day.start), totalH - 200), 0)
            const startOpts = []
            for (let t = day.start; t < day.start + DAY_MS; t += SNAP_MS) startOpts.push(t)
            const endOpts = []
            for (let t = editStart + SNAP_MS; t <= day.start + DAY_MS; t += SNAP_MS) endOpts.push(t)
            return (
              <div
                className="timetable-draft-form timetable-edit-form"
                style={{ top, left, width: formW }}
                onKeyDown={e => { if (e.key === 'Escape') setEditing(null) }}
              >
                <div className="edit-times">
                  <select
                    className="draft-input edit-select"
                    value={editStart}
                    onChange={e => {
                      const newStart = Number(e.target.value)
                      const duration = editEnd - editStart
                      setEditStart(newStart)
                      setEditEnd(Math.min(newStart + duration, day.start + DAY_MS))
                    }}
                  >
                    {startOpts.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                  </select>
                  <span className="edit-times-sep">–</span>
                  <select
                    className="draft-input edit-select"
                    value={editEnd}
                    onChange={e => setEditEnd(Number(e.target.value))}
                  >
                    {endOpts.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                  </select>
                  <span className="draft-dur">{formatDurationShort(editEnd - editStart)}</span>
                </div>
                <input
                  className="draft-input"
                  placeholder="Assign a task…"
                  value={editTaskText}
                  onChange={e => {
                    setEditTaskText(e.target.value)
                    setEditTaskPicked(null)
                  }}
                />
                {editTaskResults && (
                  <div className="edit-task-results">
                    {editTaskResults.length === 0 && (
                      <div className="edit-task-empty">No tasks found.</div>
                    )}
                    {editTaskResults.slice(0, 6).map(t => (
                      <button
                        key={t.id}
                        className="edit-task-result"
                        onClick={() => {
                          setEditTaskPicked({ id: t.id, name: t.name })
                          setEditTaskText(t.name)
                          setEditTaskResults(null)
                        }}
                      >
                        <span className="edit-task-result-name">{t.name}</span>
                        {t.list?.name && <span className="edit-task-result-meta">{t.list.name}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <div className="draft-actions">
                  <button className="draft-cancel" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="draft-save" onClick={saveEdit} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )
          })()}

        </div>
      </div>
    </div>
  )
}

function formatHour(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', hour12: true })
}
