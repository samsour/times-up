import { useState, useEffect, useCallback, useRef } from 'react'
import { getTeamMembers, getAllLists, getSpaces, createList, getTimeEntries, schedulableMembers } from '../lib/clickup.js'
import {
  fetchPlan, createAllocation, deleteAllocation, saveBudget, saveCapacity, countWorkdays,
} from '../lib/planning.js'
import { startOfWeek, startOfDay, endOfDay, formatDate } from '../lib/time.js'
import './Planning.css'

const DAY = 86400000
const DEFAULT_HPD = 8

export default function Planning({ teamId, userId }) {
  const [planListId, setPlanListId] = useState(undefined) // undefined = loading, null = needs setup

  useEffect(() => {
    window.api.store.get('planning_list_id').then(id => setPlanListId(id || null))
  }, [])

  if (planListId === undefined) return <div className="plan-empty">Loading…</div>
  if (planListId === null) {
    return (
      <PlanSetup
        teamId={teamId}
        onReady={async id => {
          await window.api.store.set('planning_list_id', id)
          setPlanListId(id)
        }}
      />
    )
  }
  return <PlanView teamId={teamId} userId={userId} planListId={planListId} />
}

// One-time choice of where the plan lives inside ClickUp
function PlanSetup({ teamId, onReady }) {
  const [spaces, setSpaces] = useState([])
  const [lists, setLists] = useState([])
  const [spaceId, setSpaceId] = useState('')
  const [listId, setListId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getSpaces(teamId).then(s => {
      setSpaces(s || [])
      if (s?.length) setSpaceId(String(s[0].id))
    }).catch(e => setError(e.message))
    getAllLists(teamId).then(l => setLists(l || [])).catch(() => {})
  }, [teamId])

  async function create() {
    setBusy(true)
    setError('')
    try {
      const list = await createList(spaceId, 'Planning')
      onReady(String(list.id))
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="plan-setup">
      <div className="plan-setup-title">
        <span className="plan-setup-italic">plan</span> your team
      </div>
      <p className="plan-setup-text">
        Bookings, budgets and capacities are stored as tasks in one dedicated
        ClickUp list, so every admin sees the same plan. Pick where it lives.
      </p>

      <div className="plan-setup-block">
        <label>Create a “Planning” list in</label>
        <div className="plan-setup-row">
          <select className="plan-select" value={spaceId} onChange={e => setSpaceId(e.target.value)}>
            {spaces.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </select>
          <button className="plan-btn" disabled={busy || !spaceId} onClick={create}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>

      <div className="plan-setup-block">
        <label>…or use an existing list</label>
        <div className="plan-setup-row">
          <select className="plan-select" value={listId} onChange={e => setListId(e.target.value)}>
            <option value="">Pick a list</option>
            {lists.map(l => (
              <option key={l.id} value={String(l.id)}>{l.path} / {l.name}</option>
            ))}
          </select>
          <button className="plan-btn" disabled={!listId} onClick={() => onReady(listId)}>Use</button>
        </div>
      </div>

      {error && <div className="plan-error">{error}</div>}
    </div>
  )
}

function PlanView({ teamId, userId, planListId }) {
  const [members, setMembers] = useState([])
  const [lists, setLists] = useState([])
  const [plan, setPlan] = useState(null)
  const [trackedByList, setTrackedByList] = useState({})
  const [weekOffset, setWeekOffset] = useState(0)
  const [expanded, setExpanded] = useState(null) // member user id
  const [form, setForm] = useState(null) // { editingId?, userId, listId, from, to, hpd }
  const [capDraft, setCapDraft] = useState({})
  const [newBudget, setNewBudget] = useState({ listId: '', hours: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [wide, setWide] = useState(false)
  const wrapRef = useRef(null)

  // Week timetable when there's room, compact member rows otherwise
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 560))
    ro.observe(el)
    setWide(el.clientWidth >= 560)
    return () => ro.disconnect()
  }, [loading])

  const reloadPlan = useCallback(
    () => fetchPlan(planListId).then(setPlan).catch(e => setError(e.message)),
    [planListId]
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      getTeamMembers(teamId),
      getAllLists(teamId),
      fetchPlan(planListId),
    ])
      .then(([ms, ls, p]) => {
        if (!alive) return
        setMembers(schedulableMembers(ms))
        setLists(ls || [])
        setPlan(p)
        setCapDraft(p.capacity || {})
        // Budget burn needs everyone's logged time; fetch in the background
        getTimeEntries(teamId, 1, endOfDay(), (ms || []).map(m => m.id))
          .then(entries => {
            if (!alive) return
            const per = {}
            for (const e of entries || []) {
              const lid = e.task_location?.list_id
              if (!lid) continue
              per[lid] = (per[lid] || 0) + parseInt(e.duration)
            }
            setTrackedByList(per)
          })
          .catch(() => {})
      })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [teamId, planListId])

  const listById = {}
  for (const l of lists) listById[String(l.id)] = l

  // Only lists under the "Projects" space are bookable; everything else
  // (internal spaces, the planning list itself) stays out of the pickers.
  // Existing bookings elsewhere still resolve via listById. If no such
  // space exists, fall back to all lists rather than an empty picker.
  const inProjectsSpace = l => l.path.split(' / ')[0].trim().toLowerCase() === 'projects'
  const projectLists = lists.some(inProjectsSpace) ? lists.filter(inProjectsSpace) : lists

  // The visible week, Monday-based
  const base = new Date(startOfWeek())
  base.setDate(base.getDate() + weekOffset * 7)
  const weekStart = startOfWeek(base)
  const weekEnd = endOfDay(new Date(weekStart + 6 * DAY))

  const allocations = plan?.allocations || []
  const capacityOf = uid => {
    const v = parseFloat(capDraft[String(uid)])
    return isFinite(v) && v > 0 ? v : DEFAULT_HPD
  }

  function weekAllocations(uid) {
    return allocations.filter(
      a => String(a.userId) === String(uid) && a.start <= weekEnd && a.end >= weekStart
    )
  }

  function hoursInWeek(a) {
    return countWorkdays(a.start, a.end, weekStart, weekEnd) * a.hoursPerDay
  }

  function openForm(uid, editing) {
    setError('')
    if (editing) {
      setForm({
        editingId: editing.id,
        userId: String(editing.userId),
        listId: String(editing.listId),
        from: toDateInput(editing.start),
        to: toDateInput(editing.end),
        hpd: String(editing.hoursPerDay),
      })
    } else {
      setForm({
        userId: String(uid || userId || members[0]?.id || ''),
        listId: '',
        from: toDateInput(weekStart),
        to: toDateInput(weekStart + 4 * DAY),
        hpd: '4',
      })
    }
  }

  async function submitForm() {
    const member = members.find(m => String(m.id) === form.userId)
    const list = listById[form.listId]
    const start = fromDateInput(form.from, false)
    const end = fromDateInput(form.to, true)
    const hpd = parseFloat(form.hpd)
    if (!member || !list || !start || !end || end < start || !(hpd > 0)) {
      setError('Fill in person, project, a valid date range and hours per day.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await createAllocation(planListId, {
        userId: member.id,
        userName: member.username,
        listId: form.listId,
        listName: list.name,
        start,
        end,
        hoursPerDay: hpd,
      })
      // Replace-on-edit: only drop the old booking once the new one exists
      if (form.editingId) await deleteAllocation(form.editingId)
      await reloadPlan()
      setForm(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function mutate(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await reloadPlan()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  function removeAllocation(a) {
    return mutate(() => deleteAllocation(a.id))
  }

  // Replace-on-edit: create the new booking before dropping the old one
  async function replaceAllocation(a, fields) {
    const member = members.find(m => String(m.id) === String(a.userId))
    const listId = String(fields.listId ?? a.listId)
    await createAllocation(planListId, {
      userId: a.userId,
      userName: member?.username || 'someone',
      listId,
      listName: listById[listId]?.name || 'project',
      start: fields.start ?? a.start,
      end: fields.end ?? a.end,
      hoursPerDay: fields.hoursPerDay ?? a.hoursPerDay,
    })
    await deleteAllocation(a.id)
  }

  const isSingleDay = a => startOfDay(new Date(a.start)) === startOfDay(new Date(a.end))

  const selectedMember =
    members.find(m => String(m.id) === String(selectedId)) ||
    members.find(m => String(m.id) === String(userId)) ||
    members[0]

  // Drop a project on a day. An empty day gets the full day; on an
  // occupied day the drop height gives the new project 25/50/75% and the
  // other single-day bookings shrink proportionally into the remainder.
  // (Multi-day range bookings are left alone — resizing them here would
  // change their other days too.)
  function bookSlot(listId, dayMs, pt = 1) {
    const member = selectedMember
    if (!member || busy) return
    const cap = capacityOf(member.id)
    const singles = allocations.filter(
      a =>
        String(a.userId) === String(member.id) &&
        isSingleDay(a) &&
        startOfDay(new Date(a.start)) === dayMs
    )
    const existing = singles.find(a => String(a.listId) === String(listId))
    const others = singles.filter(a => a !== existing)
    return mutate(async () => {
      if (existing) {
        await replaceAllocation(existing, { hoursPerDay: cap * pt })
      } else {
        await createAllocation(planListId, {
          userId: member.id,
          userName: member.username,
          listId: String(listId),
          listName: listById[String(listId)]?.name || 'project',
          start: dayMs,
          end: endOfDay(new Date(dayMs)),
          hoursPerDay: cap * pt,
        })
      }
      const otherTotal = others.reduce((s, a) => s + a.hoursPerDay, 0)
      if (pt < 1 && otherTotal > 0) {
        // shrink-only: a split never grows what's already booked
        const factor = Math.min(1, (cap * (1 - pt)) / otherTotal)
        if (Math.abs(factor - 1) > 0.01) {
          for (const a of others) {
            await replaceAllocation(a, { hoursPerDay: a.hoursPerDay * factor })
          }
        }
      }
    })
  }

  // Click a block to cycle ¼ → ½ → ¾ → full → ¼
  function togglePt(a) {
    if (busy) return
    const cap = capacityOf(a.userId)
    const pt = Math.round((a.hoursPerDay / cap) * 4) / 4
    const next = pt >= 1 || pt <= 0 ? 0.25 : Math.min(1, pt + 0.25)
    return mutate(() => replaceAllocation(a, { hoursPerDay: cap * next }))
  }

  function moveAllocation(allocId, dayMs) {
    const a = allocations.find(x => x.id === allocId)
    if (!a || busy) return
    return mutate(() => replaceAllocation(a, { start: dayMs, end: endOfDay(new Date(dayMs)) }))
  }

  async function commitCapacity() {
    const clean = {}
    for (const m of members) {
      const v = parseFloat(capDraft[String(m.id)])
      if (isFinite(v) && v > 0 && v !== DEFAULT_HPD) clean[String(m.id)] = v
    }
    try {
      await saveCapacity(planListId, plan?.capacityTaskId, clean)
      await reloadPlan()
    } catch (e) {
      setError(e.message)
    }
  }

  async function commitBudget(listId, hoursText, existingTaskId) {
    const hours = parseFloat(hoursText)
    if (!isFinite(hours) || hours < 0) return
    try {
      await saveBudget(planListId, existingTaskId, listId, listById[listId]?.name || 'project', hours)
      await reloadPlan()
      setNewBudget({ listId: '', hours: '' })
    } catch (e) {
      setError(e.message)
    }
  }

  // Projects worth showing: anything with a budget or an allocation
  const budgets = plan?.budgets || {}
  const projectIds = [...new Set([...Object.keys(budgets), ...allocations.map(a => String(a.listId))])]
  const today = startOfDay()
  const projects = projectIds
    .map(lid => {
      const loggedH = (trackedByList[lid] || 0) / 3600000
      const plannedH = allocations
        .filter(a => String(a.listId) === lid && a.end >= today)
        .reduce((s, a) => s + countWorkdays(a.start, a.end, today, a.end) * a.hoursPerDay, 0)
      return {
        id: lid,
        name: listById[lid]?.name || 'Unknown list',
        color: listById[lid]?.color,
        budget: budgets[lid]?.hours || 0,
        budgetTaskId: budgets[lid]?.taskId,
        loggedH,
        plannedH,
      }
    })
    .sort((a, b) => b.loggedH + b.plannedH - (a.loggedH + a.plannedH))

  if (loading) return <div className="plan-empty">Loading…</div>

  return (
    <div className="plan" ref={wrapRef}>
      <div className="plan-header">
        <div className="plan-week-nav">
          <button className="plan-week-btn" onClick={() => setWeekOffset(o => o - 1)}>‹</button>
          <button
            className="plan-week-label"
            title="Back to this week"
            onClick={() => setWeekOffset(0)}
          >
            {formatDate(weekStart)} – {formatDate(weekEnd)}
            {weekOffset === 0 && <span className="plan-week-now"> · now</span>}
          </button>
          <button className="plan-week-btn" onClick={() => setWeekOffset(o => o + 1)}>›</button>
        </div>
        <button className="plan-btn" onClick={() => openForm(null)}>+ Book</button>
      </div>

      <div className="plan-scroll">
        {error && <div className="plan-error">{error}</div>}

        {form && (
          <div className="plan-form">
            <div className="plan-form-title">{form.editingId ? 'Edit booking' : 'New booking'}</div>
            <div className="plan-form-grid">
              <label>Person</label>
              <select className="plan-select" value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))}>
                {members.map(m => <option key={m.id} value={String(m.id)}>{m.username}</option>)}
              </select>
              <label>Project</label>
              <select className="plan-select" value={form.listId} onChange={e => setForm(f => ({ ...f, listId: e.target.value }))}>
                <option value="">Pick a list</option>
                {projectLists.map(l => (
                  <option key={l.id} value={String(l.id)}>{l.path} / {l.name}</option>
                ))}
              </select>
              <label>From</label>
              <input type="date" className="plan-input" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} />
              <label>To</label>
              <input type="date" className="plan-input" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} />
              <label>Hours / day</label>
              <input type="number" min="0.5" step="0.5" className="plan-input" value={form.hpd} onChange={e => setForm(f => ({ ...f, hpd: e.target.value }))} />
            </div>
            <div className="plan-form-actions">
              <button className="plan-btn-ghost" onClick={() => setForm(null)}>Cancel</button>
              <button className="plan-btn" disabled={busy} onClick={submitForm}>
                {busy ? 'Saving…' : form.editingId ? 'Save changes' : 'Book'}
              </button>
            </div>
          </div>
        )}

        {wide && (
          <WeekBoard
            members={members}
            lists={projectLists}
            listById={listById}
            allocations={allocations}
            weekStart={weekStart}
            weekEnd={weekEnd}
            capacityOf={capacityOf}
            selected={selectedMember}
            onSelect={m => setSelectedId(m.id)}
            busy={busy}
            onDropList={bookSlot}
            onMoveAlloc={moveAllocation}
            onToggle={togglePt}
            onDelete={removeAllocation}
            onEditRange={a => openForm(null, a)}
            capacityEditor={selectedMember && (
              <span className="plan-cap-edit">
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  className="plan-input plan-cap-input"
                  value={capDraft[String(selectedMember.id)] ?? DEFAULT_HPD}
                  onChange={e => setCapDraft(c => ({ ...c, [String(selectedMember.id)]: e.target.value }))}
                  onBlur={commitCapacity}
                />
                h/day
              </span>
            )}
          />
        )}

        {!wide && (<>
        <div className="plan-section-title">Team</div>
        <div className="plan-members">
          {members.map(m => {
            const rows = weekAllocations(m.id)
            const booked = rows.reduce((s, a) => s + hoursInWeek(a), 0)
            const cap = capacityOf(m.id) * 5
            const over = booked > cap
            const isOpen = String(expanded) === String(m.id)
            return (
              <div key={m.id} className="plan-member">
                <button className="plan-member-row" onClick={() => setExpanded(isOpen ? null : m.id)}>
                  <span className="plan-member-name">{m.username}</span>
                  <span className={`plan-member-hours ${over ? 'plan-over' : ''}`}>
                    {fmtH(booked)} / {fmtH(cap)}
                  </span>
                </button>
                <div className="plan-member-track">
                  {rows.map(a => (
                    <div
                      key={a.id}
                      className="plan-member-seg"
                      title={listById[a.listId]?.name}
                      style={{
                        width: `${Math.min(100, (hoursInWeek(a) / Math.max(cap, booked)) * 100)}%`,
                        background: listById[a.listId]?.color || 'var(--accent)',
                      }}
                    />
                  ))}
                </div>

                {isOpen && (
                  <div className="plan-member-detail">
                    {rows.length === 0 && (
                      <div className="plan-detail-empty">Nothing booked this week.</div>
                    )}
                    {rows.map(a => (
                      <div key={a.id} className="plan-alloc">
                        <span
                          className="plan-dot"
                          style={{ background: listById[a.listId]?.color || 'var(--accent)' }}
                        />
                        <span className="plan-alloc-name">{listById[a.listId]?.name || 'Unknown list'}</span>
                        <span className="plan-alloc-meta">
                          {formatDate(a.start)}–{formatDate(a.end)} · {fmtH(a.hoursPerDay)}/d
                        </span>
                        <button className="plan-icon-btn" title="Edit" onClick={() => openForm(null, a)}>✎</button>
                        <button className="plan-icon-btn" title="Delete" disabled={busy} onClick={() => removeAllocation(a)}>×</button>
                      </div>
                    ))}
                    <div className="plan-detail-foot">
                      <button className="plan-btn-ghost" onClick={() => openForm(m.id)}>+ Book {m.username}</button>
                      <span className="plan-cap-edit">
                        <input
                          type="number"
                          min="1"
                          step="0.5"
                          className="plan-input plan-cap-input"
                          value={capDraft[String(m.id)] ?? DEFAULT_HPD}
                          onChange={e => setCapDraft(c => ({ ...c, [String(m.id)]: e.target.value }))}
                          onBlur={commitCapacity}
                        />
                        h/day
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        </>)}

        <div className="plan-section-title">Project budgets</div>
        {projects.length === 0 && (
          <div className="plan-detail-empty">Book someone or set a budget to see projects here.</div>
        )}
        <div className="plan-projects">
          {projects.map(p => {
            const totalH = Math.max(p.budget, p.loggedH + p.plannedH, 1)
            const overBudget = p.budget > 0 && p.loggedH + p.plannedH > p.budget
            return (
              <div key={p.id} className="plan-project">
                <div className="plan-project-top">
                  <span className="plan-dot" style={{ background: p.color || 'var(--accent)' }} />
                  <span className="plan-project-name">{p.name}</span>
                  <span className={`plan-project-meta ${overBudget ? 'plan-over' : ''}`}>
                    {fmtH(p.loggedH)} logged · {fmtH(p.plannedH)} planned
                  </span>
                  <BudgetInput
                    key={`${p.id}:${p.budget}`}
                    initial={p.budget}
                    onCommit={v => commitBudget(p.id, v, p.budgetTaskId)}
                  />
                </div>
                <div className="plan-project-track">
                  <div
                    className="plan-project-bar"
                    style={{ width: `${(p.loggedH / totalH) * 100}%`, background: p.color || 'var(--accent)' }}
                  />
                  <div
                    className="plan-project-bar plan-project-bar-planned"
                    style={{ width: `${(p.plannedH / totalH) * 100}%`, background: p.color || 'var(--accent)' }}
                  />
                  {p.budget > 0 && p.budget < totalH && (
                    <div className="plan-budget-mark" style={{ left: `${(p.budget / totalH) * 100}%` }} />
                  )}
                </div>
              </div>
            )
          })}

          <div className="plan-budget-add">
            <select
              className="plan-select"
              value={newBudget.listId}
              onChange={e => setNewBudget(b => ({ ...b, listId: e.target.value }))}
            >
              <option value="">Add a budget for…</option>
              {projectLists
                .filter(l => !projectIds.includes(String(l.id)))
                .map(l => <option key={l.id} value={String(l.id)}>{l.path} / {l.name}</option>)}
            </select>
            <input
              type="number"
              min="1"
              placeholder="hours"
              className="plan-input plan-budget-hours"
              value={newBudget.hours}
              onChange={e => setNewBudget(b => ({ ...b, hours: e.target.value }))}
            />
            <button
              className="plan-btn"
              disabled={!newBudget.listId || !newBudget.hours}
              onClick={() => commitBudget(newBudget.listId, newBudget.hours, budgets[newBudget.listId]?.taskId)}
            >Set</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Float-style week timetable: pick a person on the rail, drag a project chip
// onto a weekday to book half a day, drop again (or click the block) to make
// it a full day. Blocks from single-day bookings can be dragged between days;
// multi-day range bookings open the edit form instead.
function WeekBoard({
  members, lists, listById, allocations, weekStart, weekEnd, capacityOf,
  selected, onSelect, busy, onDropList, onMoveAlloc, onToggle, onDelete, onEditRange, capacityEditor,
}) {
  const [over, setOver] = useState(null) // { day, pt, isList }

  // Empty day → the whole day. Occupied day → drop height decides how much
  // of the day the new project claims (the rest stays with what's there).
  const zoneFor = (e, occupied) => {
    if (!occupied) return 1
    const r = e.currentTarget.getBoundingClientRect()
    const f = (e.clientY - r.top) / r.height
    return f < 1 / 3 ? 0.25 : f < 2 / 3 ? 0.5 : 0.75
  }

  const days = [0, 1, 2, 3, 4].map(i => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return startOfDay(d)
  })
  const today = startOfDay()

  const weekHours = uid =>
    allocations
      .filter(a => String(a.userId) === String(uid) && a.start <= weekEnd && a.end >= weekStart)
      .reduce((s, a) => s + countWorkdays(a.start, a.end, weekStart, weekEnd) * a.hoursPerDay, 0)

  const cap = selected ? capacityOf(selected.id) : DEFAULT_HPD

  const dayBlocks = day => {
    if (!selected) return []
    const dEnd = endOfDay(new Date(day))
    return allocations
      .filter(a => String(a.userId) === String(selected.id) && a.start <= dEnd && a.end >= day)
      .map(a => ({
        a,
        pt: a.hoursPerDay / cap,
        single: startOfDay(new Date(a.start)) === startOfDay(new Date(a.end)),
      }))
  }

  function drop(e, day) {
    e.preventDefault()
    const pt = zoneFor(e, dayBlocks(day).length > 0)
    setOver(null)
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      if (data.kind === 'list') onDropList(data.listId, day, pt)
      else if (data.kind === 'alloc') onMoveAlloc(data.id, day)
    } catch {}
  }

  return (
    <div className={`plan-board ${busy ? 'plan-board-busy' : ''}`}>
      <div className="plan-board-main">
        <div className="plan-rail">
          {members.map(m => {
            const booked = weekHours(m.id)
            const mCap = capacityOf(m.id) * 5
            const isSel = selected && String(m.id) === String(selected.id)
            return (
              <button
                key={m.id}
                className={`plan-rail-row ${isSel ? 'plan-rail-row-active' : ''}`}
                onClick={() => onSelect(m)}
              >
                <span className="plan-rail-name">{m.username}</span>
                <span className={`plan-rail-hours ${booked > mCap ? 'plan-over' : ''}`}>
                  {fmtH(booked)}/{fmtH(mCap)}
                </span>
              </button>
            )
          })}
          {capacityEditor && <div className="plan-rail-cap">{capacityEditor}</div>}
        </div>

        <div className="plan-grid">
          {days.map(day => {
            const blocks = dayBlocks(day)
            const totalH = blocks.reduce((s, b) => s + b.a.hoursPerDay, 0)

            // Live split preview while a project chip hovers this day:
            // mirror exactly what bookSlot would do, so blocks shrink (or
            // the dragged project's own block resizes) before the drop.
            const previewing = over?.day === day && over.isList
            let targetBlock = null
            let previewHours = null
            if (previewing) {
              const singles = blocks.filter(b => b.single)
              targetBlock = over.listId
                ? singles.find(b => String(b.a.listId) === String(over.listId)) || null
                : null
              const others = singles.filter(b => b !== targetBlock)
              const otherTotal = others.reduce((s, b) => s + b.a.hoursPerDay, 0)
              const factor =
                over.pt < 1 && otherTotal > 0
                  ? Math.min(1, (cap * (1 - over.pt)) / otherTotal)
                  : 1
              previewHours = b =>
                !b.single ? b.a.hoursPerDay : b === targetBlock ? cap * over.pt : b.a.hoursPerDay * factor
            }
            return (
              <div
                key={day}
                className={`plan-day ${day === today ? 'plan-day-today' : ''} ${over?.day === day ? 'plan-day-over' : ''}`}
                onDragOver={e => {
                  e.preventDefault()
                  const listType = [...e.dataTransfer.types].find(t => t.startsWith('application/x-tu-list-'))
                  setOver({
                    day,
                    pt: zoneFor(e, blocks.length > 0),
                    isList: !!listType,
                    listId: listType ? listType.slice('application/x-tu-list-'.length) : null,
                  })
                }}
                onDragLeave={() => setOver(o => (o?.day === day ? null : o))}
                onDrop={e => drop(e, day)}
              >
                <div className="plan-day-head">
                  <span>{new Date(day).toLocaleDateString(undefined, { weekday: 'short' })} {new Date(day).getDate()}</span>
                  {totalH > 0 && (
                    <span className={totalH > cap ? 'plan-over' : ''}>{fmtH(totalH)}</span>
                  )}
                </div>
                <div className="plan-day-stack">
                  {blocks.map(b => {
                    const { a, single } = b
                    const hours = previewHours ? previewHours(b) : a.hoursPerDay
                    const color = listById[a.listId]?.color || 'var(--accent)'
                    return (
                      <div
                        key={a.id}
                        className={`plan-block ${single ? 'plan-block-single' : ''} ${previewHours && b !== targetBlock && single ? 'plan-block-preview' : ''}`}
                        style={{ minHeight: Math.max(20, (hours / cap) * 96), borderLeftColor: color, background: hexA(color, 0.16) }}
                        draggable={single}
                        onDragStart={e => {
                          e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'alloc', id: a.id }))
                          e.dataTransfer.setData('application/x-tu-alloc', '1')
                        }}
                        onClick={() => (single ? onToggle(a) : onEditRange(a))}
                        title={
                          single
                            ? `${listById[a.listId]?.name || 'Unknown list'} · ${fmtH(a.hoursPerDay)} — click to cycle ¼ ½ ¾ full`
                            : `${listById[a.listId]?.name || 'Unknown list'} · ${formatDate(a.start)}–${formatDate(a.end)} · ${fmtH(a.hoursPerDay)}/d — click to edit`
                        }
                      >
                        <span className="plan-block-name">{listById[a.listId]?.name || 'Unknown list'}</span>
                        <span className="plan-block-h">{fmtH(hours)}</span>
                        <button
                          className="plan-block-x"
                          title="Remove booking"
                          onClick={e => { e.stopPropagation(); onDelete(a) }}
                        >×</button>
                      </div>
                    )
                  })}
                  {previewing && !targetBlock && (
                    <div
                      className="plan-block plan-block-ghost"
                      style={{ minHeight: Math.max(20, over.pt * 96) }}
                    >
                      <span className="plan-block-name">{Math.round(over.pt * 100)}%</span>
                      <span className="plan-block-h">{fmtH(cap * over.pt)}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="plan-palette">
        <span className="plan-palette-hint">
          Drag onto a day for {selected?.username || '…'} — empty day = full day, on a busy day the drop height splits it 25 / 50 / 75
        </span>
        <div className="plan-palette-chips">
          {lists.map(l => (
            <div
              key={l.id}
              className="plan-chip"
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'list', listId: String(l.id) }))
                // id in the type name: dragover can't read data, only types,
                // and the split preview needs to know which list is incoming
                e.dataTransfer.setData(`application/x-tu-list-${l.id}`, '1')
              }}
              title={`${l.path} / ${l.name}`}
            >
              <span className="plan-dot" style={{ background: l.color || 'var(--accent)' }} />
              {l.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ClickUp list colors are hex strings; soften them for block backgrounds
function hexA(color, alpha) {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color + Math.round(alpha * 255).toString(16).padStart(2, '0')
  }
  return 'var(--accent-dim)'
}

// Uncontrolled-ish budget field so typing doesn't fire a save per keystroke
function BudgetInput({ initial, onCommit }) {
  const [value, setValue] = useState(initial ? String(initial) : '')
  return (
    <span className="plan-budget-field">
      <input
        type="number"
        min="0"
        placeholder="—"
        className="plan-input plan-budget-hours"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => {
          if (value !== '' && parseFloat(value) !== initial) onCommit(value)
        }}
      />
      h
    </span>
  )
}

function fmtH(h) {
  const r = Math.round(h * 10) / 10
  return `${r % 1 === 0 ? r.toFixed(0) : r}h`
}

function toDateInput(ms) {
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fromDateInput(str, end) {
  if (!str) return null
  const d = new Date(`${str}T12:00:00`)
  if (isNaN(d)) return null
  return end ? endOfDay(d) : startOfDay(d)
}
