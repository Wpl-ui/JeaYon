import assert from 'node:assert/strict'
import test from 'node:test'
import { childTasks, flattenTaskTree, moveChild } from '../../src/tasks/hierarchy'
import { collapseKey, readCollapsed, writeCollapsed } from '../../src/tasks/collapse'
import type { TaskRow } from '../../src/types/db'

function row(id: number, parent_id: number | null, sort_order = 0, archived_at: string | null = null): TaskRow {
  return { id, team_id: 1, parent_id, sort_order, archived_at, created_by: 'u', assignee_id: null,
    title: 'Task', description: null, status: 'todo', progress: 0, version: 1,
    start_date: '2026-10-26', due_date: '2026-10-27', created_at: '', updated_at: '' }
}

test('tree keeps roots in query order and children in sort_order/id order', () => {
  const rows = [row(8, null), row(1, null), row(3, 1, 1), row(2, 1, 1), row(9, 8, 0), row(4, 1, 0)]
  assert.deepEqual(childTasks(rows, 1).map(t => t.id), [4, 2, 3])
  assert.deepEqual(flattenTaskTree(rows).map(t => t.id), [8, 9, 1, 4, 2, 3])
})

test('move uses all active siblings, keeps metadata and refuses cross-parent/root/archive/no-op drops', () => {
  const rows = [row(1, null), row(2, 1, 0), row(3, 1, 1), row(4, 1, 2), row(5, 7), row(6, 1, 3, 'archived')]
  const moved = moveChild(rows, 2, 4)!
  assert.deepEqual(moved.map(t => [t.id, t.sort_order, t.version]), [[3, 0, 1], [4, 1, 1], [2, 2, 1]])
  assert.deepEqual(rows.map(t => t.id), [1, 2, 3, 4, 5, 6])
  for (const [source, target] of [[1, 2], [2, 5], [2, 6], [2, 2], [99, 2]]) assert.equal(moveChild(rows, source!, target!), null)
})

test('collapse defaults open, persists per team/parent and tolerates unavailable or corrupt session storage', () => {
  assert.deepEqual(readCollapsed({ getItem: () => null }), {})
  assert.deepEqual(readCollapsed({ getItem: () => '{broken' }), {})
  assert.deepEqual(readCollapsed({ getItem: () => '[true]' }), {})
  assert.deepEqual(readCollapsed({ getItem: () => '{"1:2":true,"2:2":false,"bad":true}' }), { '1:2': true })
  assert.notEqual(collapseKey(1, 2), collapseKey(2, 2))
  let saved = ''
  writeCollapsed({ setItem: (_key, value) => { saved = value } }, { '1:2': true })
  assert.deepEqual(readCollapsed({ getItem: () => saved }), { '1:2': true })
  assert.doesNotThrow(() => writeCollapsed({ setItem: () => { throw new Error('blocked') } }, {}))
  assert.deepEqual(readCollapsed({ getItem: () => { throw new Error('blocked') } }), {})
})
