import { useState, useEffect, useRef } from 'react'
import { createTimeEntry, updateTimeEntry, deleteTimeEntry, searchTasks, startTimer, stopTimer, getCurrentTimer } from '../lib/clickup.js'
import { useTaskSuggestions } from '../lib/useTaskSuggestions.js'
import { formatDurationShort, formatTime, startOfDay } from '../lib/time.js'
import './Timetable.css'

const PX_PER_HOUR = 72
const LABEL_W = 44
const SNAP_MS = 15 * 60 * 1000
const HOUR_MS = 3600000
const DAY_MS = 24 * HOUR_MS
const COLS_X = LABEL_W + 6

function snap(ms, step = SNAP_MS) {
  return Math.round(ms / step) * step
}

// Zoom steps: pixels per hour and the grid the timetable snaps to. The
// large step earns a finer grid, short entries are placeable there.
const ZOOM_LEVELS = [
  { id: 'compact', px: 48, snap: 15 * 60 * 1000 },
  { id: 'normal', px: 72, snap: 15 * 60 * 1000 },
  { id: 'large', px: 108, snap: 5 * 60 * 1000 },
]
const DEFAULT_ZOOM = 1
const ZOOM_KEY = `timetable_zoom_${new URLSearchParams(window.location.search).get('win') === 'window' ? 'window' : 'popover'}`

export function blockKey(entry) {
  return entry.task?.id || `e:${entry.id}`
}

