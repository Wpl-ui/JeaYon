/**
 * 仪表盘统计口径单测。
 *
 * 这里钉的是需求里的判定边界：截止当天不算逾期、近 7 天是闭区间、
 * 归档任务不参与统计、最新日报同日按更新时间取。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { DUE_SOON_DAYS, computeDashboard, groupLogsByDate, isDueSoon, isOverdue } from '../../src/lib/stats'
import type { TaskRow, TaskStatus, WorkLogRow } from '../../src/types/db'

const TODAY = '2026-10-26'

let seq = 0

function task(over: Partial<TaskRow> & { status?: TaskStatus } = {}): TaskRow {
  seq += 1
  return {
    id: seq,
    team_id: 1,
    parent_id: null,
    sort_order: 0,
    created_by: 'u_owner',
    assignee_id: 'u_owner',
    title: `任务 ${seq}`,
    description: null,
    status: 'todo',
    progress: 0,
    start_date: '2026-10-20',
    due_date: '2026-10-30',
    archived_at: null,
    version: 1,
    created_at: '2026-10-20T01:00:00Z',
    updated_at: '2026-10-20T01:00:00Z',
    ...over,
  }
}

function log(over: Partial<WorkLogRow> = {}): WorkLogRow {
  seq += 1
  return {
    id: seq,
    team_id: 1,
    owner_id: 'u_owner',
    owner_name: '张三',
    work_date: TODAY,
    done_today: '完成了一些事',
    problems: null,
    plan_tomorrow: '继续',
    hours: null,
    related_task_id: null,
    version: 1,
    created_at: '2026-10-26T09:00:00Z',
    updated_at: '2026-10-26T09:00:00Z',
    ...over,
  }
}

test('isOverdue：截止当天不算逾期，已完成与已归档都不算', () => {
  assert.equal(isOverdue(task({ due_date: TODAY, status: 'todo' }), TODAY), false, '今天截止不算逾期')
  assert.equal(isOverdue(task({ due_date: '2026-10-25', status: 'in_progress' }), TODAY), true)
  assert.equal(isOverdue(task({ due_date: '2026-10-25', status: 'done' }), TODAY), false)
  assert.equal(
    isOverdue(task({ due_date: '2026-10-01', archived_at: '2026-10-02T00:00:00Z' }), TODAY),
    false,
    '归档任务退出统计',
  )
})

test('isDueSoon：今天起 7 个自然日闭区间，第 8 天不算', () => {
  assert.equal(DUE_SOON_DAYS, 7)
  assert.equal(isDueSoon(task({ due_date: TODAY }), TODAY), true, '今天到期要算进来')
  assert.equal(isDueSoon(task({ due_date: '2026-11-01' }), TODAY), true, '今天是第 7 天')
  assert.equal(isDueSoon(task({ due_date: '2026-11-02' }), TODAY), false, '第 8 天不算')
  assert.equal(isDueSoon(task({ due_date: '2026-10-25' }), TODAY), false, '已过期的不属于"近期"')
  assert.equal(isDueSoon(task({ due_date: TODAY, status: 'done' }), TODAY), false)
})

test('computeDashboard 汇总口径与归档过滤', () => {
  const tasks = [
    task({ status: 'todo', progress: 0, due_date: '2026-10-20' }),
    task({ status: 'in_progress', progress: 40, due_date: TODAY }),
    task({ status: 'in_progress', progress: 80, due_date: '2026-11-05' }),
    task({ status: 'done', progress: 100, due_date: '2026-10-01' }),
    task({ status: 'todo', progress: 0, archived_at: '2026-10-10T00:00:00Z' }),
  ]

  const stats = computeDashboard(tasks, [], TODAY)

  assert.equal(stats.total, 4, '归档任务不计入总数')
  assert.equal(stats.inProgress, 2)
  assert.equal(stats.done, 1)
  assert.equal(stats.overdue, 1, '只有 10-20 那条未完成且早于今天')
  assert.deepEqual(stats.statusCounts, { todo: 1, in_progress: 2, done: 1 })
  assert.equal(stats.avgProgress, 55, '(0 + 40 + 80 + 100) / 4')
  assert.deepEqual(
    stats.dueSoon.map((t) => t.due_date),
    [TODAY],
    '近 7 天到期且未完成，按截止日升序',
  )
  assert.equal(stats.latestLog, null)
})

test('computeDashboard：无任务时平均进度为 null', () => {
  const stats = computeDashboard([], [], TODAY)
  assert.equal(stats.total, 0)
  assert.equal(stats.avgProgress, null)
  assert.deepEqual(stats.dueSoon, [])
})

test('latestLog 取工作日期最大者，同日取更新时间最晚', () => {
  const older = log({ work_date: '2026-10-24', owner_name: '李四' })
  const sameDayOld = log({ work_date: TODAY, updated_at: '2026-10-26T08:00:00Z', owner_name: '王五' })
  const sameDayNew = log({ work_date: TODAY, updated_at: '2026-10-26T11:00:00Z', owner_name: '张三' })

  const stats = computeDashboard([], [older, sameDayOld, sameDayNew], TODAY)
  assert.equal(stats.latestLog?.owner_name, '张三')
})

test('groupLogsByDate 按日期倒序、同日按姓名中文排序', () => {
  const groups = groupLogsByDate([
    log({ work_date: '2026-10-24', owner_name: '李四' }),
    log({ work_date: TODAY, owner_name: '张三' }),
    log({ work_date: TODAY, owner_name: '王五' }),
  ])

  assert.equal(groups.length, 2)
  assert.equal(groups[0]?.date, TODAY)
  assert.deepEqual(
    groups[0]?.logs.map((l) => l.owner_name),
    ['王五', '张三'],
  )
  assert.equal(groups[1]?.date, '2026-10-24')
})
