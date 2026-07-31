import { useState, useEffect, useRef } from 'react'
import { getTimeEntries } from '../lib/clickup.js'
import { formatDurationShort, startOfDay, endOfDay, startOfWeek, startOfMonth } from '../lib/time.js'
import './Reports.css'

const MAX_TASK_ROWS = 7

export default function Reports({ teamId }) {
  const [range, setRange] = useState('week') // 'week' | 'month' | '30d'
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [goalMs, setGoalMs] = useState(0)

  useEffect(() => {
    window.api.store.get('stats_range').then(r => { if (r) setRange(r) })
    window.api.store.get('daily_goal_hours').then(h => setGoalMs((h || 0) * 3600000))
  }, [])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, teamId])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const days = rangeDays(range)
      const data = await getTimeEntries(teamId, days[0], endOfDay(new Date(days[days.length - 1])))
      setEntries((data || []).filter(e => parseInt(e.duration) > 0))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function pickRange(r) {
    setRange(r)
    window.api.store.set('stats_range', r)
  }

  const days = rangeDays(range)

  // Aggregate per day and per task
  const perDay = {}
  const perTask = {}
  let total = 0
  for (const e of entries) {
    const ms = parseInt(e.duration)
    const dayKey = startOfDay(new Date(parseInt(e.start)))
    perDay[dayKey] = (perDay[dayKey] || 0) + ms
    const taskId = e.task?.id || 'none'
    if (!perTask[taskId]) perTask[taskId] = { id: taskId, name: e.task?.name || 'No task', ms: 0 }
    perTask[taskId].ms += ms
    total += ms
  }

  const activeDays = days.filter(d => perDay[d] > 0).length
  const avgPerDay = activeDays ? total / activeDays : 0

  const ranked = Object.values(perTask).sort((a, b) => b.ms - a.ms)
  const taskRows = ranked.slice(0, MAX_TASK_ROWS)
  if (ranked.length > MAX_TASK_ROWS) {
    taskRows.push({
      id: 'other',
      name: `Other (${ranked.length - MAX_TASK_ROWS} tasks)`,
      ms: ranked.slice(MAX_TASK_ROWS).reduce((s, t) => s + t.ms, 0),
    })
  }
  const maxTaskMs = taskRows.length ? taskRows[0].ms : 0

  return (
    <div className="stats">
      <div className="stats-header">
        <div className="history-tabs">
          <button className={`mini-tab ${range === 'week' ? 'mini-tab-active' : ''}`} onClick={() => pickRange('week')}>Week</button>
          <button className={`mini-tab ${range === 'month' ? 'mini-tab-active' : ''}`} onClick={() => pickRange('month')}>Month</button>
          <button className={`mini-tab ${range === '30d' ? 'mini-tab-active' : ''}`} onClick={() => pickRange('30d')}>30 Days</button>
        </div>
        <span className="stats-range-label">{formatRangeLabel(days)}</span>
      </div>

      <div className="stats-scroll" style={loading && entries.length ? { opacity: 0.55 } : undefined}>
        {error && <div className="stats-error">{error}</div>}
        {loading && !entries.length && !error && <div className="stats-empty">Loading…</div>}

        {!error && (!loading || entries.length > 0) && (
          <>
            <div className="stats-tiles">
              <StatTile label="Total" value={formatDurationShort(total)} />
              <StatTile label="Avg / day" value={formatDurationShort(avgPerDay)} />
              <StatTile label="Days" value={`${activeDays}/${days.length}`} />
            </div>

            <div className="stats-section-title">Hours per day</div>
            <DayChart days={days} perDay={perDay} goalMs={goalMs} range={range} />

            {total === 0 && !loading ? (
              <div className="stats-empty">
                <span className="stats-empty-em">No entries.</span><br />
                Nothing tracked in this range yet.
              </div>
            ) : (
              <>
                <div className="stats-section-title">By task</div>
                <div className="stats-tasks">
                  {taskRows.map(row => (
                    <div key={row.id} className="task-row" title={row.name}>
                      <div className="task-row-top">
                        <span className="task-row-name">{row.name}</span>
                        <span className="task-row-pct">{total ? Math.round((row.ms / total) * 100) : 0}%</span>
                        <span className="task-row-val">{formatDurationShort(row.ms)}</span>
                      </div>
                      <div className="task-row-track">
                        <div className="task-row-bar" style={{ width: `${maxTaskMs ? (row.ms / maxTaskMs) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value }) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value">{value}</div>
    </div>
  )
}

const PAD = { top: 18, right: 8, bottom: 18, left: 32 }
const CHART_H = 150

function DayChart({ days, perDay, goalMs, range }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null) // { i, cx }

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  if (!width) return <div ref={wrapRef} className="stats-chart-wrap" style={{ height: CHART_H }} />

  const plotW = width - PAD.left - PAD.right
  const plotH = CHART_H - PAD.top - PAD.bottom
  const y0 = PAD.top + plotH

  const goalH = goalMs / 3600000
  const dataMaxH = Math.max(...days.map(d => (perDay[d] || 0) / 3600000), 0)
  const { top, step } = niceScale(Math.max(dataMaxH, goalH, 1))
  const yFor = hours => y0 - (hours / top) * plotH

  const slot = plotW / days.length
  const barW = Math.min(24, Math.max(2, slot - 2))
  const today = startOfDay()
  const maxDay = days.reduce((best, d) => ((perDay[d] || 0) > (perDay[best] || 0) ? d : best), days[0])

  const gridHours = []
  for (let h = step; h <= top; h += step) gridHours.push(h)

  // Sparse x labels for dense ranges, every weekday for the week view
  const labelEvery = range === 'week' ? 1 : Math.ceil(days.length / 6)

  const hoverDay = hover ? days[hover.i] : null

  return (
    <div ref={wrapRef} className="stats-chart-wrap" style={{ height: CHART_H }}>
      <svg width={width} height={CHART_H}>
        {gridHours.map(h => (
          <g key={h}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yFor(h)} y2={yFor(h)} className="chart-grid" />
            <text x={PAD.left - 6} y={yFor(h) + 3} textAnchor="end" className="chart-axis-label">{formatHours(h)}</text>
          </g>
        ))}

        {days.map((d, i) => {
          const ms = perDay[d] || 0
          if (!ms) return null
          const h = ms / 3600000
          const x = PAD.left + i * slot + (slot - barW) / 2
          const barH = Math.max(1.5, y0 - yFor(h))
          return (
            <path
              key={d}
              d={topRoundedBar(x, y0 - barH, barW, barH, 4)}
              className={`chart-bar ${hover?.i === i ? 'chart-bar-hover' : ''}`}
            />
          )
        })}

        {goalMs > 0 && goalH <= top && (
          <g>
            <line x1={PAD.left} x2={width - PAD.right} y1={yFor(goalH)} y2={yFor(goalH)} className="chart-goal" />
            <text x={width - PAD.right} y={yFor(goalH) - 3} textAnchor="end" className="chart-goal-label">goal</text>
          </g>
        )}

        {range === 'week' && (perDay[maxDay] || 0) > 0 && hover?.i !== days.indexOf(maxDay) && (
          <text
            x={PAD.left + days.indexOf(maxDay) * slot + slot / 2}
            y={yFor((perDay[maxDay] || 0) / 3600000) - 5}
            textAnchor="middle"
            className="chart-value-label"
          >{formatDurationShort(perDay[maxDay])}</text>
        )}

        <line x1={PAD.left} x2={width - PAD.right} y1={y0} y2={y0} className="chart-baseline" />

        {days.map((d, i) => (
          i % labelEvery === 0 && (
            <text
              key={d}
              x={PAD.left + i * slot + slot / 2}
              y={CHART_H - 5}
              textAnchor="middle"
              className={`chart-axis-label ${d === today ? 'chart-axis-today' : ''}`}
            >{xLabel(d, range)}</text>
          )
        ))}

        {days.map((d, i) => (
          <rect
            key={d}
            x={PAD.left + i * slot}
            y={PAD.top}
            width={slot}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover({ i, cx: PAD.left + i * slot + slot / 2 })}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hover && (
        <div className="chart-tooltip" style={{ left: Math.min(Math.max(hover.cx, 58), width - 58) }}>
          <span className="chart-tooltip-val">{formatDurationShort(perDay[hoverDay] || 0)}</span>
          <span className="chart-tooltip-date">
            {new Date(hoverDay).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>
      )}
    </div>
  )
}

function rangeDays(range) {
  const now = new Date()
  if (range === 'week') return listDays(new Date(startOfWeek(now)), 7)
  if (range === 'month') {
    const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return listDays(new Date(startOfMonth(now)), count)
  }
  const start = new Date(now)
  start.setDate(start.getDate() - 29)
  return listDays(start, 30)
}

function listDays(startDate, count) {
  const days = []
  const d = new Date(startDate)
  for (let i = 0; i < count; i++) {
    days.push(startOfDay(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function niceScale(maxHours) {
  const steps = [0.5, 1, 2, 3, 4, 6, 8, 12, 24]
  for (const step of steps) {
    if (maxHours / step <= 4) return { step, top: Math.ceil(maxHours / step) * step }
  }
  return { step: 24, top: Math.ceil(maxHours / 24) * 24 }
}

function topRoundedBar(x, y, w, h, r) {
  r = Math.min(r, w / 2, h)
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
}

function formatHours(h) {
  return h < 1 ? `${h * 60}m` : `${h}h`
}

function xLabel(dayMs, range) {
  const d = new Date(dayMs)
  if (range === 'week') return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.getDate()
}

function formatRangeLabel(days) {
  const opts = { month: 'short', day: 'numeric' }
  const a = new Date(days[0]).toLocaleDateString(undefined, opts)
  const b = new Date(days[days.length - 1]).toLocaleDateString(undefined, opts)
  return `${a} – ${b}`
}
