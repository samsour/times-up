export function formatDuration(ms) {
  if (!ms || ms < 0) ms = 0
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDurationShort(ms) {
  if (!ms || ms < 0) ms = 0
  const totalMinutes = Math.floor(ms / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function parseDurationInput(text) {
  // Accept "1h 30m", "1:30", "90m", "1.5h"
  if (!text) return 0
  text = text.trim().toLowerCase()

  if (text.includes(':')) {
    const [h, m] = text.split(':').map(n => parseInt(n) || 0)
    return (h * 60 + m) * 60 * 1000
  }

  let total = 0
  const hMatch = text.match(/(\d+(?:\.\d+)?)\s*h/)
  const mMatch = text.match(/(\d+)\s*m/)
  if (hMatch) total += parseFloat(hMatch[1]) * 3600 * 1000
  if (mMatch) total += parseInt(mMatch[1]) * 60 * 1000
  if (!hMatch && !mMatch) {
    const num = parseFloat(text)
    if (!isNaN(num)) total = num * 60 * 1000 // assume minutes
  }
  return total
}

export function formatDate(unixMs) {
  const d = new Date(parseInt(unixMs))
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatTime(unixMs) {
  const d = new Date(parseInt(unixMs))
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function startOfDay(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(date = new Date()) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}
