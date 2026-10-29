const key = 'jeayon.tasks.collapsed'
export type CollapsedTasks = Record<string, true>

export function collapseKey(teamId: number, parentId: number): string {
  return `${teamId}:${parentId}`
}

export function readCollapsed(storage: Pick<Storage, 'getItem'>): CollapsedTasks {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([id, collapsed]) => /^\d+:\d+$/.test(id) && collapsed === true))
  } catch { return {} }
}

export function writeCollapsed(storage: Pick<Storage, 'setItem'>, value: CollapsedTasks): void {
  try { storage.setItem(key, JSON.stringify(value)) } catch { /* Storage may be disabled; in-page state still works. */ }
}
