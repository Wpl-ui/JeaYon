import type { TaskRow } from '../types/db'
import type { TaskDraft } from '../tasks/api'
import { AppError } from '../lib/errors'
import { tasks, logs } from './fixtures'
export { validateDraft, sanitizeTitle } from '../tasks/api'
export type { TaskDraft } from '../tasks/api'

// The only mutable data is in this isolated, explicitly requested screenshot mock.
let rows = tasks.map((row) => ({ ...row }))
export async function fetchTasks() { return rows.filter((row) => row.archived_at === null) }
export async function fetchArchivedTasks() { return rows.filter((row) => row.archived_at !== null) }
export async function fetchTask(id: number) { return rows.find((row) => row.id === id) ?? null }
export async function fetchTaskLogs(_teamId: number, taskId: number) { return logs.filter((log) => log.related_task_id === taskId) }
function fields(draft: TaskDraft) {
  return { title: draft.title, description: draft.description, assignee_id: draft.assigneeId, status: draft.status, progress: draft.progress, start_date: draft.startDate, due_date: draft.dueDate }
}
export async function createTask(teamId: number, draft: TaskDraft): Promise<TaskRow> {
  const row = { ...tasks[0], ...fields(draft), id: Math.max(...rows.map((item) => item.id)) + 1, team_id: teamId, version: 1 }
  rows = [...rows, row]
  return row
}
export async function updateTask(id: number, expectedVersion: number, draft: TaskDraft): Promise<TaskRow> {
  const current = rows.find((row) => row.id === id)
  if (!current) throw new AppError('示例任务不存在', 'not_found')
  if (current.version !== expectedVersion) throw new AppError('示例任务已修改，请刷新', 'conflict')
  const saved = { ...current, ...fields(draft), version: current.version + 1 }
  rows = rows.map((row) => row.id === id ? saved : row)
  return saved
}
export async function setTaskArchived(id: number, expectedVersion: number, archived: boolean): Promise<TaskRow> {
  const current = rows.find((row) => row.id === id)
  if (!current) throw new AppError('示例任务不存在', 'not_found')
  if (current.version !== expectedVersion) throw new AppError('示例任务已修改，请刷新', 'conflict')
  const saved = { ...current, archived_at: archived ? new Date().toISOString() : null, version: current.version + 1 }
  rows = rows.map((row) => row.id === id ? saved : row)
  return saved
}
