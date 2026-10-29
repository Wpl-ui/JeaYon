/**
 * 日期工具单测。
 *
 * 重点覆盖"看起来不会错、其实最容易错"的地方：
 * 闰年、大小月、跨年、周一起始、月末夹取。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays,
  addMonths,
  compareISO,
  diffDays,
  eachDay,
  endOfMonth,
  fromDayNumber,
  isValidISODate,
  startOfWeek,
  toDayNumber,
  weekdayIndex,
} from '../../src/lib/dates'

test('isValidISODate 只接受真实存在的日历日期', () => {
  assert.equal(isValidISODate('2024-02-29'), true, '闰年 2 月 29 日合法')
  assert.equal(isValidISODate('2026-02-29'), false, '平年没有 2 月 29 日')
  assert.equal(isValidISODate('2026-04-31'), false, '4 月只有 30 天')
  assert.equal(isValidISODate('2026-13-01'), false, '月份越界')
  assert.equal(isValidISODate('2026-00-10'), false, '月份为 0')
  assert.equal(isValidISODate('2026-1-01'), false, '必须是两位月份')
  assert.equal(isValidISODate('2026-01-01 '), false, '不接受尾随空格')
  assert.equal(isValidISODate(20260101), false, '只接受字符串')
  assert.equal(isValidISODate(null), false)
})

test('日序号与日期互为逆运算（含跨年、闰年、世纪年）', () => {
  const samples = [
    '1970-01-01',
    '1999-12-31',
    '2000-02-29',
    '2024-02-29',
    '2026-10-26',
    '2100-03-01',
  ]
  for (const iso of samples) {
    assert.equal(fromDayNumber(toDayNumber(iso)), iso, `${iso} 往返应当一致`)
  }
  assert.equal(toDayNumber('1970-01-01'), 0)
  assert.equal(diffDays('1970-01-01', '1970-01-02'), 1)
})

test('diffDays / addDays 按自然日计算，跨越跨年与闰日都正确', () => {
  assert.equal(diffDays('2024-02-28', '2024-03-01'), 2, '闰年 2 月有 29 日')
  assert.equal(diffDays('2026-02-28', '2026-03-01'), 1, '平年直接进入 3 月')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(addDays('2024-02-28', 2), '2024-03-01')
  assert.equal(diffDays('2026-10-26', '2026-10-26'), 0, '同一天差 0 天')
})

test('weekdayIndex 以周一为 0，周日为 6', () => {
  assert.equal(weekdayIndex('2026-10-26'), 0, '2026-10-26 是周一')
  assert.equal(weekdayIndex('2026-10-31'), 5, '2026-10-31 是周六')
  assert.equal(weekdayIndex('2026-11-01'), 6, '2026-11-01 是周日')
})

test('startOfWeek 归到周一（周日属于上一周）', () => {
  assert.equal(startOfWeek('2026-10-26'), '2026-10-26')
  assert.equal(startOfWeek('2026-10-28'), '2026-10-26')
  assert.equal(startOfWeek('2026-11-01'), '2026-10-26', '周日应回到本周一')
  assert.equal(startOfWeek('2027-01-01'), '2026-12-28', '跨年时仍归到周一')
})

test('endOfMonth 覆盖大小月与闰年 2 月', () => {
  assert.equal(endOfMonth('2026-01-15'), '2026-01-31')
  assert.equal(endOfMonth('2026-02-10'), '2026-02-28')
  assert.equal(endOfMonth('2024-02-10'), '2024-02-29')
  assert.equal(endOfMonth('2026-04-01'), '2026-04-30')
  assert.equal(endOfMonth('2026-12-31'), '2026-12-31')
})

test('addMonths 在目标月天数不足时夹到月末', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28')
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15')
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15')
})

test('eachDay 返回闭区间，跨年不漏不多', () => {
  assert.deepEqual(eachDay('2026-12-30', '2027-01-02'), [
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
  ])
  assert.deepEqual(eachDay('2026-10-26', '2026-10-26'), ['2026-10-26'])
  assert.equal(eachDay('2024-02-28', '2024-03-01').length, 3)
})

test('compareISO 按日历顺序比较', () => {
  assert.equal(compareISO('2026-10-26', '2026-10-27'), -1)
  assert.equal(compareISO('2026-10-26', '2026-10-26'), 0)
  assert.equal(compareISO('2027-01-01', '2026-12-31'), 1)
})
