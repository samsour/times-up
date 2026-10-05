// Pomodoro on top of the ClickUp timer. Lives in the main process so it
// keeps going with every window hidden, drives the tray title, fires the
// notifications and stops the ClickUp timer when a focus block ends.
//
// Model: while Pomodoro mode is on, every running ClickUp entry *is* a
// focus block, counted from the entry's start. When the block is up a
// break starts. By default the entry keeps running through the break (the
// break is part of the work, and lands in ClickUp as such); when the break
// is over, or skipped, the next block starts on the same entry. Stopping
// the timer by hand ends the session. With "track breaks" off the entry is
// stopped at the end of a block instead and breaks are untracked time.

export const POMO_DEFAULTS = {
  focus: 25, // minutes
  short: 5,
  long: 15,
  every: 4, // long break after this many focus blocks
  autoNext: false, // (untracked breaks) start the next block on the same task when a break ends
  trackBreaks: true, // keep the ClickUp timer running through breaks
}

export function pomodoroSettings(store) {
  const num = (key, def) => {
    const v = parseInt(store.get(key))
    return v > 0 ? v : def
  }
  return {
    enabled: !!store.get('pomodoro_mode'),
    focus: num('pomo_focus', POMO_DEFAULTS.focus),
    short: num('pomo_short', POMO_DEFAULTS.short),
    long: num('pomo_long', POMO_DEFAULTS.long),
    every: num('pomo_every', POMO_DEFAULTS.every),
    autoNext: !!store.get('pomo_auto_next'),
    trackBreaks: store.get('pomo_track_breaks') !== false,
  }
}

const MIN = 60_000

