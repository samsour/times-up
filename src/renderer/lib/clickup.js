// Thin wrapper around the IPC bridge to ClickUp API
// Docs: https://developer.clickup.com/reference

const api = () => window.api.clickup;

export async function getUser() {
  const { user } = await api().request({ path: "/user" });
  return user;
}

export async function getTeams() {
  const { teams } = await api().request({ path: "/team" });
  return teams;
}

export async function getTeamMembers(teamId) {
  const teams = await getTeams();
  const team = (teams || []).find((t) => String(t.id) === String(teamId));
  return (team?.members || []).map((m) => m.user).filter(Boolean);
}

// Workspace roles: 1 = owner, 2 = admin, 3 = member, 4 = guest.
// ClickUp only lets owners/admins query other users' time entries, so the
// UI mirrors that; treat a missing role as not allowed.
export function canViewOthersTime(members, userId) {
  const me = (members || []).find((m) => String(m.id) === String(userId));
  return me?.role === 1 || me?.role === 2;
}

// Guests are clients or read-only outsiders, not part of the team's
// capacity — keep them out of planning. Only known guests are dropped so
// a missing role field doesn't empty the roster.
export function schedulableMembers(members) {
  return (members || []).filter((m) => m.role !== 4);
}

export async function getSpaces(teamId) {
  const { spaces } = await api().request({
    path: `/team/${teamId}/space?archived=false`,
  });
  return spaces;
}

export async function getFolders(spaceId) {
  const { folders } = await api().request({
    path: `/space/${spaceId}/folder?archived=false`,
  });
  return folders;
}

export async function getFolderlessLists(spaceId) {
  const { lists } = await api().request({
    path: `/space/${spaceId}/list?archived=false`,
  });
  return lists;
}

export async function getListsInFolder(folderId) {
  const { lists } = await api().request({
    path: `/folder/${folderId}/list?archived=false`,
  });
  return lists;
}

export async function getTask(taskId) {
  return api().request({ path: `/task/${taskId}` });
}

export async function getTasks(listId) {
  const { tasks } = await api().request({
    path: `/list/${listId}/task?archived=false&subtasks=true&include_closed=false`,
  });
  return tasks;
}

export async function createTask(listId, name, extra = {}) {
  const task = await api().request({
    method: "POST",
    path: `/list/${listId}/task`,
    body: { name, ...extra },
  });
  invalidateTaskCache();
  return task;
}

export async function deleteTask(taskId) {
  const res = await api().request({
    method: "DELETE",
    path: `/task/${taskId}`,
  });
  invalidateTaskCache();
  return res;
}

export async function createList(spaceId, name) {
  return api().request({
    method: "POST",
    path: `/space/${spaceId}/list`,
    body: { name },
  });
}

export async function updateTask(taskId, body) {
  return api().request({
    method: "PUT",
    path: `/task/${taskId}`,
    body,
  });
}

export async function getListStatuses(listId) {
  const list = await api().request({ path: `/list/${listId}` });
  return list?.statuses || [];
}

// Every list in the workspace, flattened with a readable path and its color
// (the list's own color label, falling back to the space color)
export async function getAllLists(teamId) {
  const spaces = (await getSpaces(teamId)) || [];
  const out = [];
  await Promise.all(
    spaces.map(async (s) => {
      const [folders, lists] = await Promise.all([
        getFolders(s.id).catch(() => []),
        getFolderlessLists(s.id).catch(() => []),
      ]);
      const listColor = (l) => l.status?.color || s.color || null;
      for (const l of lists || [])
        out.push({ id: l.id, name: l.name, path: s.name, color: listColor(l) });
      await Promise.all(
        (folders || []).map(async (f) => {
          const fl = await getListsInFolder(f.id).catch(() => []);
          for (const l of fl || [])
            out.push({ id: l.id, name: l.name, path: `${s.name} / ${f.name}`, color: listColor(l) });
        })
      );
    })
  );
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
}

// listId -> color, cached (walking spaces/folders is a handful of requests)
let listColorCache = { at: 0, teamId: null, map: null };

