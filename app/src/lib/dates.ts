/**
 * 日期工具（纯整数公历运算）。
 *
 * 设计约定（硬性）：
 *  - 所有"日期"都是 `YYYY-MM-DD` 字符串，对应数据库 `DATE` 列；
 *  - **不使用** `new Date('YYYY-MM-DD')` 作为日历计算基础（那会按 UTC 解析，
 *    在东八区会整体偏移一天）；
 *  - 日历加减一律通过"日序号"做整数运算，不假设一天固定 86400000 毫秒，
 *    因此跨月、跨年、闰年、夏令时都不会算错；
 *  - 团队时区固定 `Asia/Shanghai`，"今天"一律按该时区判定。
 */

/** 团队时区（首版固定） */
export const TEAM_TIMEZONE = 'Asia/Shanghai'

export type ISODate = string

const DAY_MS = 86_400_000

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** `YYYY-MM-DD` 是否合法（含闰年校验） */
export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [, m, d] = value.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  return fromDayNumber(toDayNumber(value)) === value
  // 上行的逆向校验即可覆盖 2 月 30 日这类非法日期
}

/** 公历日期 → 自 1970-01-01 起的天数（Howard Hinnant 算法） */
export function toDayNumber(iso: ISODate): number {
  const [y0, m, d] = iso.split('-').map(Number)
  const y = m <= 2 ? y0 - 1 : y0
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** 天数 → 公历日期 */
export function fromDayNumber(dayNumber: number): ISODate {
  const z = dayNumber + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return `${m <= 2 ? y + 1 : y}-${pad2(m)}-${pad2(d)}`
}

/** 团队时区下的"今天" */
export function todayISO(now: Date = new Date(), timeZone: string = TEAM_TIMEZONE): ISODate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

/** 按自然日加减 */
export function addDays(iso: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(iso) + Math.trunc(days))
}

/** `to - from` 的天数差（to 晚于 from 为正） */
export function diffDays(from: ISODate, to: ISODate): number {
  return toDayNumber(to) - toDayNumber(from)
}

/** 比较：a<b 负，a=b 0，a>b 正 */
export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 周一为一周起点，返回 0..6 */
export function weekdayIndex(iso: ISODate): number {
  // 1970-01-01 是周四 → 以周一为 0 的索引为 3
  return (((toDayNumber(iso) + 3) % 7) + 7) % 7
}

/** 所在周的周一 */
export function startOfWeek(iso: ISODate): ISODate {
  return addDays(iso, -weekdayIndex(iso))
}

/** 所在月 1 日 */
export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`
}

/** 所在月最后一天 */
export function endOfMonth(iso: ISODate): ISODate {
  return addDays(addMonths(startOfMonth(iso), 1), -1)
}

/** 按月加减，日超出目标月长度时夹到月末（1-31 + 1 月 → 2-28/29） */
export function addMonths(iso: ISODate, months: number): ISODate {
  const [y, m, d] = iso.split('-').map(Number)
  const total = y * 12 + (m - 1) + Math.trunc(months)
  const ny = Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12 + 1
  const lastDay = fromDayNumber(toDayNumber(nm === 12 ? `${ny + 1}-01-01` : `${ny}-${pad2(nm + 1)}-01`) - 1)
  const maxDay = Number(lastDay.slice(8, 10))
  return `${ny}-${pad2(nm)}-${pad2(Math.min(d, maxDay))}`
}

/** 闭区间枚举日期 */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = []
  const from = toDayNumber(start)
  const to = toDayNumber(end)
  for (let n = from; n <= to; n += 1) out.push(fromDayNumber(n))
  return out
}

/** `5月1日` 形式 */
export function formatMonthDay(iso: ISODate): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}月${Number(d)}日`
}

/** `2026年5月` 形式 */
export function formatMonth(iso: ISODate): string {
  const [y, m] = iso.split('-')
  return `${y}年${Number(m)}月`
}

/** `2026-05-01 09:30` 形式的本地展示（用于 updated_at 等带时区时间戳） */
export function formatDateTime(value: string | null | undefined, timeZone: string = TEAM_TIMEZONE): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`
}

/** 剩余/逾期天数文案 */
export function dueLabel(due: ISODate, today: ISODate): string {
  const delta = diffDays(today, due)
  if (delta === 0) return '今天截止'
  if (delta > 0) return `还有 ${delta} 天`
  return `逾期 ${-delta} 天`
}

/** 仅供需要毫秒的场景（例如测试断言），不做日历运算 */
export function dayNumberToMs(dayNumber: number): number {
  return dayNumber * DAY_MS
}