// Single-day timeline. The parent owns the entries and the selected day;
// every mutation here goes through the API and then calls onChange().
export default function Timetable({
  teamId,
  day,
  entries,
  loading,
  currentEntry,
  onChange,
  onTaskTracked,
  hoverKey,
  onHoverBlock,
  dragCard,
  listColors,
}) {
  const [now, setNow] = useState(Date.now())
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const { px: pxPerHour, snap: snapMs } = ZOOM_LEVELS[zoom]
  const snapT = ms => snap(ms, snapMs)

  useEffect(() => {
    window.api.store.get(ZOOM_KEY).then(v => {
      const i = ZOOM_LEVELS.findIndex(z => z.id === v)
      if (i !== -1) setZoom(i)
    })
  }, [])

  // Zoom keeps the same moment under the middle of the viewport
  function changeZoom(delta) {
    setZoom(z => {
      const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, z + delta))
      if (next === z) return z
      const el = scrollRef.current
      if (el) {
        const ratio = ZOOM_LEVELS[next].px / ZOOM_LEVELS[z].px
        const mid = el.scrollTop + el.clientHeight / 2
        requestAnimationFrame(() => { el.scrollTop = mid * ratio - el.clientHeight / 2 })
      }
      window.api.store.set(ZOOM_KEY, ZOOM_LEVELS[next].id)
      return next
    })
  }

  // Cmd/Ctrl + plus/minus/0 while the timetable is on screen
  useEffect(() => {
    function onKey(e) {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); changeZoom(1) }
      else if (e.key === '-') { e.preventDefault(); changeZoom(-1) }
      else if (e.key === '0') { e.preventDefault(); changeZoom(DEFAULT_ZOOM - zoom) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // Trackpad pinch arrives as a wheel event with ctrlKey set
  const pinchAcc = useRef(0)
  function handleWheel(e) {
    if (!e.ctrlKey) return
    e.preventDefault()
    pinchAcc.current += e.deltaY
    if (pinchAcc.current <= -40) { pinchAcc.current = 0; changeZoom(1) }
    else if (pinchAcc.current >= 40) { pinchAcc.current = 0; changeZoom(-1) }
  }
  const [width, setWidth] = useState(0)
  const [dragRange, setDragRange] = useState(null)
  const [draft, setDraft] = useState(null)
  const [draftDesc, setDraftDesc] = useState('')
  const [draftTask, setDraftTask] = useState(null) // picked { id, name }
  const [draftTaskQuery, setDraftTaskQuery] = useState('')
  const [draftTaskFocus, setDraftTaskFocus] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draggingBlock, setDraggingBlock] = useState(null)
  const [editing, setEditing] = useState(null) // { entry }
  // Hovering a card on the left highlights all of its blocks; hovering a
  // block highlights only that block (the card still lights up)
  const [hoveredBlockId, setHoveredBlockId] = useState(null)
  const [editStart, setEditStart] = useState(0)
  const [editEnd, setEditEnd] = useState(0)
  const [editTaskText, setEditTaskText] = useState('')
  const [editTaskPicked, setEditTaskPicked] = useState(null)
  const [editTaskResults, setEditTaskResults] = useState(null)
  const [dropTime, setDropTime] = useState(null)
  const editSearchRef = useRef(null)
  const draggingRef = useRef(null)
  const scrollRef = useRef(null)
  const innerRef = useRef(null)
  const rangeStartOffRef = useRef(0)
  const geomRef = useRef(null)

  const dayEnd = day + DAY_MS - 1
  const isToday = day === startOfDay(new Date(now))

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  // Track container width
  useEffect(() => {
    if (loading) return
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    setWidth(el.clientWidth)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  // Center the view: on "now" for today, on the first entry otherwise
  useEffect(() => {
    if (loading || !scrollRef.current) return
    const anchor = isToday ? Date.now() - day : 9.5 * HOUR_MS
    const y = ((anchor - rangeStartOffRef.current) / HOUR_MS) * pxPerHour
    const el = scrollRef.current
    el.scrollTop = y - el.clientHeight / 2
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, day])

  const { tasks: draftSuggestions } = useTaskSuggestions(teamId, undefined, draftTaskQuery, { limit: 5 })

  function resetDraft() {
    setDraft(null)
    setDraftDesc('')
    setDraftTask(null)
    setDraftTaskQuery('')
  }

  // Escape closes the open popup even when focus is elsewhere
  useEffect(() => {
    if (!editing && !draft) return
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (editing) setEditing(null)
      else resetDraft()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft])

  // Close popups when switching days
  useEffect(() => {
    setEditing(null)
    resetDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  function getTimeFromEvent(e) {
    const g = geomRef.current
    if (!innerRef.current || !g) return null
    const rect = innerRef.current.getBoundingClientRect()
    const y = e.clientY - rect.top
    return snapT(day + g.minOff + (y / pxPerHour) * HOUR_MS)
  }

  // ── entry editor popup ────────────────────────────────────────────────────
  function openEditor(entry) {
    const running = currentEntry?.id === entry.id
    const start = parseInt(entry.start)
    const snappedStart = snapT(start)
    // A running entry has no end yet; the editor shows "now" and only the
    // start (and task) can change
    let snappedEnd = running
      ? snapT(Date.now() + snapMs - 1)
      : snapT(start + Math.max(parseInt(entry.duration || 0), 0))
    if (snappedEnd <= snappedStart) snappedEnd = snappedStart + snapMs
    resetDraft()
    setEditing({ entry, running })
    setEditStart(snappedStart)
    setEditEnd(Math.min(snappedEnd, day + DAY_MS))
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
      const body = editing.running
        ? { start: editStart }
        : { start: editStart, duration: editEnd - editStart }
      if (editTaskPicked) body.tid = editTaskPicked.id
      await updateTimeEntry(teamId, editing.entry.id, body)
      setEditing(null)
      await onChange?.()
      if (editTaskPicked) onTaskTracked?.(editTaskPicked.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Start a fresh timer on the same task (or description) as this entry
  async function resumeEntry(entry) {
    setSaving(true)
    try {
      const running = await getCurrentTimer(teamId)
      if (running?.id) await stopTimer(teamId)
      await startTimer(teamId, entry.task?.id || null, entry.task?.id ? '' : (entry.description || ''))
      setEditing(null)
      await onChange?.()
      if (entry.task?.id) onTaskTracked?.(entry.task.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteEdit() {
    if (!confirm('Delete this entry?')) return
    setSaving(true)
    try {
      await deleteTimeEntry(teamId, editing.entry.id)
      setEditing(null)
      await onChange?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── drag-to-create ────────────────────────────────────────────────────────
  function handleInnerMouseDown(e) {
    if (e.button !== 0) return
    if (e.target.closest('.timetable-block') || e.target.closest('.timetable-draft-form')) return
    if (editing) { setEditing(null); return }
    if (draft) { resetDraft(); return }
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
      if (end - start >= snapMs) {
        setDraft({ start, end })
        setDraftDesc('')
        setDraftTask(null)
        setDraftTaskQuery('')
      }
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
    const downX = e.clientX
    const downY = e.clientY
    let dragStarted = false

    function onMove(ev) {
      if (!dragStarted && Math.abs(ev.clientX - downX) < 4 && Math.abs(ev.clientY - downY) < 4) return
      dragStarted = true
      const t = getTimeFromEvent(ev)
      if (t === null) return
      let next
      if (type === 'move') {
        let newStart = snapT(origStart + (t - anchorMs))
        newStart = Math.max(day, Math.min(newStart, day + DAY_MS - origDuration))
        next = { ...draggingRef.current, currentStart: newStart, currentEnd: newStart + origDuration }
      } else {
        const newEnd = Math.max(snapT(t), origStart + snapMs)
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
        taskId: draftTask?.id,
        start: draft.start,
        duration: draft.end - draft.start,
        description: draftDesc.trim(),
      })
      resetDraft()
      await onChange?.()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  function cancelDraft() { resetDraft() }

  // ── drop a card from the rail: creates a 1h entry at the drop position ───
  const DROP_DUR = HOUR_MS

  function handleDragOver(e) {
    if (!dragCard) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const t = getTimeFromEvent(e)
    if (t !== null) setDropTime(Math.min(t, day + DAY_MS - DROP_DUR))
  }

  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropTime(null)
  }

  async function handleDrop(e) {
    if (!dragCard) return
    e.preventDefault()
    const t = getTimeFromEvent(e)
    setDropTime(null)
    if (t === null) return
    const start = Math.min(t, day + DAY_MS - DROP_DUR)
    try {
      await createTimeEntry(teamId, {
        taskId: dragCard.task?.id,
        description: dragCard.task ? '' : dragCard.description,
        start,
        duration: DROP_DUR,
      })
      await onChange?.()
      if (dragCard.task?.id) onTaskTracked?.(dragCard.task.id)
    } catch (err) {
      alert(err.message)
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  // Entries of this day, plus overnight entries from the previous day that
  // spill past midnight (rendered clamped, marked __cont)
  const allBlocks = []
  for (const e of entries || []) {
    const s = parseInt(e.start)
    if (s >= day && s <= dayEnd) {
      allBlocks.push(e)
    } else if (s < day && s + Math.max(parseInt(e.duration || 0), 0) > day) {
      allBlocks.push({ ...e, __cont: true })
    }
  }
  if (currentEntry?.id) {
    const s = parseInt(currentEntry.start)
    if (s <= dayEnd && now > day) {
      const idx = allBlocks.findIndex(e => e.id === currentEntry.id)
      const live = { ...currentEntry, duration: String(now - s), __cont: s < day || undefined }
      if (idx !== -1) allBlocks[idx] = live
      else allBlocks.push(live)
    }
  }

  if (loading) return <div className="timetable-state">Loading…</div>

  const colW = Math.max((width || 380) - COLS_X - 8, 50)

  // Vertical range, as offsets from midnight
  let minOff = 7 * HOUR_MS
  let maxOff = 12 * HOUR_MS
  for (const e of allBlocks) {
    const bStart = Math.max(parseInt(e.start), day)
    const bEnd = parseInt(e.start) + Math.max(parseInt(e.duration || 0), 0)
    minOff = Math.min(minOff, bStart - day)
    maxOff = Math.max(maxOff, Math.min(Math.max(bEnd, day) - day, DAY_MS))
  }
  if (isToday) {
    minOff = Math.min(minOff, now - day)
    maxOff = Math.max(maxOff, now - day)
  }
  minOff = Math.max(Math.floor(minOff / HOUR_MS) * HOUR_MS, 0)
  maxOff = Math.min(Math.ceil(maxOff / HOUR_MS) * HOUR_MS, DAY_MS)
  rangeStartOffRef.current = minOff
  geomRef.current = { minOff }

  const hours = []
  for (let off = minOff; off <= maxOff; off += HOUR_MS) hours.push(off)

  const offToY = (off) => ((off - minOff) / HOUR_MS) * pxPerHour

  const nowOff = now - day

  const dragPreview = dragRange
    ? { start: Math.min(dragRange.anchor, dragRange.current), end: Math.max(dragRange.anchor, dragRange.current) }
    : null

  const innerClass = [
    'timetable-inner',
    dragRange ? 'timetable-inner-dragging' : '',
    draggingBlock ? 'timetable-inner-block-dragging' : '',
  ].filter(Boolean).join(' ')

  const draftW = draft ? Math.min(Math.max(colW - 6, 240), colW) : 0

  return (
    <div className="timetable">
      <div className="timetable-scroll" ref={scrollRef} onWheel={handleWheel}>
        <div
          className={innerClass}
          ref={innerRef}
          style={{ height: hours.length * pxPerHour }}
          onMouseDown={handleInnerMouseDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {hours.map((off, i) => (
            <div key={off} className="timetable-hour" style={{ top: i * pxPerHour }}>
              <span className="timetable-hour-label">{formatHour(day + off)}</span>
              <div className="timetable-hour-line" />
            </div>
          ))}

          {isToday && nowOff >= minOff && nowOff <= maxOff && (
            <div
              className="timetable-now-line"
              style={{ top: offToY(nowOff), left: COLS_X, width: colW - 4 }}
            />
          )}

          {(() => {
            // Resolve display times, then assign overlapping entries to lanes
            const renderBlocks = allBlocks.map(entry => {
              const isRunning = currentEntry?.id === entry.id
              const isDragging = draggingBlock?.id === entry.id
              const cont = !!entry.__cont
              const realStart = parseInt(entry.start)
              let blockStart, blockEnd
              if (isDragging) {
                blockStart = draggingBlock.type === 'move' ? draggingBlock.currentStart : draggingBlock.origStart
                blockEnd = draggingBlock.currentEnd
              } else {
                blockStart = cont ? day : realStart
                blockEnd = isRunning
                  ? now
                  : realStart + parseInt(entry.duration || 0)
              }
              return { entry, isRunning, isDragging, cont, realStart, blockStart, blockEnd, lane: 0, laneCount: 1 }
            })

            const sorted = [...renderBlocks].sort((a, b) => a.blockStart - b.blockStart || b.blockEnd - a.blockEnd)
            let cluster = []
            let lanes = [] // effective end time of the last block in each lane
            const finalize = () => {
              for (const b of cluster) b.laneCount = lanes.length
              cluster = []
              lanes = []
            }
            for (const b of sorted) {
              // treat blocks as at least one slot tall so the 18px minimum height can't hide anything
              const effEnd = Math.max(b.blockEnd, b.blockStart + snapMs)
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

            return renderBlocks.map(({ entry, isRunning, isDragging, cont, realStart, blockStart, blockEnd, lane, laneCount }) => {
              const duration = blockEnd - blockStart
              const totalDuration = blockEnd - realStart
              const startOff = blockStart - day
              const endOff = Math.min(blockEnd - day, DAY_MS)
              const top = offToY(startOff)
              const height = Math.max(offToY(endOff) - top, 18)
              const label = entry.task?.name || entry.description || 'Untitled'
              const subW = (colW - 6) / laneCount
              const left = COLS_X + lane * subW
              const blockW = subW - (lane < laneCount - 1 ? 2 : 0)
              const isHl = hoverKey && blockKey(entry) === hoverKey &&
                (hoveredBlockId === null || hoveredBlockId === entry.id)
              const listColor = !isRunning
                ? listColors?.[entry.task_location?.list_id || entry.task?.list?.id]
                : null

              return (
                <div
                  key={entry.id}
                  className={[
                    'timetable-block',
                    isRunning ? 'timetable-block-live' : '',
                    isDragging ? 'timetable-block-dragging' : '',
                    isHl ? 'timetable-block-hl' : '',
                    cont ? 'timetable-block-cont' : '',
                  ].filter(Boolean).join(' ')}
                  style={{
                    top, height, left, width: blockW,
                    ...(listColor ? {
                      borderLeftColor: listColor,
                      background: `color-mix(in srgb, ${listColor} 16%, transparent)`,
                    } : {}),
                  }}
                  title={!isDragging
                    ? cont
                      ? `${label} · started yesterday ${formatTime(realStart)} · ${formatDurationShort(totalDuration)} total (counts for yesterday)`
                      : `${label} · ${formatDurationShort(duration)}`
                    : undefined}
                  onMouseDown={!isRunning && !cont ? e => handleBlockMouseDown(e, entry, 'move') : e => e.stopPropagation()}
                  onClick={isRunning ? () => openEditor(entry) : undefined}
                  onMouseEnter={() => { setHoveredBlockId(entry.id); onHoverBlock?.(blockKey(entry)) }}
                  onMouseLeave={() => { setHoveredBlockId(null); onHoverBlock?.(null) }}
                >
                  {height >= 18 && (
                    <span className="timetable-block-name">
                      {cont && <span className="timetable-block-cont-hint">↰ </span>}
                      {label}
                    </span>
                  )}
                  {height >= 34 && (
                    <span className="timetable-block-dur">
                      {isDragging
                        ? `${formatTime(blockStart)} – ${formatTime(blockEnd)}`
                        : cont
                          ? `from yesterday ${formatTime(realStart)}`
                          : formatDurationShort(duration)}
                    </span>
                  )}
                  {/* Only blocks with room for it get the corner button; short
                      ones still offer Resume in their edit popover */}
                  {!isRunning && height >= 44 && (
                    <button
                      className="timetable-block-resume"
                      title="Resume this task"
                      disabled={saving}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); resumeEntry(entry) }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    </button>
                  )}
                  {!isRunning && !cont && (
                    <div
                      className="timetable-block-resize-handle"
                      onMouseDown={e => { e.stopPropagation(); handleBlockMouseDown(e, entry, 'resize') }}
                    />
                  )}
                </div>
              )
            })
          })()}

          {dragCard && dropTime !== null && (
            <div
              className="timetable-drag-preview timetable-drop-preview"
              style={{
                top: offToY(dropTime - day),
                height: (DROP_DUR / HOUR_MS) * pxPerHour,
                left: COLS_X,
                width: colW - 6,
                ...(listColors?.[dragCard.listId] ? { borderLeftColor: listColors[dragCard.listId] } : {}),
              }}
            >
              <span className="timetable-drag-label">
                {dragCard.task?.name || dragCard.description || 'Untitled'}
                {' · '}
                {formatTime(dropTime)} – {formatTime(dropTime + DROP_DUR)}
              </span>
            </div>
          )}

          {dragPreview && (
            <div
              className="timetable-drag-preview"
              style={{
                top: offToY(dragPreview.start - day),
                height: Math.max(((dragPreview.end - dragPreview.start) / HOUR_MS) * pxPerHour, 2),
                left: COLS_X,
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
              style={{ top: offToY(draft.start - day), left: COLS_X, width: draftW }}
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
              {draftTask ? (
                <button className="draft-task-chip" title="Remove task" onClick={() => setDraftTask(null)}>
                  <span className="draft-task-chip-name">{draftTask.name}</span>
                  <span className="draft-task-chip-x">×</span>
                </button>
              ) : (
                <input
                  className="draft-input"
                  placeholder="Link a task (optional)…"
                  value={draftTaskQuery}
                  onChange={e => setDraftTaskQuery(e.target.value)}
                  onFocus={() => setDraftTaskFocus(true)}
                  onBlur={() => setDraftTaskFocus(false)}
                  onKeyDown={e => { if (e.key === 'Escape') cancelDraft() }}
                />
              )}
              {!draftTask && draftTaskFocus && draftSuggestions.length > 0 && (
                <div className="edit-task-results">
                  {draftSuggestions.map(t => (
                    <button
                      key={t.id}
                      className="edit-task-result"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setDraftTask({ id: t.id, name: t.name }); setDraftTaskQuery('') }}
                    >
                      <span className="edit-task-result-name">{t.name}</span>
                      {t.list && <span className="edit-task-result-meta">{t.list}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="draft-actions">
                <button className="draft-cancel" onClick={cancelDraft}>Cancel</button>
                <button className="draft-save" onClick={saveDraft} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {editing && (() => {
            const formW = Math.min(Math.max(colW - 6, 260), colW)
            const totalH = hours.length * pxPerHour
            const top = Math.max(Math.min(offToY(editStart - day), totalH - 200), 0)
            // Running: start can be anything up to now (inclusive, so a
            // just-started timer's snapped start is still in the list)
            const startMax = editing.running
              ? Math.min(Math.max(snapT(Date.now()), editStart), day + DAY_MS - snapMs)
              : day + DAY_MS - snapMs
            const startOpts = []
            for (let t = day; t <= startMax; t += snapMs) startOpts.push(t)
            if (!startOpts.includes(editStart)) startOpts.push(editStart), startOpts.sort((a, b) => a - b)
            const endOpts = []
            for (let t = editStart + snapMs; t <= day + DAY_MS; t += snapMs) endOpts.push(t)
            return (
              <div
                className="timetable-draft-form timetable-edit-form"
                style={{ top, left: COLS_X, width: formW }}
                onKeyDown={e => { if (e.key === 'Escape') setEditing(null) }}
              >
                <button className="popup-close" onClick={() => setEditing(null)} title="Close (Esc)">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
                <div className="edit-times">
                  <select
                    className="draft-input edit-select"
                    value={editStart}
                    onChange={e => {
                      const newStart = Number(e.target.value)
                      const duration = editEnd - editStart
                      setEditStart(newStart)
                      if (!editing.running) setEditEnd(Math.min(newStart + duration, day + DAY_MS))
                    }}
                  >
                    {startOpts.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                  </select>
                  <span className="edit-times-sep">–</span>
                  {editing.running ? (
                    <span className="draft-input edit-select edit-now" title="Still running">now</span>
                  ) : (
                    <select
                      className="draft-input edit-select"
                      value={editEnd}
                      onChange={e => setEditEnd(Number(e.target.value))}
                    >
                      {endOpts.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                    </select>
                  )}
                  <span className="draft-dur">
                    {formatDurationShort((editing.running ? now : editEnd) - editStart)}
                  </span>
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
                  <div className="edit-actions-left">
                    <button className="edit-icon-btn edit-icon-btn-danger" onClick={deleteEdit} disabled={saving} title="Delete entry">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                    {editing.entry.id !== currentEntry?.id && (
                      <button className="edit-icon-btn" onClick={() => resumeEntry(editing.entry)} disabled={saving} title="Resume this task">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      </button>
                    )}
                  </div>
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

// Hand-rolled: some locales render noon as "0 pm" with hour12 formatting
function formatHour(ms) {
  const h = new Date(ms).getHours()
  return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`
}
