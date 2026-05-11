import { useState, useEffect } from "react";
import {
  startTimer,
  stopTimer,
  updateTimeEntry,
  getTimeEntries,
  getMyTasks,
  getTask,
} from "../lib/clickup.js";
import { formatDuration, formatDurationShort, endOfDay } from "../lib/time.js";
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
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [lastEntry, setLastEntry] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [taskDetail, setTaskDetail] = useState(null);

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

  // Sync description from running entry
  useEffect(() => {
    if (currentEntry?.id) setDescription(currentEntry.description || "");
  }, [currentEntry?.id]);

  // Fetch full task details (includes list) when tracking a task
  useEffect(() => {
    if (!currentEntry?.task?.id) { setTaskDetail(null); return; }
    getTask(currentEntry.task.id).then(setTaskDetail).catch(() => setTaskDetail(null));
  }, [currentEntry?.task?.id]);

  const isRunningUnassigned = isRunning && !currentEntry?.task;

  // Fetch suggestions when idle or running unassigned
  useEffect(() => {
    if (isRunning && !isRunningUnassigned) return;
    if (userId) {
      setSuggestionsLoading(true);
      getMyTasks(teamId, userId)
        .then((tasks) => setSuggestedTasks(tasks.slice(0, 5)))
        .catch(() => {})
        .finally(() => setSuggestionsLoading(false));
    }
    if (!isRunning) {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      getTimeEntries(teamId, sevenDaysAgo, endOfDay())
        .then((data) => {
          const sorted = (data || []).sort(
            (a, b) => parseInt(b.start) - parseInt(a.start)
          );
          setLastEntry(sorted[0] || null);
        })
        .catch(() => {});
    }
  }, [teamId, userId, isRunning, isRunningUnassigned]);

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
      setShowSuggestions(false);
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function assignToRunning(taskId) {
    setBusy(true);
    setError("");
    try {
      await updateTimeEntry(teamId, currentEntry.id, { tid: taskId });
      setShowSuggestions(false);
      onChange();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
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
            <>
              <span className="status-dot status-running" />
              <div className="timer-task-info">
                <span>{currentEntry.task?.name || "unassigned"}</span>
                {taskDetail?.list?.name && (
                  <span className="timer-task-list">{taskDetail.list.name}</span>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="status-dot" />
              <span>stopped</span>
            </>
          )}
        </div>
      </div>

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

      {/* Assign task button + collapsible suggestions */}
      {(!isRunning || isRunningUnassigned) && (
        <>
          <button
            className={`task-assign-btn ${
              showSuggestions ? "task-assign-btn-open" : ""
            }`}
            onClick={() => setShowSuggestions((v) => !v)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h11" />
            </svg>
            Assign a task
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="task-assign-chev"
            >
              <path d={showSuggestions ? "M18 15l-6-6-6 6" : "M6 9l6 6 6-6"} />
            </svg>
          </button>

          {showSuggestions && (
            <div className="suggestions">
              {suggestionsLoading && (
                <div className="suggestions-loading">Loading tasks…</div>
              )}
              {!suggestionsLoading && suggestedTasks.map((task) => (
                <button
                  key={task.id}
                  className="suggestion-item"
                  onClick={() => isRunningUnassigned ? assignToRunning(task.id) : startWithTask(task.id)}
                >
                  <div className="suggestion-info">
                    <span className="suggestion-name">{task.name}</span>
                    <span className="suggestion-meta">
                      {task.list?.name && (
                        <span className="suggestion-list">{task.list.name}</span>
                      )}
                      {task.list?.name && task.status?.status && (
                        <span className="suggestion-meta-sep">·</span>
                      )}
                      {task.status?.status && (
                        <span
                          className="suggestion-status"
                          style={{ color: task.status.color || "var(--text-muted)" }}
                        >
                          {task.status.status}
                        </span>
                      )}
                    </span>
                  </div>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="suggestion-play">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              ))}
              <button
                className="suggestions-browse"
                onClick={() => {
                  setShowSuggestions(false);
                  onBrowse();
                }}
              >
                Browse all tasks →
              </button>
            </div>
          )}
        </>
      )}

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
