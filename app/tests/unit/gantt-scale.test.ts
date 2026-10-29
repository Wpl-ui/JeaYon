/**
 * 甘特图刻度单测。
 *
 * 这是全应用最容易出现"看起来对、其实差一天"的地方，重点验证：
 *  - 坐标 ↔ 日期是严格互逆的（含小数 dayWidth 的浮点陷阱）；
 *  - 跨月、跨年、闰年不漂移；
 *  - 起止同一天 = 1 天宽；
 *  - 拖动结果的边界（最少一天、开始不越过截止）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { addDays, diffDays } from '../../src/lib/dates'
import {
  applyDragDates,
  barRect,
  buildTicks,
  computeRange,
  createScale,
  dateAtX,
  dateToX,
  daysInMonth,
  snapDays,
  todayLineX,
  weekNumber,
} from '../../src/gantt/gantt-scale'

const TODAY = '2026-10-26'

test('computeRange 覆盖全部任务与今天，并留出两侧余量', () => {
  const range = computeRange(
    'day',
    [
      { start_date: '2026-10-01', due_date: '2026-10-05' },
      { start_date: '2026-10-20', due_date: '2026-11-10' },
    ],
    TODAY,
  )
  assert.equal(range.start, '2026-09-28', '最早开始日往前留 3 天')
  assert.ok(diffDays(range.start, range.end) + 1 >= 30, '日视图至少 30 天')
  assert.ok(range.end >= '2026-11-13', '覆盖最晚截止日 + 3 天')

  const emptyWeek = computeRange('week', [], TODAY)
  assert.equal(emptyWeek.start, '2026-10-19', '周视图对齐到周一并前移一周')
  assert.equal((diffDays(emptyWeek.start, emptyWeek.end) + 1) % 7, 0, '周视图总天数是 7 的倍数')

  const month = computeRange('month', [{ start_date: '2024-01-15', due_date: '2024-03-02' }], TODAY)
  assert.ok(month.start <= '2024-01-01', '月视图从整月开始')
  assert.ok(month.end.endsWith('-31') || month.end.endsWith('-30') || month.end.endsWith('-29'))
})

test('dateToX / dateAtX 严格互逆（含跨月、跨年、闰年）', () => {
  const samples = ['2024-02-28', '2024-02-29', '2024-03-01', '2026-12-31', '2027-01-01', '2027-03-01']

  for (const zoom of ['day', 'week', 'month'] as const) {
    const scale = createScale(zoom, [{ start_date: '2024-01-01', due_date: '2027-12-31' }], TODAY)
    assert.equal(dateToX(scale, scale.origin), 0, `${zoom} 视图第一天在 x=0`)
    for (const date of samples) {
      const x = dateToX(scale, date)
      assert.equal(dateAtX(scale, x), date, `${zoom} 视图 ${date} 往返应一致`)
    }
  }
})

test('dateAtX 在格子中间仍然落在当天（向下取整）', () => {
  const scale = createScale('day', [], TODAY)
  const x = dateToX(scale, '2026-10-30')
  assert.equal(dateAtX(scale, x + 0.5), '2026-10-30')
  assert.equal(dateAtX(scale, x + scale.dayWidth - 0.01), '2026-10-30')
  assert.equal(dateAtX(scale, x + scale.dayWidth), '2026-10-31')
  assert.equal(dateAtX(scale, Number.NaN), scale.origin, '非法坐标回落到起点，不抛错')
})

test('barRect：结束日含当天，起止同日为 1 天宽', () => {
  const scale = createScale('day', [], TODAY)

  const sameDay = barRect(scale, '2026-10-26', '2026-10-26')
  assert.equal(sameDay.days, 1)
  assert.equal(sameDay.width, scale.dayWidth)

  const threeDays = barRect(scale, '2026-10-26', '2026-10-28')
  assert.equal(threeDays.days, 3)
  assert.equal(threeDays.width, 3 * scale.dayWidth)
  assert.equal(threeDays.left, dateToX(scale, '2026-10-26'))

  const reversed = barRect(scale, '2026-10-28', '2026-10-26')
  assert.equal(reversed.days, 1, '起止颠倒时兜到最短一天，不出现负宽度')
  assert.ok(reversed.width > 0)
})

test('snapDays 按当前缩放吸附到整天', () => {
  const day = createScale('day', [], TODAY)
  assert.equal(snapDays(day, 0), 0)
  assert.equal(snapDays(day, 16), 0)
  assert.equal(snapDays(day, 17), 1, '半格向上吸附')
  assert.equal(snapDays(day, -34), -1)
  assert.equal(snapDays(day, Number.NaN), 0)

  const month = createScale('month', [], TODAY)
  assert.equal(snapDays(month, month.dayWidth * 5), 5, '月视图按小数宽度换算')
})

test('todayLineX 在区间内返回坐标，区间外返回 null', () => {
  const scale = createScale('day', [], TODAY)
  const x = todayLineX(scale, TODAY)
  assert.ok(x !== null)
  assert.equal(x, dateToX(scale, TODAY) + scale.dayWidth / 2)

  assert.equal(todayLineX(scale, addDays(scale.origin, -1)), null)
  assert.equal(todayLineX(scale, addDays(scale.end, 1)), null)
})

test('daysInMonth 处理闰年与大小月', () => {
  assert.equal(daysInMonth('2024-02-10'), 29)
  assert.equal(daysInMonth('2026-02-10'), 28)
  assert.equal(daysInMonth('2026-04-10'), 30)
  assert.equal(daysInMonth('2026-12-10'), 31)
})

test('buildTicks：月视图按真实月长铺格，闰年 2 月是 29 天', () => {
  const scale = createScale('month', [{ start_date: '2024-01-10', due_date: '2024-04-10' }], '2024-02-15')
  const ticks = buildTicks(scale, '2024-02-15')
  const feb = ticks.find((t) => t.key === '2024-02-01')
  assert.ok(feb, '应当出现 2024-02-01 这个刻度')
  assert.equal(feb.label, '2月')
  assert.equal(feb.width, 29 * scale.dayWidth, '2024 年 2 月 29 天')
  assert.equal(feb.isToday, true)
  assert.equal(ticks.find((t) => t.key === '2024-01-01')?.isBoundary, true, '1 月要显示年份')
})

test('buildTicks：周视图每格 7 天，第 N 周标注正确', () => {
  const scale = createScale('week', [], TODAY)
  const ticks = buildTicks(scale, TODAY)
  for (const tick of ticks) assert.equal(tick.width, 7 * scale.dayWidth)
  assert.ok(ticks.some((t) => t.isToday), '今天所在周要有标记')
  assert.equal(weekNumber('2026-01-01'), 1)
})

test('buildTicks：日视图区分周末与今天', () => {
  const scale = createScale('day', [], TODAY)
  const ticks = buildTicks(scale, TODAY)
  assert.equal(ticks.find((t) => t.key === TODAY)?.isToday, true)
  assert.equal(ticks.find((t) => t.key === '2026-10-31')?.isWeekend, true, '周六')
  assert.equal(ticks.find((t) => t.key === '2026-10-26')?.isWeekend, false, '周一')
})

test('applyDragDates：整体平移不改变长度', () => {
  const base = { start: '2026-10-20', due: '2026-10-24' }
  assert.deepEqual(applyDragDates('move', base, 3), { start: '2026-10-23', due: '2026-10-27' })
  assert.deepEqual(applyDragDates('move', base, -3), { start: '2026-10-17', due: '2026-10-21' })
  assert.deepEqual(applyDragDates('move', base, 0), base)
})

test('applyDragDates：拖边缘保持最短一天，且不越过另一端', () => {
  const base = { start: '2026-10-20', due: '2026-10-24' }

  assert.deepEqual(applyDragDates('start', base, 2), { start: '2026-10-22', due: '2026-10-24' })
  assert.deepEqual(applyDragDates('start', base, 10), { start: '2026-10-24', due: '2026-10-24' }, '开始不能越过截止')
  assert.deepEqual(applyDragDates('end', base, -2), { start: '2026-10-20', due: '2026-10-22' })
  assert.deepEqual(applyDragDates('end', base, -10), { start: '2026-10-20', due: '2026-10-20' }, '截止不能早于开始')
})

test('applyDragDates 跨月跨年都用自然日累加', () => {
  const base = { start: '2026-12-30', due: '2027-01-02' }
  assert.deepEqual(applyDragDates('move', base, 3), { start: '2027-01-02', due: '2027-01-05' })
  assert.deepEqual(applyDragDates('move', { start: '2024-02-28', due: '2024-02-29' }, 1), {
    start: '2024-02-29',
    due: '2024-03-01',
  })
})