// api: { stopTimer(), startTimer(taskId, description), sync() }
// notify(title, body); emit(state) broadcasts to the windows
export function createPomodoro({ store, api, notify, emit, log }) {
  let state = null // { phase, startedAt, endsAt, entryId, task, description, stoppedEntryId }
  let completed = 0 // focus blocks finished in the current cycle
  let ending = false // a focus block is being closed out right now

  const settings = () => pomodoroSettings(store)

  function snapshot() {
    const s = settings()
    return {
      enabled: s.enabled,
      trackBreaks: s.trackBreaks,
      phase: state?.phase || null,
      startedAt: state?.startedAt || null,
      endsAt: state?.endsAt || null,
      task: state?.task || null,
      description: state?.description || '',
      // 1-based number of the block in the current cycle, as Pomofocus shows it
      round: (completed % s.every) + 1,
      every: s.every,
      completed,
      lengths: { focus: s.focus * MIN, short: s.short * MIN, long: s.long * MIN },
    }
  }

  function publish() { emit(snapshot()) }

  function set(next) {
    state = next
    publish()
  }

  // Fed by the tray poll with the running entry or null
  function observeTimer(entry) {
    const s = settings()
    if (!s.enabled) {
      if (state) set(null)
      return
    }
    if (entry) {
      // The entry we just stopped still shows as running (slow API or the
      // stop failed): try again rather than treating it as a new block
      if (state && state.phase !== 'focus' && state.stoppedEntryId === entry.id) {
        api.stopTimer().catch(() => {})
        return
      }
      if (state?.entryId === entry.id) {
        // Same entry: block or tracked break goes on. Keep the task label fresh
        if (state.task?.id !== entry.task?.id || state.description !== (entry.description || '')) {
          state.task = entry.task ? { id: entry.task.id, name: entry.task.name } : null
          state.description = entry.description || ''
          publish()
        }
        return
      }
      const start = parseInt(entry.start)
      set({
        phase: 'focus',
        startedAt: start,
        endsAt: start + s.focus * MIN,
        entryId: entry.id,
        task: entry.task ? { id: entry.task.id, name: entry.task.name } : null,
        description: entry.description || '',
      })
      log?.(`[pomo] focus block on "${entry.task?.name || entry.description || 'untitled'}"`)
    } else if (state?.entryId && !ending) {
      // Stopped by hand: the session is over
      log?.('[pomo] session ended')
      set(null)
    }
  }

  // Next block on the entry that is still running (tracked breaks)
  function nextBlock(now = Date.now()) {
    const s = settings()
    set({
      ...state,
      phase: 'focus',
      startedAt: now,
      endsAt: now + s.focus * MIN,
      stoppedEntryId: undefined,
    })
  }

  async function tick() {
    if (!state || ending) return
    const now = Date.now()
    if (now < state.endsAt) return
    const s = settings()

    if (state.phase === 'focus') {
      const prev = state
      completed += 1
      const isLong = completed % s.every === 0
      const minutes = isLong ? s.long : s.short
      const breakState = {
        phase: isLong ? 'long' : 'short',
        startedAt: now,
        endsAt: now + minutes * MIN,
        task: prev.task,
        description: prev.description,
      }
      if (s.trackBreaks && prev.entryId) {
        // The entry keeps running; the break is part of it
        set({ ...breakState, entryId: prev.entryId })
      } else {
        ending = true
        try {
          await api.stopTimer()
        } catch (e) {
          log?.(`[pomo] stop failed: ${e.message}`)
        }
        set({ ...breakState, entryId: null, stoppedEntryId: prev.entryId })
        ending = false
        api.sync()
      }
      notify('Focus block done', isLong ? `Long break, ${minutes} min. Well earned.` : `Short break, ${minutes} min.`)
      return
    }

    // Break over
    if (state.entryId) {
      // Still tracking: straight into the next block
      nextBlock(now)
      notify('Break over', `Back to ${state.task?.name || state.description || 'work'}.`)
      return
    }
    const prev = state
    set(null)
    if (s.autoNext && (prev.task || prev.description)) {
      notify('Break over', `Next block on ${prev.task?.name || prev.description}`)
      try {
        await api.startTimer(prev.task?.id || null, prev.task ? '' : prev.description)
      } catch (e) {
        log?.(`[pomo] auto start failed: ${e.message}`)
      }
      api.sync()
    } else {
      notify('Break over', 'Ready for the next block.')
    }
  }

  // Take a break now, outside the cycle (not while a block is running)
  function startBreak(kind) {
    if (state?.phase === 'focus') return
    const s = settings()
    const minutes = kind === 'long' ? s.long : s.short
    const now = Date.now()
    set({
      phase: kind === 'long' ? 'long' : 'short',
      startedAt: now,
      endsAt: now + minutes * MIN,
      entryId: state?.entryId || null,
      task: state?.task || null,
      description: state?.description || '',
    })
  }

  // Ends a break early: next block when the timer is still running,
  // otherwise back to ready
  function skip() {
    if (!state || state.phase === 'focus') return
    if (state.entryId) nextBlock()
    else set(null)
  }

  // Adds minutes to the current block or break
  function extend(minutes) {
    if (!state) return
    set({ ...state, endsAt: state.endsAt + Math.max(1, minutes) * MIN })
  }

  function resetCycle() {
    completed = 0
    publish()
  }

  const inBreak = () => !!state && state.phase !== 'focus'
  const active = () => !!state

  // What the menu bar shows instead of the elapsed time
  function trayTitle() {
    if (!state) return null
    const left = Math.max(0, state.endsAt - Date.now())
    const m = Math.floor(left / MIN)
    const sec = Math.floor((left % MIN) / 1000).toString().padStart(2, '0')
    if (state.phase === 'focus') {
      const label = (state.task?.name || state.description || '').slice(0, 30)
      return label ? `◔ ${m}:${sec}  ${label}` : `◔ ${m}:${sec}`
    }
    const label = state.entryId ? (state.task?.name || state.description || '').slice(0, 30) : ''
    return label ? `☕ ${m}:${sec}  ${label}` : `☕ ${m}:${sec}`
  }

  return { observeTimer, tick, skip, extend, startBreak, resetCycle, snapshot, trayTitle, inBreak, active, publish }
}
