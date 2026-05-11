import { stopTimer, updateTimeEntry } from '../lib/clickup.js'
import './IdlePrompt.css'

export default function IdlePrompt({ idleSeconds, currentEntry, teamId, onDismiss }) {
  const idleMinutes = Math.round(idleSeconds / 60)

  async function handleKeep() {
    await window.api.idle.dismiss()
    onDismiss()
  }

  async function handleRemove() {
    const trimmedDuration = Math.max(0, Date.now() - idleSeconds * 1000 - parseInt(currentEntry.start))
    await stopTimer(teamId)
    await updateTimeEntry(teamId, currentEntry.id, { duration: trimmedDuration })
    await window.api.idle.dismiss()
    onDismiss('removed')
  }

  async function handleStop() {
    await stopTimer(teamId)
    await window.api.idle.dismiss()
    onDismiss('stopped')
  }

  return (
    <div className="idle-overlay">
      <div className="idle-prompt">
        <div className="idle-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <div className="idle-title">You've been idle</div>
        <div className="idle-body">
          No activity for <strong>{idleMinutes} minute{idleMinutes !== 1 ? 's' : ''}</strong>.
          What should happen to that time?
        </div>
        <div className="idle-actions">
          <button className="idle-btn idle-btn-keep" onClick={handleKeep}>
            Keep all time
          </button>
          <button className="idle-btn idle-btn-remove" onClick={handleRemove}>
            Remove idle time
          </button>
          <button className="idle-btn idle-btn-stop" onClick={handleStop}>
            Stop timer
          </button>
        </div>
      </div>
    </div>
  )
}
