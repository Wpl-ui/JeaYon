/**
 * 仪表盘统计（纯函数，全部按团队时区的自然日计算）。
 *
 * 口径（与需求逐条对应）：
 *  - 只统计当前团队**未归档**任务；
 *  - 逾期：`status !== 'done'` 且 `due_date < 今天`（截止当天不算逾期）；
 *  - 近期：`due_date ∈ [今天, 今天 + 6]` 且未完成（闭区间，共 7 天）；
 *  - 平均进度：等权算术平均，无任务返回 null（显示"暂无数据"）；
 *  - 最新日报：`work_date` 最大者，同日取 `updated_at` 最晚。
 */
import { addDays, compareISO, type ISODate } from './dates'
import { averageProgress } from './progress'
import type { TaskRow, TaskStatus, WorkLogRow } from '../types/db'

export interface DashboardStats {
  total: number
  inProgress: number
  done: number
  overdue: number
  avgProgress: number | null
  statusCounts: Record<TaskStatus, number>
  /** 近 7 个自然日内到期且未完成的任务，按截止日升序 */
  dueSoon: TaskRow[]
  /** 最新的团队日报 */
  latestLog: WorkLogRow | null
}

export const DUE_SOON_DAYS = 7

export function isOverdue(task: Pick<TaskRow, 'status' | 'due_date' | 'archived_at'>, today: ISODate): boolean {
  if (task.archived_at !== null) return false
  if (task.status === 'done') return false
  return compareISO(task.due_date, today) < 0
}

export function isDueSoon(
  task: Pick<TaskRow, 'status' | 'due_date' | 'archived_at'>,
  today: ISODate,
): boolean {
  if (task.archived_at !== null) return false
  if (task.status === 'done') return false
  const last = addDays(today, DUE_SOON_DAYS - 1)
  return compareISO(task.due_date, today) >= 0 && compareISO(task.due_date, last) <= 0
}

export function computeDashboard(
  tasks: readonly TaskRow[],
  logs: readonly WorkLogRow[],
  today: ISODate,
): DashboardStats {
  const active = tasks.filter((t) => t.archived_at === null)

  const statusCounts: Record<TaskStatus, number> = { todo: 0, in_progress: 0, done: 0 }
  let overdue = 0
  for (const task of active) {
    statusCounts[task.status] += 1
    if (isOverdue(task, today)) overdue += 1
  }

  const dueSoon = active.filter((t) => isDueSoon(t, today)).sort((a, b) => compareISO(a.due_date, b.due_date))

  const latestLog = pickLatestLog(logs)

  return {
    total: active.length,
    inProgress: statusCounts.in_progress,
    done: statusCounts.done,
    overdue,
    avgProgress: averageProgress(active),
    statusCounts,
    dueSoon,
    latestLog,
  }
}

/** 最新团队日报：工作日期最大优先，同日取更新时间最晚。 */
export function pickLatestLog(logs: readonly WorkLogRow[]): WorkLogRow | null {
  let best: WorkLogRow | null = null
  for (const log of logs) {
    if (!best) {
      best = log
      continue
    }
    const byDate = compareISO(log.work_date, best.work_date)
    if (byDate > 0) {
      best = log
    } else if (byDate === 0 && String(log.updated_at) > String(best.updated_at)) {
      best = log
    }
  }
  return best
}

/** 团队日报按工作日期分组（团队视图用）。 */
export function groupLogsByDate(logs: readonly WorkLogRow[]): { date: ISODate; logs: WorkLogRow[] }[] {
  const map = new Map<ISODate, WorkLogRow[]>()
  for (const log of logs) {
    const list = map.get(log.work_date)
    if (list) list.push(log)
    else map.set(log.work_date, [log])
  }
  return [...map.entries()]
    .sort((a, b) => compareISO(b[0], a[0]))
    .map(([date, list]) => ({
      date,
      logs: list.slice().sort((a, b) => a.owner_name.localeCompare(b.owner_name, 'zh-CN')),
    }))
}
