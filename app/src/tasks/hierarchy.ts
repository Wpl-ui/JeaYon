/**
 * One-level parent → children ordering for list/gantt.
 *
 * Contract (mirrors server/src/tasks/hierarchy-contract.ts):
 * - PARENT progress = round(done_count / active_children * 100); status from that.
 * - CHILD is binary done/todo; completion via PATCH /complete.
 * - LEAF keeps full status/progress.
 */
import type { TaskRow } from '../types/db'

export function childTasks(tasks: readonly TaskRow[], parentId: number): TaskRow[] {
  return tasks.filter((t) => t.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
}

export function hasActiveChildren(tasks: readonly TaskRow[], parentId: number): boolean {
  return tasks.some((t) => t.parent_id === parentId && t.archived_at === null)
}

/** Keep root query order; siblings always follow their persisted order. */
export function flattenTaskTree(tasks: readonly TaskRow[]): TaskRow[] {
  const roots = tasks.filter((t) => t.parent_id == null)
  const out: TaskRow[] = []
  for (const root of roots) {
    out.push(root)
    out.push(...childTasks(tasks, root.id))
  }
  const seen = new Set(out.map((t) => t.id))
  for (const t of tasks) {
    if (!seen.has(t.id)) out.push(t)
  }
  return out
}

/** Move within the complete active sibling set, including siblings hidden by filters. */
export function moveChild(tasks: readonly TaskRow[], sourceId: number, targetId: number): TaskRow[] | null {
  const source = tasks.find(task => task.id === sourceId)
  const target = tasks.find(task => task.id === targetId)
  if (!source || !target || sourceId === targetId || source.parent_id == null ||
    source.parent_id !== target.parent_id || source.archived_at || target.archived_at) return null
  const siblings = childTasks(tasks, source.parent_id).filter(task => task.archived_at === null)
  const from = siblings.findIndex(task => task.id === sourceId)
  const to = siblings.findIndex(task => task.id === targetId)
  siblings.splice(from, 1)
  siblings.splice(to, 0, source)
  return siblings.map((task, sort_order) => ({ ...task, sort_order }))
}
