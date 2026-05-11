import { useState, useEffect, useRef } from 'react'
import { getTimeEntries } from '../lib/clickup.js'
import { formatDurationShort, startOfDay, endOfDay } from '../lib/time.js'
import './Timetable.css'

const PX_PER_HOUR = 72
const LABEL_W = 44

export default function Timetable({ teamId, currentEntry }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const scrollRef = useRef(null)
  const rangeStartRef = useRef(0)

  useEffect(() => {
    load()
  }, [teamId])

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

  async function load() {
    setLoading(true)
    try {
      const data = await getTimeEntries(teamId, startOfDay(), endOfDay())
      setEntries(data || [])
    } catch {}
    setLoading(false)
  }

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

  return (
    <div className="timetable">
      <div className="timetable-scroll" ref={scrollRef}>
        <div className="timetable-inner" style={{ height: hours.length * PX_PER_HOUR }}>

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
            const start = parseInt(entry.start)
            const isRunning = currentEntry?.id === entry.id
            const duration = isRunning ? now - start : parseInt(entry.duration || 0)
            const top = msToY(start)
            const height = Math.max(msToY(start + duration) - top, 18)
            const label = entry.task?.name || entry.description || 'Untitled'

            return (
              <div
                key={entry.id}
                className={`timetable-block${isRunning ? ' timetable-block-live' : ''}`}
                style={{ top, height, left: LABEL_W + 6, right: 8 }}
                title={`${label} · ${formatDurationShort(duration)}`}
              >
                {height >= 18 && <span className="timetable-block-name">{label}</span>}
                {height >= 34 && <span className="timetable-block-dur">{formatDurationShort(duration)}</span>}
              </div>
            )
          })}

        </div>
      </div>
    </div>
  )
}

function formatHour(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', hour12: true })
}
