import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createTimeEntry, updateTimeEntry, deleteTimeEntry, searchTasks, startTimer, stopTimer, getCurrentTimer, createTask } from '../lib/clickup.js'
import { useTaskSuggestions } from '../lib/useTaskSuggestions.js'
import { CreateTaskForm } from './CreateTask.jsx'
import { usePopup } from '../lib/popups.js'
import { formatDurationShort, formatTime, startOfDay } from '../lib/time.js'
import './Timetable.css'

const LABEL_W = 44
const SNAP_MS = 15 * 60 * 1000
const MINUTE_MS = 60 * 1000
const MIN_DRAG_MS = 5 * MINUTE_MS // shortest drag that creates a draft
const SNAP_KEY = 'snap_to_grid'
const HOUR_MS = 3600000
const DAY_MS = 24 * HOUR_MS
const COLS_X = LABEL_W + 6
const DAY_GAP = 4 // horizontal gap between day columns in multi-day mode
// Shortest a block is drawn: one line of text plus the block's padding and
// borders. Short entries overrun their true length rather than go unreadable
const MIN_BLOCK_PX = 24

function snap(ms, step = SNAP_MS) {
  return Math.round(ms / step) * step
}

// "HH:MM" <-> ms within a day, for the minute-precise time inputs
function toHM(t) {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function fromHM(dayStart, hm) {
  const [h, m] = (hm || '').split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  const d = new Date(dayStart)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

// Calendar-day arithmetic that survives DST changes
function addDays(dayStart, n) {
  const d = new Date(dayStart)
  d.setDate(d.getDate() + n)
  return startOfDay(d)
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

// Timeline for one or more days side by side (pass `days`, ascending day
// starts; a single `day` still works). The parent owns the entries and the
// visible days; every mutation here goes through the API, then onChange().
export default function Timetable({
  teamId,
  day,
  days: daysProp,
  entries,
  loading,
  currentEntry,
  onChange,
  onTaskTracked,
  onPickDay,
  offDays = [], // days outside the user's working days, shown muted
  hoverKey,
  onHoverBlock,
  dragCard,
  listColors,
}) {
  const days = daysProp && daysProp.length ? daysProp : [day]
  const firstDay = days[0]
  const multi = days.length > 1

  const [now, setNow] = useState(Date.now())
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  // Snapping to the zoom level's grid is the default; turning it off in
  // Settings makes drags and the editor work to the minute
  const [snapOn, setSnapOn] = useState(true)
  const { px: pxPerHour, snap: gridMs } = ZOOM_LEVELS[zoom]
  const snapMs = snapOn ? gridMs : MINUTE_MS
  const snapT = ms => snap(ms, snapMs)

  useEffect(() => {
    window.api.store.get(SNAP_KEY).then(v => setSnapOn(v !== false))
    return window.api.store.onChange(({ key, value }) => {
      if (key === SNAP_KEY) setSnapOn(value !== false)
    })
  }, [])

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
  const [dragRange, setDragRange] = useState(null) // { day, anchor, current }
  const [draft, setDraft] = useState(null) // { day, start, end }
  const [draftDesc, setDraftDesc] = useState('')
  const [draftTask, setDraftTask] = useState(null) // picked { id, name }
  const [draftTaskQuery, setDraftTaskQuery] = useState('')
  const [draftTaskFocus, setDraftTaskFocus] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draggingBlock, setDraggingBlock] = useState(null)
  const [editing, setEditing] = useState(null) // { entry, running, day }
  // Hovering a card on the left highlights all of its blocks; hovering a
  // block highlights only that block (the card still lights up)
  const [hoveredBlockId, setHoveredBlockId] = useState(null)
  const [editStart, setEditStart] = useState(0)
  const [editEnd, setEditEnd] = useState(0)
  const [editTaskText, setEditTaskText] = useState('')
  const [editTaskPicked, setEditTaskPicked] = useState(null)
  const [editTaskResults, setEditTaskResults] = useState(null)
  // Which popup has the new-task form open: 'edit' | 'draft' | null
  const [creatingIn, setCreatingIn] = useState(null)

  // One popup at a time app-wide; the create form nests inside its popup
  usePopup('timetable/edit', !!editing, () => setEditing(null))
  usePopup('timetable/draft', !!draft, () => resetDraft())
  usePopup(`timetable/${creatingIn}/create`, creatingIn !== null, () => setCreatingIn(null))

  async function createTaskIn(name, listId) {
    const task = await createTask(listId, name)
    onTaskTracked?.(task.id)
    return { id: task.id, name: task.name }
  }

  // New task from the list picker, placed into whichever popup asked
  async function createPicked(listId, name) {
    setSaving(true)
    try {
      const t = await createTaskIn(name, listId)
      if (creatingIn === 'draft') { setDraftTask(t); setDraftTaskQuery('') }
      else { setEditTaskPicked(t); setEditTaskText(t.name); setEditTaskResults(null) }
      setCreatingIn(null)
    } catch (err) { alert(err.message) } finally { setSaving(false) }
  }
  // Measured height of the edit popup, so it can be placed beside its block
  const editRef = useRef(null)
  const [editH, setEditH] = useState(0)
  useLayoutEffect(() => {
    if (editing && editRef.current) setEditH(editRef.current.offsetHeight)
  }, [editing, editTaskResults])
  const [dropTime, setDropTime] = useState(null)
  const editSearchRef = useRef(null)
  const draggingRef = useRef(null)
  const scrollRef = useRef(null)
  const innerRef = useRef(null)
  const rangeStartOffRef = useRef(0)
  const geomRef = useRef(null)

  const todayStart = startOfDay(new Date(now))
  const todayIdx = days.indexOf(todayStart)
  const hasToday = todayIdx !== -1

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

  // Center the view: on "now" when today is visible, on mid-morning otherwise
  useEffect(() => {
    if (loading || !scrollRef.current) return
    const anchor = hasToday ? Date.now() - todayStart : 9.5 * HOUR_MS
    const y = ((anchor - rangeStartOffRef.current) / HOUR_MS) * pxPerHour
    const el = scrollRef.current
    el.scrollTop = y - el.clientHeight / 2
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, firstDay, days.length])

  const { tasks: draftSuggestions, settled: draftSettled } = useTaskSuggestions(teamId, undefined, draftTaskQuery, { limit: 5 })

  function resetDraft() {
    setCreatingIn(null)
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
  }, [firstDay, days.length])

  // ── geometry helpers ──────────────────────────────────────────────────────
  // Which day column an x position falls in
  function dayIndexAtX(x) {
    const g = geomRef.current
    if (!g) return 0
    const i = Math.floor((x - COLS_X) / (g.dayW + DAY_GAP))
    return Math.max(0, Math.min(days.length - 1, i))
  }

  function dayIndexOf(t) {
    for (let i = days.length - 1; i >= 0; i--) if (t >= days[i]) return i
    return 0
  }

  // Exact time under the pointer; the day comes from the pointer's column
  // unless the caller pins it (dragging stays inside one day)
  function pointerTime(e, fixedDay = null) {
    const g = geomRef.current
    if (!innerRef.current || !g) return null
    const rect = innerRef.current.getBoundingClientRect()
    const y = e.clientY - rect.top
    const d = fixedDay ?? days[dayIndexAtX(e.clientX - rect.left)]
    const t = d + g.minOff + (y / pxPerHour) * HOUR_MS
    return Math.max(d, Math.min(t, d + DAY_MS))
  }

  // Same, snapped to the grid
  function getTimeFromEvent(e, fixedDay = null) {
    const t = pointerTime(e, fixedDay)
    if (t === null) return null
    const d = fixedDay ?? days[dayIndexOf(t)]
    return Math.max(d, Math.min(snapT(t), d + DAY_MS))
  }

  // ── magnet: edges of neighbouring entries attract a dragged edge ─────────
  // Start and end of every other entry on the day, plus the current time on
  // today, as drag targets
  function edgesOnDay(day, excludeId) {
    const out = []
    const dEnd = day + DAY_MS
    if (now >= day && now < dEnd) out.push(now)
    for (const e of entries || []) {
      if (e.id === excludeId) continue
      const s = parseInt(e.start)
      const en = currentEntry?.id === e.id ? now : s + Math.max(parseInt(e.duration || 0), 0)
      if (en < day || s > dEnd) continue
      if (s >= day) out.push(s)
      if (en <= dEnd) out.push(en)
    }
    return out
  }

  // The nearest edge within a few pixels of t, or null. Beats the grid, so
  // an entry can be laid flush against its neighbour whatever the snap is
  const MAGNET_PX = 8
  function magnet(t, edges) {
    const thr = (MAGNET_PX / pxPerHour) * HOUR_MS
    let best = null
    for (const edge of edges) {
      const dist = Math.abs(edge - t)
      if (dist <= thr && (best === null || dist < Math.abs(best - t))) best = edge
    }
    return best
  }

  // Grid snap unless an edge is close enough to take over
  function snapOrMagnet(t, edges) {
    return magnet(t, edges) ?? snapT(t)
  }

  // ── entry editor popup ────────────────────────────────────────────────────
  function openEditor(entry, entryDay) {
    const running = currentEntry?.id === entry.id
    // Exact times, not snapped: the pickers list them alongside the grid so
    // opening and saving untouched leaves the entry as it was. A running
    // entry has no end yet; the editor shows "now" and only the start (and
    // task) can change
    const start = parseInt(entry.start)
    let end = running
      ? snapT(Date.now() + snapMs - 1)
      : start + Math.max(parseInt(entry.duration || 0), 0)
    if (end <= start) end = start + snapMs
    // `day` is the column the popup sits in; an overnight entry can be opened
    // from its continuation, so start and end carry their own dates
    resetDraft()
    // Remember what was on screen so the popup can be kept inside it
    const sc = scrollRef.current
    const view = sc ? { top: sc.scrollTop - 8, height: sc.clientHeight } : null
    setCreatingIn(null)
    setEditing({ entry, running, day: entryDay, view })
    setEditStart(start)
    setEditEnd(end)
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

    const rect = innerRef.current.getBoundingClientRect()
    const dragDay = days[dayIndexAtX(e.clientX - rect.left)]
    const edges = edgesOnDay(dragDay, null)
    const clampDay = t => Math.max(dragDay, Math.min(t, dragDay + DAY_MS))
    const timeAt = ev => {
      const raw = pointerTime(ev, dragDay)
      return raw === null ? null : clampDay(snapOrMagnet(raw, edges))
    }
    const anchor = timeAt(e)
    setDragRange({ day: dragDay, anchor, current: anchor })

    function onMove(ev) {
      const current = timeAt(ev)
      if (current !== null) setDragRange({ day: dragDay, anchor, current })
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const current = timeAt(ev) ?? anchor
      const start = Math.min(anchor, current)
      const end = Math.max(anchor, current)
      setDragRange(null)
      if (end - start >= Math.max(snapMs, MIN_DRAG_MS)) {
        setDraft({ day: dragDay, start, end })
        setDraftDesc('')
        setDraftTask(null)
        setDraftTaskQuery('')
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── drag existing block (move or resize), kept within its day ────────────
  function handleBlockMouseDown(e, entry, type, blockDay) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    const isRunning = currentEntry?.id === entry.id
    const origStart = parseInt(entry.start)
    // A running entry reports a negative duration; its end is now
    const origDuration = isRunning ? Date.now() - origStart : parseInt(entry.duration || 0)
    const anchorMs = pointerTime(e, blockDay)
    const edges = edgesOnDay(blockDay, entry.id)

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
      const t = pointerTime(ev, blockDay)
      if (t === null) return
      let next
      if (type === 'move') {
        // Either edge of the moving block may latch onto a neighbour
        const rawStart = origStart + (t - anchorMs)
        const mStart = magnet(rawStart, edges)
        const mEnd = magnet(rawStart + origDuration, edges)
        let newStart
        if (mStart !== null && (mEnd === null || Math.abs(mStart - rawStart) <= Math.abs(mEnd - origDuration - rawStart))) newStart = mStart
        else if (mEnd !== null) newStart = mEnd - origDuration
        else newStart = snapT(rawStart)
        newStart = Math.max(blockDay, Math.min(newStart, blockDay + DAY_MS - origDuration))
        next = { ...draggingRef.current, currentStart: newStart, currentEnd: newStart + origDuration }
      } else if (type === 'start') {
        // Top edge: the end stays put
        const end = origStart + origDuration
        const newStart = Math.max(blockDay, Math.min(snapOrMagnet(t, edges), end - snapMs))
        next = { ...draggingRef.current, currentStart: newStart }
      } else {
        const newEnd = Math.min(Math.max(snapOrMagnet(t, edges), origStart + snapMs), blockDay + DAY_MS)
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
        openEditor(entry, blockDay)
        return
      }

      const changed = d.type === 'resize'
        ? d.currentEnd !== d.origStart + d.origDuration
        : d.currentStart !== d.origStart
      if (!changed) return

      let body
      if (d.type === 'move') body = { start: d.currentStart, duration: d.origDuration }
      else if (d.type === 'start') body = isRunning ? { start: d.currentStart } : { start: d.currentStart, duration: d.currentEnd - d.currentStart }
      else body = { start: d.origStart, duration: d.currentEnd - d.origStart }

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

  function clampDrop(t) {
    const d = days[dayIndexOf(t)]
    return Math.min(t, d + DAY_MS - DROP_DUR)
  }

  function handleDragOver(e) {
    if (!dragCard) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const t = getTimeFromEvent(e)
    if (t !== null) setDropTime(clampDrop(t))
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
    const start = clampDrop(t)
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
  // Per day: its entries, plus overnight entries from the previous day that
  // spill past midnight (rendered clamped, marked __cont)
  const blocksByDay = days.map(d => {
    const dEnd = d + DAY_MS - 1
    const list = []
    for (const e of entries || []) {
      const s = parseInt(e.start)
      if (s >= d && s <= dEnd) {
        list.push(e)
      } else if (s < d && s + Math.max(parseInt(e.duration || 0), 0) > d) {
        list.push({ ...e, __cont: true })
      }
    }
    if (currentEntry?.id) {
      const s = parseInt(currentEntry.start)
      if (s <= dEnd && now > d) {
        const idx = list.findIndex(e => e.id === currentEntry.id)
        const live = { ...currentEntry, duration: String(now - s), __cont: s < d || undefined }
        if (idx !== -1) list[idx] = live
        else list.push(live)
      }
    }
    return list
  })

  if (loading) return <div className="timetable-state">Loading…</div>

  const colW = Math.max((width || 380) - COLS_X - 8, 50)
  const dayW = multi ? (colW - DAY_GAP * (days.length - 1)) / days.length : colW
  const dayX = i => COLS_X + i * (dayW + DAY_GAP)

  // Vertical range, as offsets from midnight, shared by all visible days
  let minOff = 7 * HOUR_MS
  let maxOff = 12 * HOUR_MS
  days.forEach((d, i) => {
    for (const e of blocksByDay[i]) {
      const bStart = Math.max(parseInt(e.start), d)
      const bEnd = parseInt(e.start) + Math.max(parseInt(e.duration || 0), 0)
      minOff = Math.min(minOff, bStart - d)
      maxOff = Math.max(maxOff, Math.min(Math.max(bEnd, d) - d, DAY_MS))
    }
  })
  if (hasToday) {
    minOff = Math.min(minOff, now - todayStart)
    maxOff = Math.max(maxOff, now - todayStart)
  }
  minOff = Math.max(Math.floor(minOff / HOUR_MS) * HOUR_MS, 0)
  maxOff = Math.min(Math.ceil(maxOff / HOUR_MS) * HOUR_MS, DAY_MS)
  rangeStartOffRef.current = minOff
  geomRef.current = { minOff, dayW }

  // Hour boundaries, first to last; the canvas spans exactly those hours so
  // the last line (midnight at most) is the bottom edge, not another hour
  const hours = []
  for (let off = minOff; off <= maxOff; off += HOUR_MS) hours.push(off)
  const gridH = (hours.length - 1) * pxPerHour

  const offToY = (off) => ((off - minOff) / HOUR_MS) * pxPerHour

  const nowOff = now - todayStart

  const dragPreview = dragRange
    ? { day: dragRange.day, start: Math.min(dragRange.anchor, dragRange.current), end: Math.max(dragRange.anchor, dragRange.current) }
    : null

  const innerClass = [
    'timetable-inner',
    dragRange ? 'timetable-inner-dragging' : '',
    draggingBlock ? 'timetable-inner-block-dragging' : '',
  ].filter(Boolean).join(' ')

  // Popups are as wide as a day column but never narrower than usable, and
  // never past the right edge
  function popupBox(d, minW) {
    const w = Math.min(Math.max(dayW - 6, minW), colW)
    const left = Math.min(dayX(days.indexOf(d)), COLS_X + colW - w)
    return { left, width: w }
  }

  return (
    <div className="timetable">
      {multi && (
        <div className="timetable-days-header" style={{ paddingLeft: COLS_X }}>
          {days.map((d, i) => {
            const dt = new Date(d)
            const isT = d === todayStart
            const off = offDays.includes(d)
            return (
              <button
                key={d}
                className={`timetable-day-head ${isT ? 'timetable-day-head-today' : ''} ${off ? 'timetable-day-head-off' : ''}`}
                style={{ width: dayW, marginRight: i < days.length - 1 ? DAY_GAP : 0 }}
                onClick={() => onPickDay?.(d)}
                title={onPickDay ? 'Open this day' : undefined}
              >
                <span className="timetable-day-head-wd">{dt.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className="timetable-day-head-num">{dt.getDate()}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="timetable-scroll" ref={scrollRef} onWheel={handleWheel}>
        <div
          className={innerClass}
          ref={innerRef}
          style={{ height: gridH }}
          onMouseDown={handleInnerMouseDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {hours.map((off, i) => (
            <div key={off} className="timetable-hour" style={{ top: i * pxPerHour }}>
              <span className="timetable-hour-label">{formatHour(firstDay + off)}</span>
              <div className="timetable-hour-line" />
            </div>
          ))}

          {multi && days.slice(1).map((d, i) => (
            <div key={d} className="timetable-day-sep" style={{ left: dayX(i + 1) - DAY_GAP / 2 }} />
          ))}

          {multi && offDays.map(d => days.includes(d) && (
            <div key={d} className="timetable-day-off" style={{ left: dayX(days.indexOf(d)), width: dayW }} />
          ))}

          {hasToday && nowOff >= minOff && nowOff <= maxOff && (
            <div
              className="timetable-now-line"
              style={{ top: offToY(nowOff), left: dayX(todayIdx), width: dayW - 4 }}
            />
          )}

          {days.map((d, di) => {
            // Resolve display times, then assign overlapping entries to lanes
            const renderBlocks = blocksByDay[di].map(entry => {
              const isRunning = currentEntry?.id === entry.id
              const isDragging = draggingBlock?.id === entry.id
              const cont = !!entry.__cont
              const realStart = parseInt(entry.start)
              let blockStart, blockEnd
              if (isDragging) {
                blockStart = draggingBlock.type === 'resize' ? draggingBlock.origStart : draggingBlock.currentStart
                blockEnd = isRunning ? now : draggingBlock.currentEnd
              } else {
                blockStart = cont ? d : realStart
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
              // treat blocks as at least one slot tall so the minimum block height can't hide anything
              const effEnd = Math.max(b.blockEnd, b.blockStart + gridMs)
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
              const startOff = blockStart - d
              const endOff = Math.min(blockEnd - d, DAY_MS)
              const top = offToY(startOff)
              const height = Math.max(offToY(endOff) - top, MIN_BLOCK_PX)
              const label = entry.task?.name || entry.description || 'Untitled'
              const subW = (dayW - 6) / laneCount
              const left = dayX(di) + lane * subW
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
                    multi ? 'timetable-block-narrow' : '',
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
                      ? `${label} · started the day before ${formatTime(realStart)} · ${formatDurationShort(totalDuration)} total (counts for that day) · click to edit`
                      : `${label} · ${formatDurationShort(duration)}`
                    : undefined}
                  onMouseDown={!isRunning && !cont ? e => handleBlockMouseDown(e, entry, 'move', d) : e => e.stopPropagation()}
                  onClick={isRunning || cont ? () => openEditor(entry, d) : undefined}
                  onMouseEnter={() => { setHoveredBlockId(entry.id); onHoverBlock?.(blockKey(entry)) }}
                  onMouseLeave={() => { setHoveredBlockId(null); onHoverBlock?.(null) }}
                >
                  {height >= MIN_BLOCK_PX && (
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
                          ? `from ${formatTime(realStart)}`
                          : formatDurationShort(duration)}
                    </span>
                  )}
                  {/* Only blocks with room for it get the corner button; short
                      ones still offer Resume in their edit popover */}
                  {!isRunning && height >= 44 && blockW >= 90 && (
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
                  {/* Top edge moves the start; a continuation's top is midnight, not its start */}
                  {!cont && (
                    <div
                      className="timetable-block-start-handle"
                      onMouseDown={e => { e.stopPropagation(); handleBlockMouseDown(e, entry, 'start', d) }}
                      onClick={e => e.stopPropagation()}
                    />
                  )}
                  {!isRunning && (
                    <div
                      className="timetable-block-resize-handle"
                      onMouseDown={e => { e.stopPropagation(); handleBlockMouseDown(e, entry, 'resize', d) }}
                      onClick={e => e.stopPropagation()}
                    />
                  )}
                </div>
              )
            })
          })}

          {dragCard && dropTime !== null && (() => {
            const dd = days[dayIndexOf(dropTime)]
            return (
              <div
                className="timetable-drag-preview timetable-drop-preview"
                style={{
                  top: offToY(dropTime - dd),
                  height: (DROP_DUR / HOUR_MS) * pxPerHour,
                  left: dayX(days.indexOf(dd)),
                  width: dayW - 6,
                  ...(listColors?.[dragCard.listId] ? { borderLeftColor: listColors[dragCard.listId] } : {}),
                }}
              >
                <span className="timetable-drag-label">
                  {dragCard.task?.name || dragCard.description || 'Untitled'}
                  {' · '}
                  {formatTime(dropTime)} – {formatTime(dropTime + DROP_DUR)}
                </span>
              </div>
            )
          })()}

          {dragPreview && (
            <div
              className="timetable-drag-preview"
              style={{
                top: offToY(dragPreview.start - dragPreview.day),
                height: Math.max(((dragPreview.end - dragPreview.start) / HOUR_MS) * pxPerHour, 2),
                left: dayX(days.indexOf(dragPreview.day)),
                width: dayW - 6,
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
              style={{ top: offToY(draft.start - draft.day), ...popupBox(draft.day, 240) }}
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
              {!draftTask && draftTaskFocus && creatingIn !== 'draft' && (draftSuggestions.length > 0 || (draftTaskQuery.trim() && draftSettled)) && (
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
                  {draftTaskQuery.trim() && draftSettled && draftSuggestions.length === 0 && (
                    <>
                      <div className="edit-task-empty">No task called “{draftTaskQuery.trim()}”.</div>
                      <button
                        className="edit-task-result edit-task-create"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => setCreatingIn('draft')}
                      >
                        <span className="edit-task-result-name">+ Create task “{draftTaskQuery.trim()}”</span>
                      </button>
                    </>
                  )}
                </div>
              )}
              {creatingIn === 'draft' && (
                <CreateTaskForm
                  teamId={teamId}
                  initialName={draftTaskQuery.trim()}
                  busy={saving}
                  onCreate={createPicked}
                  onCancel={() => setCreatingIn(null)}
                />
              )}
              {creatingIn !== 'draft' && (
                <div className="draft-actions">
                  <button className="draft-cancel" onClick={cancelDraft}>Cancel</button>
                  <button className="draft-save" onClick={saveDraft} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          )}

          {editing && (() => {
            const eday = editing.day
            // Prefer sitting just above the block so the entry stays visible,
            // then just below it; only cover it when neither fits in the part
            // of the canvas that was on screen when the editor opened (the
            // scroll container has 8px top padding, hence the view offset)
            const POPUP_H = editH || 150
            const GAP = 6
            const view = editing.view
            const viewTop = view ? view.top + 8 : 0
            const viewBot = view ? view.top + view.height - 8 : gridH
            const es = parseInt(editing.entry.start)
            const ee = editing.running ? now : es + Math.max(parseInt(editing.entry.duration || 0), 0)
            const bTop = offToY(Math.max(es, eday) - eday)
            const bBot = offToY(Math.min(ee, eday + DAY_MS) - eday)
            // Above is anchored by its bottom edge, so it hugs the block
            // whatever the popup's exact height turns out to be
            let pos
            if (bTop - GAP - POPUP_H >= Math.max(viewTop, 0)) pos = { bottom: gridH - (bTop - GAP) }
            else if (bBot + GAP + POPUP_H <= Math.min(viewBot, gridH)) pos = { top: bBot + GAP }
            else pos = { top: Math.max(Math.min(Math.max(bTop, viewTop), viewBot - POPUP_H, gridH - POPUP_H), 0) }
            const startDay = startOfDay(editStart)
            const endDay = startOfDay(editEnd)
            // Start can be any day from two weeks before the entry up to
            // today; the end stays within two days of the start, which is as
            // far as the entry fetch looks ahead
            const startDays = []
            for (let d = addDays(Math.min(startDay, todayStart), -14); d <= Math.max(startDay, todayStart); d = addDays(d, 1)) startDays.push(d)
            const endDays = []
            for (let d = startDay; d <= Math.max(addDays(startDay, 2), endDay); d = addDays(d, 1)) endDays.push(d)
            // Running: start can be anything up to now (inclusive, so a
            // just-started timer's snapped start is still in the list)
            const startMax = editing.running
              ? Math.min(Math.max(snapT(Date.now()), editStart), startDay + DAY_MS - snapMs)
              : startDay + DAY_MS - snapMs
            // Option lists for the grid pickers (snapping on); the entry's
            // exact times are listed too so an untouched save changes nothing
            const startOpts = []
            const endOpts = []
            if (snapOn) {
              for (let t = startDay; t <= startMax; t += snapMs) startOpts.push(t)
              if (!startOpts.includes(editStart)) startOpts.push(editStart), startOpts.sort((a, b) => a - b)
              // first grid step after the (possibly off-grid) start
              const endFirst = Math.ceil((Math.max(endDay, editStart) + 1) / snapMs) * snapMs
              for (let t = endFirst; t <= endDay + DAY_MS; t += snapMs) endOpts.push(t)
              if (!endOpts.includes(editEnd)) endOpts.push(editEnd), endOpts.sort((a, b) => a - b)
            }
            const dayLabel = d => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
            // Moving the start day keeps the time of day and, unless running, the duration
            const moveStart = newStart => {
              const duration = editEnd - editStart
              setEditStart(newStart)
              if (!editing.running) setEditEnd(newStart + duration)
            }
            return (
              <div
                ref={editRef}
                className="timetable-draft-form timetable-edit-form"
                style={{ ...pos, ...popupBox(eday, 260) }}
                onKeyDown={e => { if (e.key === 'Escape') setEditing(null) }}
              >
                <button className="popup-close" onClick={() => setEditing(null)} title="Close (Esc)">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
                <div className="edit-times">
                  {/* Days read as plain text; clicking one opens its picker */}
                  <select
                    className="edit-day"
                    value={startDay}
                    title="Change the start day"
                    onChange={e => moveStart(Number(e.target.value) + (editStart - startDay))}
                  >
                    {startDays.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}
                  </select>
                  <span />
                  {editing.running ? (
                    <span className="edit-day edit-day-static">{dayLabel(todayStart)}</span>
                  ) : (
                    <select
                      className="edit-day"
                      value={endDay}
                      title="Change the end day"
                      onChange={e => {
                        const next = Number(e.target.value) + (editEnd - endDay)
                        setEditEnd(Math.max(next, editStart + snapMs))
                      }}
                    >
                      {endDays.map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}
                    </select>
                  )}
                  <span />
                  {snapOn ? (
                    <select
                      className="draft-input edit-select"
                      value={editStart}
                      onChange={e => moveStart(Number(e.target.value))}
                    >
                      {startOpts.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                    </select>
                  ) : (
                    <input
                      className="draft-input edit-select edit-time"
                      type="time"
                      value={toHM(editStart)}
                      max={editing.running ? toHM(Math.min(now, startDay + DAY_MS - MINUTE_MS)) : undefined}
                      onChange={e => {
                        const t = fromHM(startDay, e.target.value)
                        if (t === null) return
                        moveStart(editing.running ? Math.min(t, now) : t)
                      }}
                    />
                  )}
                  <span className="edit-times-sep">–</span>
                  {editing.running ? (
                    <span className="draft-input edit-select edit-now" title="Still running">now</span>
                  ) : snapOn ? (
                    <select
                      className="draft-input edit-select"
                      value={editEnd}
                      onChange={e => setEditEnd(Number(e.target.value))}
                    >
                      {endOpts.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                    </select>
                  ) : (
                    <input
                      className="draft-input edit-select edit-time"
                      type="time"
                      value={toHM(editEnd)}
                      onChange={e => {
                        const t = fromHM(endDay, e.target.value)
                        if (t === null) return
                        setEditEnd(Math.max(t, editStart + MINUTE_MS))
                      }}
                    />
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
                      <>
                        <div className="edit-task-empty">No task called “{editTaskText.trim()}”.</div>
                        <button
                          className="edit-task-result edit-task-create"
                          onClick={() => { setCreatingIn('edit'); setEditTaskResults(null) }}
                        >
                          <span className="edit-task-result-name">+ Create task “{editTaskText.trim()}”</span>
                        </button>
                      </>
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
                {creatingIn === 'edit' && (
                  <CreateTaskForm
                    teamId={teamId}
                    initialName={editTaskText.trim()}
                    busy={saving}
                    onCreate={createPicked}
                    onCancel={() => setCreatingIn(null)}
                  />
                )}
                {creatingIn !== 'edit' && (
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
                )}
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
