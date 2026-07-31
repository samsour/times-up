import { useState, useEffect, useRef } from "react";
import {
  startTimer,
  stopTimer,
  updateTimeEntry,
  getTimeEntries,
  getMyTasks,
  getTask,
  searchTasks,
  createTask,
} from "../lib/clickup.js";
import { formatDuration, formatDurationShort, startOfDay, endOfDay } from "../lib/time.js";
import "./TimerPanel.css";

export default function TimerPanel({
  teamId,
  userId,
  currentEntry,
  onBrowse,
  onChange,
}) {
  const [elapsed, setElapsed] = useState(0);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recents, setRecents] = useState([]);
  const [myTasks, setMyTasks] = useState([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null); // null = not searching
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [lastList, setLastList] = useState(null);
  const [lastEntry, setLastEntry] = useState(null);
  const [taskDetail, setTaskDetail] = useState(null);
  const debounceRef = useRef(null);
  const [capacity, setCapacity] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  const [editingStart, setEditingStart] = useState(false);
  const [startEdit, setStartEdit] = useState("");

  const isRunning = !!currentEntry;

  // Tick elapsed time
  useEffect(() => {
    if (!isRunning) {
      setElapsed(0);
      return;
    }
    const startMs = parseInt(currentEntry.start);
    const update = () => setElapsed(Date.now() - startMs);
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isRunning, currentEntry]);

  // Read daily goal from local settings
  useEffect(() => {
    window.api.store.get('daily_goal_hours').then(h => setCapacity((h || 0) * 3600000));
  }, []);

  // Fetch today's completed total whenever the running entry changes
  useEffect(() => {
    getTimeEntries(teamId, startOfDay(), endOfDay())
      .then(data => {
        const ms = (data || [])
          .filter(e => !currentEntry || e.id !== currentEntry.id)
          .reduce((sum, e) => sum + parseInt(e.duration || 0), 0);
        setCompletedToday(ms);
      })
      .catch(() => {});
  }, [teamId, currentEntry?.id]);

  // Sync description from running entry
  useEffect(() => {
    if (currentEntry?.id) setDescription(currentEntry.description || "");
  }, [currentEntry?.id]);

  // Fetch full task details (includes list) when tracking a task,
  // and remember its list as the default target for quick-created tasks
  useEffect(() => {
    if (!currentEntry?.task?.id) { setTaskDetail(null); return; }
    getTask(currentEntry.task.id)
      .then((t) => {
        setTaskDetail(t);
        if (t?.list?.id) {
          const l = { id: t.list.id, name: t.list.name };
          setLastList(l);
          window.api.store.set("last_list", l);
        }
      })
      .catch(() => setTaskDetail(null));
  }, [currentEntry?.task?.id]);

  useEffect(() => {
    window.api.store.get("last_list").then((l) => l && setLastList(l));
  }, []);

  const normalizeTask = (t, recent = false) => ({
    id: t.id,
    name: t.name,
    list: t.list?.name,
    status: t.status?.status,
    statusColor: t.status?.color,
    recent,
  });

  // Recently tracked tasks (deduped, newest first) + my in-progress tasks
  useEffect(() => {
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    getTimeEntries(teamId, fourteenDaysAgo, endOfDay())
      .then((data) => {
        const sorted = (data || []).sort(
          (a, b) => parseInt(b.start) - parseInt(a.start)
        );
        if (!isRunning) setLastEntry(sorted[0] || null);
        const seen = new Set();
        const tasks = [];
        for (const e of sorted) {
          if (e.task?.id && !seen.has(e.task.id)) {
            seen.add(e.task.id);
            tasks.push(normalizeTask(e.task, true));
          }
        }
        setRecents(tasks);
      })
      .catch(() => {});
    if (userId) {
      getMyTasks(teamId, userId)
        .then((tasks) => setMyTasks(tasks.map((t) => normalizeTask(t))))
        .catch(() => {});
    }
  }, [teamId, userId, currentEntry?.id]);

  // Debounced task search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const tasks = await searchTasks(teamId, q);
        setSearchResults(tasks.map((t) => normalizeTask(t)));
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, teamId]);

  function openStartEdit() {
    const d = new Date(parseInt(currentEntry.start));
    const pad = (n) => String(n).padStart(2, "0");
    setStartEdit(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
    setEditingStart(true);
  }

  async function saveStartEdit() {
    const newMs = new Date(startEdit).getTime();
    if (!newMs || newMs >= Date.now()) { setEditingStart(false); return; }
    setBusy(true);
    setError("");
    try {
      await updateTimeEntry(teamId, currentEntry.id, { start: newMs });
      setEditingStart(false);
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    setError("");
    try {
      await stopTimer(teamId);
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startWithTask(taskId, desc = "") {
    setBusy(true);
    setError("");
    try {
      await startTimer(teamId, taskId, desc);
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Switch the running entry to this task, or start a new timer on it
  async function pickTask(task) {
    setBusy(true);
    setError("");
    try {
      if (isRunning) {
        await updateTimeEntry(teamId, currentEntry.id, { tid: task.id });
      } else {
        await startTimer(teamId, task.id, description);
      }
      setQuery("");
      setSearchOpen(false);
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTask() {
    const name = query.trim();
    if (!name || !lastList) return;
    setBusy(true);
    setError("");
    try {
      const task = await createTask(lastList.id, name);
      if (isRunning) {
        await updateTimeEntry(teamId, currentEntry.id, { tid: task.id });
      } else {
        await startTimer(teamId, task.id, description);
      }
      setQuery("");
      setSearchOpen(false);
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Build the suggestion list: recents first (they're likely what you're
  // working on), then in-progress tasks, then server search results
  const q = query.trim().toLowerCase();
  const currentTaskId = currentEntry?.task?.id;
  let searchItems;
  if (!q) {
    const seen = new Set();
    searchItems = [...recents, ...myTasks]
      .filter((t) => t.id !== currentTaskId && !seen.has(t.id) && seen.add(t.id))
      .slice(0, 8);
  } else {
    const matches = (t) => t.name.toLowerCase().includes(q);
    const recentMatches = recents.filter(matches);
    const seen = new Set(recentMatches.map((t) => t.id));
    const rest = [...myTasks.filter(matches), ...(searchResults || [])].filter(
      (t) => !seen.has(t.id) && seen.add(t.id)
    );
    searchItems = [...recentMatches, ...rest]
      .filter((t) => t.id !== currentTaskId)
      .slice(0, 10);
  }
  const searchSettled = !q || (!searchLoading && searchResults !== null);
  const showCreate = q && searchSettled && searchItems.length === 0 && lastList;

  function handleSearchKeys(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, searchItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (searchItems[highlight]) pickTask(searchItems[highlight]);
      else if (showCreate) handleCreateTask();
    } else if (e.key === "Escape") {
      e.target.blur();
    }
  }

  return (
    <div className="timer-panel">
      {/* Start / Stop */}
      <button
        className={`timer-action ${
          isRunning ? "timer-action-stop" : "timer-action-start"
        }`}
        onClick={
          isRunning ? handleStop : () => startWithTask(null, description)
        }
        disabled={busy}
      >
        {busy ? (
          "..."
        ) : isRunning ? (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
            Stop
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Start unassigned
          </>
        )}
      </button>

      {/* Clock */}
      <div className="timer-display">
        <div className={`timer-time ${isRunning ? "timer-time-running" : ""}`}>
          {formatDuration(elapsed)}
        </div>
        <div className="timer-status">
          {isRunning ? (
            <div className="timer-task-info">
              <span className="timer-task-name-row">
                <span className="status-dot status-running" />
                <span>{currentEntry.task?.name || "unassigned"}</span>
                {currentEntry.task?.id && (
                  <button
                    className="timer-task-link"
                    title="Open in ClickUp"
                    onClick={() => window.api.shell.openExternal(
                      taskDetail?.url || `https://app.clickup.com/t/${currentEntry.task.id}`
                    )}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                    </svg>
                  </button>
                )}
              </span>
              {taskDetail?.list?.name && (
                <span className="timer-task-list">{taskDetail.list.name}</span>
              )}
            </div>
          ) : (
            <>
              <span className="status-dot" />
              <span>stopped</span>
            </>
          )}
        </div>
      </div>

      {/* Start time editor */}
      {isRunning && (
        <div className="timer-start-edit">
          {editingStart ? (
            <div className="timer-start-input-row">
              <input
                type="datetime-local"
                className="timer-start-input"
                value={startEdit}
                onChange={(e) => setStartEdit(e.target.value)}
                max={new Date().toISOString().slice(0, 16)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveStartEdit();
                  if (e.key === "Escape") setEditingStart(false);
                }}
                autoFocus
              />
              <button className="timer-start-confirm" onClick={saveStartEdit} disabled={busy}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </button>
              <button className="timer-start-cancel" onClick={() => setEditingStart(false)}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button className="timer-start-show" onClick={openStartEdit}>
              since {new Date(parseInt(currentEntry.start)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Daily progress */}
      {capacity > 0 && (() => {
        const total = completedToday + (isRunning ? elapsed : 0);
        const pct = Math.min(total / capacity, 1);
        const done = pct >= 1;
        return (
          <div className="daily-progress">
            <div className="daily-progress-labels">
              <span className="daily-progress-today">{formatDurationShort(total)}</span>
              <span className="daily-progress-goal">{formatDurationShort(capacity)}</span>
            </div>
            <div className="daily-progress-track">
              <div
                className={`daily-progress-fill${done ? ' daily-progress-fill-done' : ''}`}
                style={{ width: `${pct * 100}%` }}
              />
            </div>
          </div>
        );
      })()}

      {/* Notes */}
      <input
        className="timer-description"
        placeholder="Notes..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={async () => {
          if (isRunning && currentEntry?.id) {
            try {
              await updateTimeEntry(teamId, currentEntry.id, { description });
            } catch {}
          }
        }}
        maxLength={200}
      />

      {error && <div className="timer-error">{error}</div>}

      {/* Task search: recents when empty, live search when typing */}
      <div className="task-search">
        <div className="task-search-box">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="task-search-icon">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="task-search-input"
            placeholder={isRunning ? "Switch to another task…" : "Find or start a task…"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setSearchOpen(false)}
            onKeyDown={handleSearchKeys}
          />
        </div>

        {searchOpen && (
          <div className="task-search-dropdown">
            {searchItems.map((task, i) => (
              <button
                key={task.id}
                className={`suggestion-item ${i === highlight ? "suggestion-item-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pickTask(task)}
                disabled={busy}
              >
                <div className="suggestion-info">
                  <span className="suggestion-name">{task.name}</span>
                  <span className="suggestion-meta">
                    {task.recent && <span className="suggestion-recent">recent</span>}
                    {task.list && <span className="suggestion-list">{task.list}</span>}
                    {task.status && (
                      <span
                        className="suggestion-status"
                        style={{ color: task.statusColor || "var(--text-muted)" }}
                      >
                        {task.status}
                      </span>
                    )}
                  </span>
                </div>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="suggestion-play">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            ))}

            {q && !searchSettled && searchItems.length === 0 && (
              <div className="suggestions-loading">Searching…</div>
            )}
            {q && searchSettled && searchItems.length === 0 && (
              <div className="task-search-empty">
                <span>No tasks found.</span>
                {showCreate && (
                  <button
                    className="task-search-create"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCreateTask}
                    disabled={busy}
                  >
                    + Create “{query.trim()}” in {lastList.name}
                  </button>
                )}
              </div>
            )}
            {!q && searchItems.length === 0 && (
              <div className="suggestions-loading">No recent tasks yet.</div>
            )}

            <button
              className="suggestions-browse"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSearchOpen(false);
                onBrowse();
              }}
            >
              Browse all tasks →
            </button>
          </div>
        )}
      </div>

      {/* Last entry quick-start */}
      {!isRunning && lastEntry && (
        <button
          className="last-entry"
          onClick={() =>
            startWithTask(
              lastEntry.task?.id || null,
              lastEntry.description || ""
            )
          }
        >
          <div className="last-entry-info">
            <span className="last-entry-label">last</span>
            <span className="last-entry-name">
              {lastEntry.task?.name || lastEntry.description || "Unassigned"}
            </span>
            <span className="last-entry-meta">
              {new Date(parseInt(lastEntry.start)).toLocaleTimeString(
                undefined,
                { hour: "numeric", minute: "2-digit" }
              )}
              {" · "}
              {formatDurationShort(parseInt(lastEntry.duration))} tracked
            </span>
          </div>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="last-entry-play"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}
    </div>
  );
}