export async function getListColors(teamId) {
  if (
    listColorCache.map &&
    listColorCache.teamId === teamId &&
    Date.now() - listColorCache.at < 10 * 60000
  ) {
    return listColorCache.map;
  }
  const map = {};
  try {
    for (const l of await getAllLists(teamId)) {
      if (l.color) map[l.id] = l.color;
    }
  } catch {}
  listColorCache = { at: Date.now(), teamId, map };
  return map;
}

// If the task still sits in a backlog-type status ("open"), move it to the
// list's in-progress-like status. Returns the change for undo, or null.
export async function advanceTaskStatus(taskId) {
  const task = await getTask(taskId);
  if (!task?.status || task.status.type !== "open") return null;
  const statuses = await getListStatuses(task.list?.id);
  const target =
    statuses.find((s) => /progress/i.test(s.status)) ||
    statuses.find((s) => s.type === "custom" && s.status !== task.status.status);
  if (!target) return null;
  await updateTask(taskId, { status: target.status });
  return { taskId, name: task.name, from: task.status.status, to: target.status };
}

// Time tracking
export async function startTimer(teamId, taskId, description = "") {
  const body = { description };
  if (taskId) body.tid = taskId;
  return api().request({
    method: "POST",
    path: `/team/${teamId}/time_entries/start`,
    body,
  });
}

export async function stopTimer(teamId) {
  return api().request({
    method: "POST",
    path: `/team/${teamId}/time_entries/stop`,
  });
}

// Served from the main process's tray poll instead of a second API poll;
// pass force=true right after starting/stopping to fetch fresh state.
export async function getCurrentTimer(teamId, force = false) {
  try {
    return await window.api.clickup.currentTimer(force);
  } catch {
    return null;
  }
}

export async function getTimeEntries(teamId, startDate, endDate, assignees) {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  params.set("include_location_names", "true");
  // Requires workspace owner/admin to see entries other than your own
  if (assignees && assignees.length) params.set("assignee", assignees.join(","));
  const { data } = await api().request({
    path: `/team/${teamId}/time_entries?${params.toString()}`,
  });
  return data;
}

export async function createTimeEntry(
  teamId,
  { taskId, description, start, duration }
) {
  return api().request({
    method: "POST",
    path: `/team/${teamId}/time_entries`,
    body: {
      tid: taskId,
      description: description || "",
      start,
      duration,
    },
  });
}

export async function deleteTimeEntry(teamId, entryId) {
  return api().request({
    method: "DELETE",
    path: `/team/${teamId}/time_entries/${entryId}`,
  });
}

// The filtered-team-tasks endpoint has no name filter, so fetch the most
// recently updated tasks once (5 pages, ~60s cache) and match client-side.
let taskCache = { at: 0, teamId: null, tasks: null };

export function invalidateTaskCache() {
  taskCache.at = 0;
}

export async function searchTasks(teamId, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  if (
    !taskCache.tasks ||
    taskCache.teamId !== teamId ||
    Date.now() - taskCache.at > 60000
  ) {
    const pages = await Promise.all(
      [0, 1, 2, 3, 4].map((page) =>
        api()
          .request({
            path: `/team/${teamId}/task?subtasks=true&include_closed=false&order_by=updated&page=${page}`,
          })
          .then((r) => r.tasks || [])
          .catch(() => [])
      )
    );
    const seen = new Set();
    taskCache = {
      at: Date.now(),
      teamId,
      tasks: pages.flat().filter((t) => !seen.has(t.id) && seen.add(t.id)),
    };
  }
  const starts = [];
  const contains = [];
  for (const t of taskCache.tasks) {
    const name = (t.name || "").toLowerCase();
    if (name.startsWith(q)) starts.push(t);
    else if (name.includes(q)) contains.push(t);
  }
  return [...starts, ...contains].slice(0, 50);
}

export async function getMyTasks(teamId, userId) {
  try {
    const { tasks } = await api().request({
      path: `/team/${teamId}/task?assignees[]=${userId}&statuses[]=in%20progress&include_closed=false&order_by=updated&page=0`,
    });
    return tasks || [];
  } catch {
    return [];
  }
}

export async function updateTimeEntry(teamId, entryId, body) {
  return api().request({
    method: "PUT",
    path: `/team/${teamId}/time_entries/${entryId}`,
    body,
  });
}
