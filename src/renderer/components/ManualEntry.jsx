import { useState } from 'react'
import { createTimeEntry } from '../lib/clickup.js'
import { parseDurationInput } from '../lib/time.js'
import './ManualEntry.css'

export default function ManualEntry({ teamId, selectedTask, onPickTask, onSaved }) {
  const [duration, setDuration] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState(() => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!selectedTask) {
      onPickTask()
      return
    }
    const durMs = parseDurationInput(duration)
    if (!durMs) {
      setError('Enter a duration like “1h 30m” or “90m”.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const startMs = new Date(`${date}T${time}`).getTime()
      await createTimeEntry(teamId, {
        taskId: selectedTask.id,
        description,
        start: startMs,
        duration: durMs
      })
      setDuration('')
      setDescription('')
      onSaved?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="manual">
      <div className="manual-title">
        <span className="manual-title-italic">add</span> an entry
      </div>

      <button className="task-selector" onClick={onPickTask}>
        <div className="task-selector-label">Task</div>
        <div className="task-selector-name">
          {selectedTask?.name || (
            <span className="task-selector-placeholder">Pick a task →</span>
          )}
        </div>
      </button>

      <div className="manual-row">
        <div className="manual-field">
          <label>Duration</label>
          <input
            placeholder="1h 30m"
            value={duration}
            onChange={e => setDuration(e.target.value)}
            className="manual-input"
          />
        </div>
      </div>

      <div className="manual-row manual-row-split">
        <div className="manual-field">
          <label>Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="manual-input"
          />
        </div>
        <div className="manual-field">
          <label>Start time</label>
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            className="manual-input"
          />
        </div>
      </div>

      <div className="manual-field">
        <label>Note <span className="optional">(optional)</span></label>
        <input
          placeholder="What did you work on?"
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="manual-input"
          maxLength={200}
        />
      </div>

      {error && <div className="manual-error">{error}</div>}

      <button
        className="manual-save"
        onClick={save}
        disabled={busy || !selectedTask || !duration}
      >
        {busy ? 'Saving…' : 'Save entry'}
      </button>
    </div>
  )
}
