/**
 * JeaYon — parent/child task contract (source of truth).
 *
 * Roles
 * -----
 * - LEAF:   parent_id IS NULL and no active (non-archived) children.
 * - PARENT: parent_id IS NULL and active_child_count > 0. Container only.
 * - CHILD:  parent_id IS NOT NULL. One level only (parent must not itself be a CHILD).
 *
 * CHILD state machine
 * -------------------
 * States: todo (progress=0) | done (progress=100). No in_progress.
 * Transition: PATCH /api/tasks/:id/complete { done, expected_version }.
 * PUT /api/tasks/:id on a CHILD may update title/description/assignee/dates only;
 *   status/progress in the body are ignored (DB binary state kept; any legacy
 *   in_progress row is converged to todo/0 on write).
 * CREATE with parent_id: always starts as todo/0 (binaryChild coercion).
 *
 * PARENT state machine
 * --------------------
 * status/progress are DERIVED only from active children:
 *   progress = round(done_count / total * 100)
 *   status   = todo if 0 | done if 100 | else in_progress (progress clamped 1–99)
 * PUT that sends status/progress ≠ derived → 400 invalid (rejected, not silently fixed).
 * PATCH /complete → 400. PATCH archive while active children exist → 400.
 * When the last active child is archived, the row becomes a LEAF again (manual edits resume).
 *
 * LEAF
 * ----
 * Full todo / in_progress / done + progress CHECK rules (unchanged).
 *
 * Boundaries
 * ----------
 * Gantt: may drag start/due for any role; must not invent parent/child status.
 * Work logs: related_task_id may reference PARENT or CHILD (or LEAF).
 * Archive: child archive recomputes parent; parent with active children cannot archive.
 * Ordering: PATCH /api/tasks/:parentId/children/reorder takes the complete active
 * sibling list { children: [{ id, expected_version }] }. Team write lock + one
 * transaction; duplicates/foreign/archived/nested rows rejected; stale versions
 * or missing siblings return 409. Each child's version increments; parent's
 * derived state is unchanged. New children append after max(sort_order).
 * Queries sort siblings by sort_order,id. No reparenting or additional depth.
 */

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type BinaryStatus = 'todo' | 'done';

export function binaryChild(status: string, progress: number): { status: BinaryStatus; progress: number } {
  if (status === 'done' || progress >= 100) return { status: 'done', progress: 100 };
  return { status: 'todo', progress: 0 };
}

export function progressFromChildren(
  children: { status: string; progress: number }[],
): { status: TaskStatus; progress: number } | null {
  if (children.length === 0) return null;
  const done = children.filter((c) => c.status === 'done' || Number(c.progress) >= 100).length;
  const progress = Math.round((done / children.length) * 100);
  if (progress <= 0) return { status: 'todo', progress: 0 };
  if (progress >= 100) return { status: 'done', progress: 100 };
  return { status: 'in_progress', progress: Math.min(99, Math.max(1, progress)) };
}

/** True when a PUT body tries to override a parent's derived status/progress. */
export function parentStatusOverrideAttempt(
  body: { status: string; progress: number },
  derived: { status: string; progress: number },
): boolean {
  return body.status !== derived.status || Number(body.progress) !== Number(derived.progress);
}
