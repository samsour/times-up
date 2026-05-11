// Thin wrapper around the IPC bridge to ClickUp API
// Docs: https://developer.clickup.com/reference

const api = () => window.api.clickup

export async function getUser() {
  const { user } = await api().request({ path: '/user' })
  return user
}

export async function getTeams() {
  const { teams } = await api().request({ path: '/team' })
  return teams
}

export async function getSpaces(teamId) {
  const { spaces } = await api().request({ path: `/team/${teamId}/space?archived=false` })
  return spaces
}

export async function getFolders(spaceId) {
  const { folders } = await api().request({ path: `/space/${spaceId}/folder?archived=false` })
  return folders
}

export async function getFolderlessLists(spaceId) {
  const { lists } = await api().request({ path: `/space/${spaceId}/list?archived=false` })
  return lists
}

export async function getListsInFolder(folderId) {
  const { lists } = await api().request({ path: `/folder/${folderId}/list?archived=false` })
  return lists
}

export async function getTask(taskId) {
  return api().request({ path: `/task/${taskId}` })
}

export async function getTasks(listId) {
  const { tasks } = await api().request({
    path: `/list/${listId}/task?archived=false&subtasks=true&include_closed=false`
  })
  return tasks
}

// Time tracking
export async function startTimer(teamId, taskId, description = '') {
  const body = { description }
  if (taskId) body.tid = taskId
  return api().request({ method: 'POST', path: `/team/${teamId}/time_entries/start`, body })
}

export async function stopTimer(teamId) {
  return api().request({
    method: 'POST',
    path: `/team/${teamId}/time_entries/stop`
  })
}

export async function getCurrentTimer(teamId) {
  try {
    const { data } = await api().request({ path: `/team/${teamId}/time_entries/current` })
    return data
  } catch {
    return null
  }
}

export async function getTimeEntries(teamId, startDate, endDate) {
  const params = new URLSearchParams()
  if (startDate) params.set('start_date', startDate)
  if (endDate) params.set('end_date', endDate)
  const { data } = await api().request({
    path: `/team/${teamId}/time_entries?${params.toString()}`
  })
  return data
}

export async function createTimeEntry(teamId, { taskId, description, start, duration }) {
  return api().request({
    method: 'POST',
    path: `/team/${teamId}/time_entries`,
    body: {
      tid: taskId,
      description: description || '',
      start, // unix ms
      duration // ms
    }
  })
}

export async function deleteTimeEntry(teamId, entryId) {
  return api().request({
    method: 'DELETE',
    path: `/team/${teamId}/time_entries/${entryId}`
  })
}

export async function searchTasks(teamId, query) {
  const { tasks } = await api().request({
    path: `/team/${teamId}/task?name=${encodeURIComponent(query)}&include_closed=false&page=0`
  })
  return tasks || []
}

export async function getMyTasks(teamId, userId) {
  try {
    const { tasks } = await api().request({
      path: `/team/${teamId}/task?assignees[]=${userId}&statuses[]=in%20progress&include_closed=false&order_by=updated&page=0`
    })
    return tasks || []
  } catch {
    return []
  }
}

export async function updateTimeEntry(teamId, entryId, body) {
  return api().request({
    method: 'PUT',
    path: `/team/${teamId}/time_entries/${entryId}`,
    body
  })
}
