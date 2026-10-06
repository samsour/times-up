import { useEffect, useRef } from 'react'

// One popup at a time across the app. Popups register under a path-like id
// ("timetable/edit", "timetable/edit/create"); opening one closes every
// other registered popup except its ancestors, so nested popups coexist
// while unrelated ones (an entry editor and a card's task form, say) do not.
const open = new Map() // id -> close()

function related(a, b) {
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/')
}

export function registerPopup(id, close) {
  for (const [other, c] of [...open]) {
    if (related(id, other)) continue
    open.delete(other)
    try { c() } catch {}
  }
  open.set(id, close)
}

export function unregisterPopup(id) {
  open.delete(id)
}

// Declares a popup's open state; `close` is called when another popup
// takes over. Always uses the latest close callback.
export function usePopup(id, isOpen, close) {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!isOpen) return
    registerPopup(id, () => closeRef.current?.())
    return () => unregisterPopup(id)
  }, [id, isOpen])
}
