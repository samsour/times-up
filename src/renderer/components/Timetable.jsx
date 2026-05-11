import { useState, useEffect, useRef } from 'react'
import { getTimeEntries, createTimeEntry, updateTimeEntry } from '../lib/clickup.js'
import { formatDurationShort, formatTime, startOfDay, endOfDay } from '../lib/time.js'
import './Timetable.css'

const PX_PER_HOUR = 72
const LABEL_W = 44
const SNAP_MS = 15 * 60 * 1000

function snap(ms) {
  return Math.round(ms / SNAP_MS) * SNAP_MS
}

export default function Timetable({ teamId, currentEntry, onChange }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [dragRange, setDragRange] = useState(null)
  const [draft, setDraft] = useState(null)
  const [draftDesc, setDraftDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [draggingBlock, setDraggingBlock] = useState(null)
  const draggingRef = useRef(null)
  const scrollRef = useRef(null)
  const innerRef = useRef(null)
  const rangeStartRef = useRef(0)

  useEffect(() => { load() }, [teamId])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (loading || !scrollRef.current) return
    const nowY = ((Date.now() - rangeStartRef.current) / 3600000) * PX_PER_HOUR
    const el = scrollRef.current
    el.scrollTop = nowY - el.clientHeight / 2
  }, [loading])

  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      const data = await getTimeEntries(teamId, startOfDay(), endOfDay())
      setEntries(data || [])
    } catch {}
    if (!silent) setLoading(false)
  }

  function getTimeFromEvent(e) {
    if (!innerRef.current) return null
    const rect = innerRef.current.getBoundingClientRect()
    const y = e.clientY - rect.top
    return snap(rangeStartRef.current + (y / PX_PER_HOUR) * 3600000)
  }

  // ── drag-to-create ────────────────────────────────────────────────────────
  function handleInnerMouseDown(e) {
    if (e.button !== 0) return
    if (e.target.closest('.timetable-block') || e.target.closest('.timetable-draft-form')) return
    if (draft) { setDraft(null); setDraftDesc(''); return }
    e.preventDefault()

    const anchor = getTimeFromEvent(e)
    setDragRange({ anchor, current: anchor })

    function onMove(ev) {
      const current = getTimeFromEvent(ev)
      if (current !== null) setDragRange({ anchor, current })
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const current = getTimeFromEvent(ev) ?? anchor
      const start = Math.min(anchor, current)
      const end = Math.max(anchor, current)
      setDragRange(null)
      if (end - start >= SNAP_MS) { setDraft({ start, end }); setDraftDesc('') }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── drag existing block (move or resize) ─────────────────────────────────
  function handleBlockMouseDown(e, entry, type) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    const origStart = parseInt(entry.start)
    const origDuration = parseInt(entry.duration || 0)
    const anchorMs = getTimeFromEvent(e)

    const initial = {
      id: entry.id,
      type,
      origStart,
      origDuration,
      currentStart: origStart,
      currentEnd: origStart + origDuration,
    }
    draggingRef.current = initial
    setDraggingBlock(initial)

    function onMove(ev) {
      const t = getTimeFromEvent(ev)
      if (t === null) return
      let next
      if (type === 'move') {
        const newStart = snap(origStart + (t - anchorMs))
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

  const today = new Date()
  const fixedStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7, 0, 0, 0).getTime()
  const fixedEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0).getTime()

  const starts = allBlocks.map(e => parseInt(e.start))
  const ends = allBlocks.map(e => parseInt(e.start) + Math.max(parseInt(e.duration || 0), 0))

  let rangeStart = Math.min(fixedStart, ...starts)
  let rangeEnd = Math.max(fixedEnd, ...ends)
  rangeStart = Math.floor(rangeStart / 3600000) * 3600000
  rangeEnd = Math.ceil(rangeEnd / 3600000) * 3600000
  rangeStartRef.current = rangeStart

  const hours = []
  for (let t = rangeStart; t <= rangeEnd; t += 3600000) hours.push(t)

  function msToY(ms) {
    return ((ms - rangeStart) / 3600000) * PX_PER_HOUR
  }

  const dragPreview = dragRange
    ? { start: Math.min(dragRange.anchor, dragRange.current), end: Math.max(dragRange.anchor, dragRange.current) }
    : null

  const innerClass = [
    'timetable-inner',
    dragRange ? 'timetable-inner-dragging' : '',
    draggingBlock ? 'timetable-inner-block-dragging' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="timetable">
      <div className="timetable-scroll" ref={scrollRef}>
        <div
          className={innerClass}
          ref={innerRef}
          style={{ height: hours.length * PX_PER_HOUR }}
          onMouseDown={handleInnerMouseDown}
        >
          {hours.map((h, i) => (
            <div key={h} className="timetable-hour" style={{ top: i * PX_PER_HOUR }}>
              <span className="timetable-hour-label">{formatHour(h)}</span>
              <div className="timetable-hour-line" />
            </div>
          ))}

          {now >= rangeStart && now <= rangeEnd && (
            <div className="timetable-now-line" style={{ top: msToY(now) }} />
          )}

          {allBlocks.map(entry => {
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

            const duration = blockEnd - blockStart
            const top = msToY(blockStart)
            const height = Math.max(msToY(blockEnd) - top, 18)
            const label = entry.task?.name || entry.description || 'Untitled'

            return (
              <div
                key={entry.id}
                className={[
                  'timetable-block',
                  isRunning ? 'timetable-block-live' : '',
                  isDragging ? 'timetable-block-dragging' : '',
                ].filter(Boolean).join(' ')}
                style={{ top, height, left: LABEL_W + 6, right: 8 }}
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
          })}

          {dragPreview && (
            <div
              className="timetable-drag-preview"
              style={{
                top: msToY(dragPreview.start),
                height: Math.max(msToY(dragPreview.end) - msToY(dragPreview.start), 2),
                left: LABEL_W + 6,
                right: 8,
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
              style={{ top: msToY(draft.start), left: LABEL_W + 6, right: 8 }}
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

        </div>
      </div>
    </div>
  )
}

function formatHour(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', hour12: true })
}
