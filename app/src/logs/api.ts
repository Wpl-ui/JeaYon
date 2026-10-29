/**
 * 标准日报数据访问 —— 全部走自建 /api/teams/:id/work-logs 与 /api/work-logs/*。
 */
import { apiFetch } from '../lib/apiClient'
import { AppError } from '../lib/errors'
import { isValidISODate } from '../lib/dates'
import type { WorkLogRow } from '../types/db'

export interface WorkLogDraft {
  workDate: string
  doneToday: string
  problems: string
  planTomorrow: string
  /** 空字符串表示未填工时 */
  hours: string
  relatedTaskId: number | null
}

/** 工时文案 → 数值（未填返回 null）。 */
export function parseHours(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  return Number(text)
}

/** 工时校验：空、或 0–24 且最多两位小数。 */
export function validateHours(raw: string): string | null {
  const text = raw.trim()
  if (text === '') return null
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return '工时需为 0-24 的数字，最多两位小数'
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0 || value > 24) return '工时需在 0-24 之间'
  return null
}

/** 客户端预校验。 */
export function validateDraft(draft: WorkLogDraft): string | null {
  if (!isValidISODate(draft.workDate)) return '请选择工作日期'
  const done = draft.doneToday.trim()
  const plan = draft.planTomorrow.trim()
  if (done.length < 1) return '请填写今日完成'
  if (done.length > 2000) return '今日完成不能超过 2000 个字符'
  if (draft.problems.trim().length > 2000) return '遇到问题不能超过 2000 个字符'
  if (plan.length < 1) return '请填写明日计划'
  if (plan.length > 2000) return '明日计划不能超过 2000 个字符'
  return validateHours(draft.hours)
}

function logFields(draft: WorkLogDraft) {
  const problems = draft.problems.trim()
  return {
    work_date: draft.workDate,
    done_today: draft.doneToday.trim(),
    problems: problems.length > 0 ? problems : null,
    plan_tomorrow: draft.planTomorrow.trim(),
    hours: draft.hours.trim() === '' ? null : draft.hours.trim(),
    related_task_id: draft.relatedTaskId,
  }
}

function normalizeLog(row: WorkLogRow): WorkLogRow {
  return { ...row, hours: row.hours == null ? null : Number(row.hours) }
}

/** 团队日报（默认最近 300 条）。 */
export async function fetchWorkLogs(teamId: number): Promise<WorkLogRow[]> {
  const rows = await apiFetch<WorkLogRow[]>(`/api/teams/${teamId}/work-logs?limit=300`)
  return rows.map(normalizeLog)
}

/** 某一天我自己的日报。 */
export async function fetchMyLogOnDate(
  teamId: number,
  _ownerId: string,
  workDate: string,
): Promise<WorkLogRow | null> {
  const row = await apiFetch<WorkLogRow | null>(
    `/api/teams/${teamId}/work-logs?owner_id=me&work_date=${encodeURIComponent(workDate)}`,
  )
  return row ? normalizeLog(row) : null
}

/** 新建日报。日期重复时给出明确提示。 */
export async function createWorkLog(
  teamId: number,
  ownerName: string,
  draft: WorkLogDraft,
): Promise<WorkLogRow> {
  const error = validateDraft(draft)
  if (error) throw new AppError(error, 'invalid')

  try {
    const row = await apiFetch<WorkLogRow>(`/api/teams/${teamId}/work-logs`, {
      method: 'POST',
      json: { owner_name: ownerName, ...logFields(draft) },
    })
    return normalizeLog(row)
  } catch (err) {
    if (err instanceof AppError && (err.code === 'already_exists' || err.code === '23505')) {
      throw new AppError('该日期已有日报，请直接编辑那一篇', 'already_exists')
    }
    throw err
  }
}

/** 编辑日报（仅作者本人）。 */
export async function updateWorkLog(
  logId: number,
  expectedVersion: number,
  draft: WorkLogDraft,
): Promise<WorkLogRow> {
  const error = validateDraft(draft)
  if (error) throw new AppError(error, 'invalid')

  const row = await apiFetch<WorkLogRow>(`/api/work-logs/${logId}`, {
    method: 'PUT',
    json: { ...logFields(draft), expected_version: expectedVersion },
  })
  return normalizeLog(row)
}

/** 删除日报（仅作者本人）。 */
export async function deleteWorkLog(logId: number, expectedVersion: number): Promise<void> {
  await apiFetch(`/api/work-logs/${logId}`, {
    method: 'DELETE',
    json: { expected_version: expectedVersion },
  })
}
