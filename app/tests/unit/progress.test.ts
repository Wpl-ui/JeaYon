/**
 * 状态 ↔ 进度推导单测。
 *
 * 这份规则同时存在于三处（DB CHECK、RPC、前端），任何一处偏差都会造成
 * "界面显示 100% 但库里是进行中"这类脏数据，所以这里逐条钉住边界。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  averageProgress,
  normalizeProgress,
  progressForStatus,
  statusForProgress,
  statusLabel,
  withProgress,
  withStatus,
} from '../../src/lib/progress'

test('normalizeProgress 夹到 0–100 并取整', () => {
  assert.equal(normalizeProgress(-5), 0)
  assert.equal(normalizeProgress(0), 0)
  assert.equal(normalizeProgress(42.4), 42)
  assert.equal(normalizeProgress(42.5), 43)
  assert.equal(normalizeProgress(100), 100)
  assert.equal(normalizeProgress(180), 100)
  assert.equal(normalizeProgress(Number.NaN), 0)
  assert.equal(normalizeProgress(Number.POSITIVE_INFINITY), 0)
})

test('statusForProgress：0 未开始，1–99 进行中，100 已完成', () => {
  assert.equal(statusForProgress(0), 'todo')
  assert.equal(statusForProgress(1), 'in_progress')
  assert.equal(statusForProgress(99), 'in_progress')
  assert.equal(statusForProgress(100), 'done')
  assert.equal(statusForProgress(-3), 'todo')
  assert.equal(statusForProgress(140), 'done')
})

test('progressForStatus：todo/done 强制 0/100，in_progress 保留 1–99', () => {
  assert.equal(progressForStatus('todo', 55), 0)
  assert.equal(progressForStatus('done', 55), 100)
  assert.equal(progressForStatus('in_progress', 55), 55)
  assert.equal(progressForStatus('in_progress', 0), 1, '0% 的进行中不自洽，置 1')
  assert.equal(progressForStatus('in_progress', 100), 1, '100% 的进行中不自洽，置 1')
  assert.equal(progressForStatus('in_progress', 99), 99)
})

test('withStatus 与 withProgress 保持状态与进度一致', () => {
  assert.deepEqual(withStatus({ status: 'todo', progress: 0 }, 'in_progress'), {
    status: 'in_progress',
    progress: 1,
  })
  assert.deepEqual(withStatus({ status: 'in_progress', progress: 37 }, 'done'), {
    status: 'done',
    progress: 100,
  })
  assert.deepEqual(withStatus({ status: 'done', progress: 100 }, 'todo'), {
    status: 'todo',
    progress: 0,
  })
  assert.deepEqual(withProgress({ status: 'todo', progress: 0 }, 0), { status: 'todo', progress: 0 })
  assert.deepEqual(withProgress({ status: 'todo', progress: 0 }, 1), {
    status: 'in_progress',
    progress: 1,
  })
  assert.deepEqual(withProgress({ status: 'in_progress', progress: 60 }, 100), {
    status: 'done',
    progress: 100,
  })
})

test('averageProgress：等权平均、保留一位小数、无任务返回 null', () => {
  assert.equal(averageProgress([]), null, '没有任务时显示"暂无数据"，不是 0%')
  assert.equal(averageProgress([{ progress: 0, archived_at: null }]), 0)
  assert.equal(
    averageProgress([
      { progress: 0, archived_at: null },
      { progress: 33, archived_at: null },
      { progress: 100, archived_at: null },
    ]),
    44.3,
  )
  assert.equal(
    averageProgress([
      { progress: 50, archived_at: null },
      { progress: 100, archived_at: '2026-10-01T00:00:00Z' },
    ]),
    50,
    '已归档任务不参与统计',
  )
})

test('statusLabel 使用固定中文文案', () => {
  assert.equal(statusLabel('todo'), '未开始')
  assert.equal(statusLabel('in_progress'), '进行中')
  assert.equal(statusLabel('done'), '已完成')
})
