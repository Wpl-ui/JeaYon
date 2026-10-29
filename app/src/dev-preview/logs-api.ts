import type { WorkLogDraft } from '../logs/api'
import { AppError } from '../lib/errors'
import { logs, members } from './fixtures'
export { validateDraft, validateHours, parseHours } from '../logs/api'
export type { WorkLogDraft } from '../logs/api'

let rows = logs.map((row) => ({ ...row }))
export async function fetchWorkLogs() { return rows }
export async function fetchMyLogOnDate(_teamId: number, ownerId: string, date: string) { return rows.find((row) => row.owner_id === ownerId && row.work_date === date) ?? null }
function fields(draft: WorkLogDraft) {
  return { work_date: draft.workDate, done_today: draft.doneToday, problems: draft.problems || null, plan_tomorrow: draft.planTomorrow, hours: draft.hours === '' ? null : Number(draft.hours), related_task_id: draft.relatedTaskId }
}
export async function createWorkLog(teamId: number, ownerName: string, draft: WorkLogDraft) {
  if (rows.some((row) => row.owner_id === members[0].user_id && row.work_date === draft.workDate)) throw new AppError('当天已有示例日报', 'already_exists')
  const row = { ...logs[0], ...fields(draft), id: Math.max(...rows.map((item) => item.id)) + 1, team_id: teamId, owner_name: ownerName, version: 1 }
  rows = [row, ...rows]
  return row
}
export async function updateWorkLog(id: number, expectedVersion: number, draft: WorkLogDraft) {
  const current = rows.find((row) => row.id === id)
  if (!current) throw new AppError('示例日报不存在', 'not_found')
  if (current.version !== expectedVersion) throw new AppError('示例日报已修改，请刷新', 'conflict')
  const saved = { ...current, ...fields(draft), version: current.version + 1 }
  rows = rows.map((row) => row.id === id ? saved : row)
  return saved
}
export async function deleteWorkLog(id: number, expectedVersion: number) {
  const current = rows.find((row) => row.id === id)
  if (current?.version !== expectedVersion) throw new AppError('示例日报已修改，请刷新', 'conflict')
  rows = rows.filter((row) => row.id !== id)
}
