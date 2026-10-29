/**
 * 任务状态 ↔ 进度百分比的双向推导。
 *
 * 规则（与数据库 CHECK 约束一致，服务端 RPC 会再强制一次）：
 *  - `todo` = 0%；`in_progress` = 1–99%；`done` = 100%；
 *  - 改进度 → 由进度推导状态：0 是 todo、100 是 done、其余是 in_progress；
 *  - 改状态 → 由状态设进度：todo 置 0、done 置 100；
 *  - 改成 in_progress 时保留 1–99，原来的 0 或 100 一律置 1
 *    （否则会出现"进行中但 0%"这种自相矛盾的状态）。
 */
import type { TaskStatus } from '../types/db'

export function normalizeProgress(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  return Math.min(100, Math.max(0, Math.round(raw)))
}

/** 由进度推导状态。 */
export function statusForProgress(progress: number): TaskStatus {
  const value = normalizeProgress(progress)
  if (value <= 0) return 'todo'
  if (value >= 100) return 'done'
  return 'in_progress'
}

/** 由状态推导进度（`current` 是当前进度，用于 in_progress 的保留逻辑）。 */
export function progressForStatus(status: TaskStatus, current: number): number {
  if (status === 'todo') return 0
  if (status === 'done') return 100
  const value = normalizeProgress(current)
  return value >= 100 || value <= 0 ? 1 : value
}

export interface TaskProgressState {
  status: TaskStatus
  progress: number
}

/** 用户切换状态：进度按状态强制推导。 */
export function withStatus(state: TaskProgressState, status: TaskStatus): TaskProgressState {
  return { status, progress: progressForStatus(status, state.progress) }
}

/** 用户拖动进度：状态由进度推导。 */
/**
 * 用户拖动进度：状态由进度推导。
 *
 * 第一个参数保留但不再使用（与 `withStatus` 的调用形态对称，调用方可直接写
 * `withProgress(draft, value)`），因此显式加下划线前缀。
 */
export function withProgress(_state: TaskProgressState, progress: number): TaskProgressState {
  const value = normalizeProgress(progress)
  return { status: statusForProgress(value), progress: value }
}

/** 任务是否已完成（归档与状态无关，已完成看 status）。 */
export function isTaskDone(status: TaskStatus): boolean {
  return status === 'done'
}

/**
 * 平均进度：等权算术平均，保留一位小数。
 * 没有任何任务时返回 `null`（界面显示"暂无数据"，而不是 0%）。
 */
export function averageProgress(tasks: readonly { progress: number; archived_at: string | null }[]): number | null {
  const active = tasks.filter((t) => t.archived_at === null)
  if (active.length === 0) return null
  const sum = active.reduce((acc, t) => acc + normalizeProgress(t.progress), 0)
  return Math.round((sum / active.length) * 10) / 10
}

/** 状态中文名。 */
export function statusLabel(status: TaskStatus): string {
  if (status === 'todo') return '未开始'
  if (status === 'in_progress') return '进行中'
  return '已完成'
}
