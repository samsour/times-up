import { useState, useEffect, useRef } from 'react'
import { getTimeEntries, getMyTasks, searchTasks } from './clickup.js'
import { endOfDay } from './time.js'

// Shared task-suggestion logic (used by the timer bar, the task picker and
// the assign form): recently tracked tasks and my in-progress tasks are
// preloaded and filtered locally on every keystroke, so matches appear
// instantly; the debounced server search only tops the list up. Previous
// results stay visible while a new search is in flight — no flashing.
//
// Returns { tasks, settled }: tasks are normalized
// { id, name, list, status, statusColor, recent }; settled is true once the
// server search for the current query has finished (or there is no query).
export function useTaskSuggestions(teamId, userId, query, { limit = 8, excludeId = null, refreshKey = null } = {}) {
  const [uid, setUid] = useState(userId ?? null)
  const [recents, setRecents] = useState([])
  const [myTasks, setMyTasks] = useState([])
  const [searchResults, setSearchResults] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const debounceRef = useRef(null)

  // Callers that don't know the user id fall back to the stored one
  useEffect(() => {
    if (userId != null) { setUid(userId); return }
    window.api.store.get('user_id').then(v => v && setUid(v))
  }, [userId])

  useEffect(() => {
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000
    getTimeEntries(teamId, fourteenDaysAgo, endOfDay())
      .then(data => {
        const sorted = (data || []).sort((a, b) => parseInt(b.start) - parseInt(a.start))
        const seen = new Set()
        const tasks = []
        for (const e of sorted) {
          if (e.task?.id && !seen.has(e.task.id)) {
            seen.add(e.task.id)
            tasks.push(normalizeTask(e.task, true))
          }
        }
        setRecents(tasks)
      })
      .catch(() => {})
  }, [teamId, refreshKey])

  useEffect(() => {
    if (!uid) return
    getMyTasks(teamId, uid)
      .then(tasks => setMyTasks(tasks.map(t => normalizeTask(t))))
      .catch(() => {})
  }, [teamId, uid, refreshKey])

  // Debounced server search
  useEffect(() => {
    clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) {
      setSearchResults(null)
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const tasks = await searchTasks(teamId, q)
        setSearchResults(tasks.map(t => normalizeTask(t)))
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, teamId])

  // Merge: recents first, then my tasks, then server results, deduped
  const q = query.trim().toLowerCase()
  let tasks
  if (!q) {
    const seen = new Set()
    tasks = [...recents, ...myTasks]
      .filter(t => t.id !== excludeId && !seen.has(t.id) && seen.add(t.id))
      .slice(0, limit)
  } else {
    const matches = t => t.name.toLowerCase().includes(q)
    const recentMatches = recents.filter(matches)
    const seen = new Set(recentMatches.map(t => t.id))
    const rest = [...myTasks.filter(matches), ...(searchResults || [])].filter(
      t => !seen.has(t.id) && seen.add(t.id)
    )
    tasks = [...recentMatches, ...rest].filter(t => t.id !== excludeId).slice(0, limit)
  }
  const settled = !q || (!searchLoading && searchResults !== null)

  return { tasks, settled }
}

function normalizeTask(t, recent = false) {
  return {
    id: t.id,
    name: t.name,
    list: t.list?.name,
    status: t.status?.status,
    statusColor: t.status?.color,
    recent,
  }
}
