/**
 * 任务数据访问 —— 全部走自建 /api/teams/:id/tasks 与 /api/tasks/*。
 */
import { apiFetch } from '../lib/apiClient'
import { AppError } from '../lib/errors'
import { normalizeProgress, progressForStatus } from '../lib/progress'
import { isValidISODate } from '../lib/dates'
import type { TaskRow, TaskStatus } from '../types/db'

export interface TaskDraft {
  title: string
  description: string
  assigneeId: string | null
  status: TaskStatus
  progress: number
  startDate: string
  dueDate: string
  /** Set when creating a subtask under a parent. */
  parentId?: number | null
}

/** 标题归一：去首尾空白、压缩内部连续空白。 */
export function sanitizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** 客户端侧预校验。 */
export function validateDraft(draft: TaskDraft): string | null {
  const title = sanitizeTitle(draft.title)
  if (title.length < 1 || title.length > 120) return '任务标题需为 1-120 个字符'
  if (draft.description.trim().length > 2000) return '描述不能超过 2000 个字符'
  if (!isValidISODate(draft.startDate)) return '请填写开始日期'
  if (!isValidISODate(draft.dueDate)) return '请填写截止日期'
  if (draft.dueDate < draft.startDate) return '截止日期不能早于开始日期'
  return null
}

function draftBody(draft: TaskDraft) {
  const description = draft.description.trim()
  // Children are binary: done=100 / else todo=0 (server also coerces).
  const isChild = draft.parentId != null
  const status = isChild ? (draft.status === 'done' ? 'done' : 'todo') : draft.status
  const progress = isChild
    ? (status === 'done' ? 100 : 0)
    : progressForStatus(draft.status, normalizeProgress(draft.progress))
  const body: Record<string, unknown> = {
    title: sanitizeTitle(draft.title),
    description: description.length > 0 ? description : null,
    assignee_id: draft.assigneeId,
    status,
    progress,
    start_date: draft.startDate,
    due_date: draft.dueDate,
  }
  if (draft.parentId != null) body.parent_id = draft.parentId
  return body
}

/** 当前团队未归档任务（甘特图与列表共用）。 */
export async function fetchTasks(teamId: number): Promise<TaskRow[]> {
  return apiFetch<TaskRow[]>(`/api/teams/${teamId}/tasks?scope=active`)
}

/** 当前团队已归档任务。 */
export async function fetchArchivedTasks(teamId: number): Promise<TaskRow[]> {
  return apiFetch<TaskRow[]>(`/api/teams/${teamId}/tasks?scope=archived`)
}

/** 新建任务。 */
export async function createTask(teamId: number, draft: TaskDraft): Promise<TaskRow> {
  const error = validateDraft(draft)
  if (error) throw new AppError(error, 'invalid')
  return apiFetch<TaskRow>(`/api/teams/${teamId}/tasks`, {
    method: 'POST',
    json: draftBody(draft),
  })
}

/**
 * 编辑任务。expectedVersion 不一致时服务端返回 conflict。
 */
export async function updateTask(
  taskId: number,
  expectedVersion: number,
  draft: TaskDraft,
): Promise<TaskRow> {
  const error = validateDraft(draft)
  if (error) throw new AppError(error, 'invalid')
  return apiFetch<TaskRow>(`/api/tasks/${taskId}`, {
    method: 'PUT',
    json: { ...draftBody(draft), expected_version: expectedVersion },
  })
}

/** 子任务完成开关（父任务禁止；叶子也可用来快速标完成）。 */
export async function setTaskComplete(
  taskId: number,
  expectedVersion: number,
  done: boolean,
): Promise<TaskRow> {
  return apiFetch<TaskRow>(`/api/tasks/${taskId}/complete`, {
    method: 'PATCH',
    json: { done, expected_version: expectedVersion },
  })
}

/** Save the complete active sibling set; stale versions/membership are rejected. */
export async function reorderChildren(parentId: number, children: readonly TaskRow[]): Promise<TaskRow[]> {
  return apiFetch<TaskRow[]>(`/api/tasks/${parentId}/children/reorder`, {
    method: 'PATCH',
    json: { children: children.map(child => ({ id: child.id, expected_version: child.version })) },
  })
}

/** 归档 / 取消归档。 */
export async function setTaskArchived(
  taskId: number,
  expectedVersion: number,
  archived: boolean,
): Promise<TaskRow> {
  return apiFetch<TaskRow>(`/api/tasks/${taskId}/archive`, {
    method: 'PATCH',
    json: { archived, expected_version: expectedVersion },
  })
}

/** 单任务读取。 */
export async function fetchTask(taskId: number): Promise<TaskRow | null> {
  return apiFetch<TaskRow | null>(`/api/tasks/${taskId}`)
}

/** 某任务的关联日报。 */
export async function fetchTaskLogs(teamId: number, taskId: number) {
  return apiFetch<
    {
      id: number
      owner_id: string
      owner_name: string
      work_date: string
      done_today: string
      version: number
    }[]
  >(`/api/teams/${teamId}/tasks/${taskId}/logs`)
}
