// Goal config: the user sets weekly hours (contracts are weekly — "38h"),
// and the per-day target is derived from their working days, so a 38h
// Mon–Fri week targets 7.6h/day and a 4-day week targets 9.5h/day.
const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5] // getDay() numbers, Mon–Fri

export async function getGoals() {
  const [weekly, legacyDaily, workdaysRaw] = await Promise.all([
    window.api.store.get('weekly_goal_hours'),
    window.api.store.get('daily_goal_hours'), // pre-weekly builds
    window.api.store.get('workdays'),
  ])
  const workdays =
    Array.isArray(workdaysRaw) && workdaysRaw.length ? workdaysRaw : DEFAULT_WORKDAYS
  const weeklyH = weekly || (legacyDaily ? legacyDaily * workdays.length : 0)
  const dailyH = weeklyH ? weeklyH / workdays.length : 0
  return {
    workdays,
    weeklyH,
    dailyH,
    weeklyMs: weeklyH * 3600000,
    dailyMs: dailyH * 3600000,
  }
}
