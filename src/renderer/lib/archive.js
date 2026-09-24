// Read-only archive of pre-ClickUp time entries: Toggl "detailed report"
// CSV exports reachable through plain share links (Drive, Sheets, Dropbox,
// any URL). The main process downloads and caches the files; this module
// parses them into the same entry shape the ClickUp API returns so Reports
// can aggregate both sources with one code path.
//
// Expected columns (Toggl detailed export, extra columns are ignored):
// User, Email, Client, Project, Task, Description, Billable,
// Start date, Start time, End date, End time, Duration, Tags

let cache = null // { entries, files, loadedAt }
let inflight = null

export function hasArchiveConfigured() {
  return window.api.store.get('archive_urls').then(v => !!String(v || '').trim())
}

// entries are cached in memory for the session; force re-downloads
export async function loadArchive(force = false) {
  if (cache && !force) return cache
  if (inflight && !force) return inflight
  inflight = (async () => {
    const files = await window.api.archive.load(force)
    const entries = []
    const report = []
    for (const f of files) {
      let count = 0
      let parseError = null
      if (f.text) {
        try {
          const rows = parseCSV(f.text)
          for (const e of rowsToEntries(rows, f.url)) { entries.push(e); count++ }
        } catch (e) {
          parseError = e.message
        }
      }
      report.push({ url: f.url, label: f.label || f.url, fetchedAt: f.fetchedAt, error: f.error || parseError, count })
    }
    entries.sort((a, b) => a.start - b.start)
    cache = { entries, files: report, loadedAt: Date.now() }
    return cache
  })().finally(() => { inflight = null })
  return inflight
}

export function clearArchiveCache() {
  cache = null
}

// Entries overlapping [start, end], optionally limited to a set of emails
// (lower-cased). ClickUp user ids are attached by matching emails against
// the team member list so the Reports "who" filter works across sources.
export async function getArchiveEntries(start, end, { emails, members } = {}) {
  const { entries } = await loadArchive()
  const byEmail = {}
  for (const m of members || []) if (m.email) byEmail[m.email.toLowerCase()] = m
  const allow = emails ? new Set(emails.map(e => e.toLowerCase())) : null
  const out = []
  for (const e of entries) {
    if (e.start > end || e.start + e.duration < start) continue
    if (allow && !allow.has(e.email)) continue
    const m = byEmail[e.email]
    out.push(m ? { ...e, user: { id: m.id, username: m.username, email: m.email } } : e)
  }
  return out
}

function rowsToEntries(rows, sourceUrl) {
  if (!rows.length) return []
  const header = rows[0].map(h => h.trim().toLowerCase())
  const col = name => header.indexOf(name)
  const idx = {
    user: col('user'),
    email: col('email'),
    client: col('client'),
    project: col('project'),
    task: col('task'),
    description: col('description'),
    billable: col('billable'),
    startDate: col('start date'),
    startTime: col('start time'),
    duration: col('duration'),
    tags: col('tags'),
  }
  if (idx.startDate < 0 || idx.duration < 0) {
    throw new Error('Not a Toggl detailed export (missing Start date / Duration columns)')
  }
  const get = (row, i) => (i >= 0 ? (row[i] || '').trim() : '')
  const entries = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row.length || row.every(c => !c)) continue
    const start = parseLocalDateTime(get(row, idx.startDate), get(row, idx.startTime))
    const duration = parseDuration(get(row, idx.duration))
    if (!start || !duration) continue
    const project = get(row, idx.project)
    const task = get(row, idx.task)
    const description = get(row, idx.description)
    const email = get(row, idx.email).toLowerCase()
    const username = get(row, idx.user) || email || 'Unknown'
    const client = get(row, idx.client)
    const listName = project || client || 'No project'
    // Toggl users often type the "what" into Description with no Task set;
    // fall back so the "By task" breakdown stays meaningful
    const taskName = task || description || 'Untitled'
    entries.push({
      id: `toggl:${r}:${hashCode(sourceUrl)}`,
      source: 'toggl',
      start,
      end: start + duration,
      duration,
      description: task ? description : '',
      billable: /^(yes|true|1)$/i.test(get(row, idx.billable)),
      tags: get(row, idx.tags).split(',').map(t => t.trim()).filter(Boolean).map(name => ({ name })),
      email,
      task: { id: `toggl:${listName}/${taskName}`, name: taskName },
      task_location: { list_id: `toggl:${listName}`, list_name: listName, folder_name: client },
      user: { id: `toggl:${email || username}`, username, email },
    })
  }
  return entries
}

// "2025-03-14" + "09:30:00" in local time (Toggl exports in the workspace's
// reporting timezone). Also accepts DD.MM.YYYY and MM/DD/YYYY.
function parseLocalDateTime(dateStr, timeStr) {
  let y, m, d, match
  if ((match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = match
  else if ((match = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) [, d, m, y] = match
  else if ((match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, m, d, y] = match
  else return null
  const [hh = 0, mm = 0, ss = 0] = (timeStr || '').split(':').map(n => parseInt(n) || 0)
  const t = new Date(+y, +m - 1, +d, hh, mm, ss).getTime()
  return isNaN(t) ? null : t
}

// "01:30:00" → ms; also tolerates plain seconds or decimal hours
function parseDuration(s) {
  if (!s) return 0
  if (s.includes(':')) {
    const parts = s.split(':').map(n => parseInt(n) || 0)
    const [h, m, sec = 0] = parts.length === 2 ? [0, ...parts] : parts
    return ((h * 60 + m) * 60 + sec) * 1000
  }
  const n = parseFloat(s)
  if (isNaN(n)) return 0
  return n < 100 ? Math.round(n * 3600000) : Math.round(n * 1000)
}

// Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF, BOM
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const delimiter = detectDelimiter(text)
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === delimiter) {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

function detectDelimiter(text) {
  const head = text.slice(0, 2000).split(/\r?\n/)[0] || ''
  const commas = (head.match(/,/g) || []).length
  const semis = (head.match(/;/g) || []).length
  return semis > commas ? ';' : ','
}

function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
