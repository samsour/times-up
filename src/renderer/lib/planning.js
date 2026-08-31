// Float-style capacity planning, stored in ClickUp itself: one dedicated
// "Planning" list holds machine-readable tasks (allocations, budgets, team
// capacity), so every admin's app shares the same data without a backend.
// Allocation tasks carry real assignees, dates and time estimates, which
// keeps ClickUp's own Workload view accurate as a side effect.
import { getTasks, createTask, updateTask, deleteTask } from "./clickup.js";
import { countWorkdays } from "./time.js";

export { countWorkdays };

const MARK = "[timesup-plan:v1]";

function encode(data) {
  return `${MARK}\n${JSON.stringify(data)}\nManaged by times-up — do not edit.`;
}

function decode(text) {
  if (!text || !text.includes(MARK)) return null;
  try {
    const line = text
      .split("\n")
      .find((l) => l.trim().startsWith("{"));
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
}

// Reads the whole plan out of the planning list in one request.
// allocations: [{ id, userId, listId, hoursPerDay, start, end }]
// budgets: { [listId]: { taskId, hours } }
// capacity: { [userId]: hoursPerDay }, capacityTaskId for updates
export async function fetchPlan(planListId) {
  const tasks = (await getTasks(planListId)) || [];
  const allocations = [];
  const budgets = {};
  let capacity = {};
  let capacityTaskId = null;
  for (const t of tasks) {
    const data = decode(t.description) || decode(t.text_content);
    if (!data) continue;
    if (data.type === "allocation") {
      const start = parseInt(t.start_date || data.start);
      const end = parseInt(t.due_date || data.end);
      if (!start || !end) continue;
      allocations.push({
        id: t.id,
        userId: t.assignees?.[0]?.id ?? data.user,
        listId: String(data.list),
        hoursPerDay: data.hpd || 0,
        start,
        end,
      });
    } else if (data.type === "budget") {
      budgets[String(data.list)] = { taskId: t.id, hours: data.hours || 0 };
    } else if (data.type === "capacity") {
      capacity = data.hpd || {};
      capacityTaskId = t.id;
    }
  }
  return { allocations, budgets, capacity, capacityTaskId };
}

export async function createAllocation(
  planListId,
  { userId, userName, listId, listName, start, end, hoursPerDay }
) {
  const days = countWorkdays(start, end);
  return createTask(planListId, `${userName} · ${listName}`, {
    assignees: [userId],
    start_date: start,
    start_date_time: false,
    due_date: end,
    due_date_time: false,
    time_estimate: Math.round(days * hoursPerDay * 3600000),
    description: encode({
      type: "allocation",
      user: userId,
      list: listId,
      hpd: hoursPerDay,
      start,
      end,
    }),
  });
}

export async function deleteAllocation(taskId) {
  return deleteTask(taskId);
}

export async function saveBudget(planListId, existingTaskId, listId, listName, hours) {
  const description = encode({ type: "budget", list: listId, hours });
  if (existingTaskId) return updateTask(existingTaskId, { description });
  return createTask(planListId, `Budget · ${listName}`, { description });
}

export async function saveCapacity(planListId, existingTaskId, hpdByUser) {
  const description = encode({ type: "capacity", hpd: hpdByUser });
  if (existingTaskId) return updateTask(existingTaskId, { description });
  return createTask(planListId, "Capacity · hours per day", { description });
}

