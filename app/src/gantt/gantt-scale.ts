/**
 * 甘特图刻度（纯函数，无 DOM 依赖，可单测）。
 *
 * 关键设计：**日 / 周 / 月三种缩放共用同一套日期↔坐标映射**。
 * 缩放只改变"一天等于多少像素"，而不用三套不同的取整逻辑，
 * 因此跨月、跨年、闰年、大小月都不会出现错位：
 *
 *     x = diffDays(origin, date) * dayWidth
 *     date = addDays(origin, floor(x / dayWidth))
 *
 * 周视图 `dayWidth ≈ 22.4`、月视图 `dayWidth ≈ 8.4` 是小数，这是刻意的：
 * 一旦按月分别取整，月份交界处就会出现一像素的漂移，累计后条与刻度对不上。
 */
import {
  addDays,
  addMonths,
  compareISO,
  diffDays,
  eachDay,
  endOfMonth,
  startOfMonth,
  startOfWeek,
  weekdayIndex,
  type ISODate,
} from '../lib/dates'

export type GanttZoom = 'day' | 'week' | 'month'

export const ZOOM_LABEL: Record<GanttZoom, string> = { day: '日', week: '周', month: '月' }

/** 每种缩放下"一天多少像素"（周/月为小数，见文件头说明）。 */
const DAY_WIDTH: Record<GanttZoom, number> = { day: 34, week: 22.4, month: 8.4 }

/** 时间轴最少显示多少天，避免任务很少时轴太短看不出时间感。 */
const MIN_DAYS: Record<GanttZoom, number> = { day: 30, week: 56, month: 92 }

const WEEKDAY_CN = ['一', '二', '三', '四', '五', '六', '日']

export interface GanttScale {
  zoom: GanttZoom
  /** 时间轴第一天（含） */
  origin: ISODate
  /** 时间轴最后一天（含） */
  end: ISODate
  /** 一天多少像素 */
  dayWidth: number
  /** 总天数（含首尾） */
  totalDays: number
  /** 画布总宽度 */
  totalWidth: number
}

export interface GanttRange {
  start: ISODate
  end: ISODate
}

/** 任务起止日期的取值范围（只用到这两个字段，便于测试传入简化对象）。 */
export interface GanttDated {
  start_date: ISODate
  due_date: ISODate
}

/**
 * 计算时间轴范围：覆盖所有任务与今天，并按缩放补齐到整数周 / 整数月。
 */
export function computeRange(
  zoom: GanttZoom,
  tasks: readonly GanttDated[],
  today: ISODate,
): GanttRange {
  let min = today
  let max = today
  for (const task of tasks) {
    if (compareISO(task.start_date, min) < 0) min = task.start_date
    if (compareISO(task.due_date, max) > 0) max = task.due_date
  }

  if (zoom === 'day') {
    const start = addDays(min, -3)
    let end = addDays(max, 3)
    if (diffDays(start, end) + 1 < MIN_DAYS.day) end = addDays(start, MIN_DAYS.day - 1)
    return { start, end }
  }

  if (zoom === 'week') {
    const start = addDays(startOfWeek(min), -7)
    let end = addDays(startOfWeek(max), 13)
    if (diffDays(start, end) + 1 < MIN_DAYS.week) end = addDays(start, MIN_DAYS.week - 1)
    // 对齐到所在周的周日，保证每个刻度都是完整 7 天
    end = addDays(startOfWeek(end), 6)
    return { start, end }
  }

  const start = startOfMonth(addMonths(min, -1))
  let end = endOfMonth(addMonths(max, 1))
  if (diffDays(start, end) + 1 < MIN_DAYS.month) end = endOfMonth(addMonths(start, 2))
  return { start, end }
}

export function createScale(
  zoom: GanttZoom,
  tasks: readonly GanttDated[],
  today: ISODate,
): GanttScale {
  const { start, end } = computeRange(zoom, tasks, today)
  const totalDays = diffDays(start, end) + 1
  const dayWidth = DAY_WIDTH[zoom]
  return {
    zoom,
    origin: start,
    end,
    dayWidth,
    totalDays,
    totalWidth: Math.round(totalDays * dayWidth),
  }
}

/** 日期 → 画布横坐标（该日 0 点所在的左边缘）。 */
export function dateToX(scale: GanttScale, date: ISODate): number {
  return diffDays(scale.origin, date) * scale.dayWidth
}

/** 画布横坐标 → 日期（向下取整：落在哪一天就算哪一天）。 */
export function dateAtX(scale: GanttScale, x: number): ISODate {
  if (!Number.isFinite(x)) return scale.origin
  // 加一个极小量再取整：周 / 月视图的 dayWidth 是小数，
  // `2.4 * 3 = 7.199999999999999`，再除回 2.4 得 2.9999999999999996，
  // 直接 floor 会被算成前一天。
  const day = Math.floor(x / scale.dayWidth + 1e-9)
  return addDays(scale.origin, day)
}

/**
 * 客户端坐标 → 日期。
 * 必须传入滚动容器的 `scrollLeft` 与它的 `getBoundingClientRect().left`，
 * 否则横向滚动之后拖拽会整体偏移。
 */
export function clientXToDate(
  scale: GanttScale,
  clientX: number,
  containerLeft: number,
  scrollLeft: number,
): ISODate {
  return dateAtX(scale, clientX - containerLeft + scrollLeft)
}

/** 拖拽像素位移 → 自然日增量（吸附到整天）。 */
export function snapDays(scale: GanttScale, deltaX: number): number {
  if (!Number.isFinite(deltaX) || scale.dayWidth <= 0) return 0
  return Math.round(deltaX / scale.dayWidth)
}

/**
 * 任务条的位置与宽度。
 * **结束日含当天**：同一天的起止显示为一天宽，而不是 0 宽。
 */
export function barRect(
  scale: GanttScale,
  start: ISODate,
  due: ISODate,
): { left: number; width: number; days: number } {
  const left = dateToX(scale, start)
  const days = Math.max(1, diffDays(start, due) + 1)
  return { left, width: days * scale.dayWidth, days }
}

/** 今天那条竖线的 x；今天不在时间轴内时返回 null。 */
export function todayLineX(scale: GanttScale, today: ISODate): number | null {
  if (compareISO(today, scale.origin) < 0 || compareISO(today, scale.end) > 0) return null
  return dateToX(scale, today) + scale.dayWidth / 2
}

export function daysInMonth(iso: ISODate): number {
  return diffDays(startOfMonth(iso), endOfMonth(iso)) + 1
}

/** 该日期所在周是当年的第几周（以周一为周首，1 月 1 日所在周为第 1 周）。 */
export function weekNumber(iso: ISODate): number {
  const year = iso.slice(0, 4)
  const firstWeekStart = startOfWeek(`${year}-01-01`)
  return Math.floor(diffDays(firstWeekStart, startOfWeek(iso)) / 7) + 1
}

export interface GanttTick {
  key: string
  label: string
  sub: string
  left: number
  width: number
  isToday: boolean
  isWeekend: boolean
  /** 月份交界（用于加重左边框） */
  isBoundary: boolean
}

const MONTH_LABEL = (iso: ISODate) => `${Number(iso.slice(5, 7))}月`

export function buildTicks(scale: GanttScale, today: ISODate): GanttTick[] {
  const ticks: GanttTick[] = []

  if (scale.zoom === 'day') {
    for (const date of eachDay(scale.origin, scale.end)) {
      const wd = weekdayIndex(date)
      ticks.push({
        key: date,
        label: String(Number(date.slice(8, 10))),
        sub: WEEKDAY_CN[wd],
        left: dateToX(scale, date),
        width: scale.dayWidth,
        isToday: date === today,
        isWeekend: wd >= 5,
        isBoundary: date.slice(8) === '01',
      })
    }
    return ticks
  }

  if (scale.zoom === 'week') {
    let cursor = scale.origin
    while (compareISO(cursor, scale.end) <= 0) {
      const weekStart = startOfWeek(cursor)
      const weekEnd = addDays(weekStart, 6)
      ticks.push({
        key: cursor,
        label: `${Number(cursor.slice(5, 7))}/${Number(cursor.slice(8, 10))}`,
        sub: `第${weekNumber(cursor)}周`,
        left: dateToX(scale, cursor),
        width: 7 * scale.dayWidth,
        isToday: compareISO(today, cursor) >= 0 && compareISO(today, weekEnd) <= 0,
        isWeekend: false,
        isBoundary: cursor.slice(8, 10) <= '07',
      })
      cursor = addDays(cursor, 7)
    }
    return ticks
  }

  let month = startOfMonth(scale.origin)
  while (compareISO(month, scale.end) <= 0) {
    const days = daysInMonth(month)
    const monthEnd = addDays(month, days - 1)
    ticks.push({
      key: month,
      label: MONTH_LABEL(month),
      sub: month.slice(5, 7) === '01' ? `${month.slice(0, 4)}年` : '',
      left: dateToX(scale, month),
      width: days * scale.dayWidth,
      isToday: compareISO(today, month) >= 0 && compareISO(today, monthEnd) <= 0,
      isWeekend: false,
      isBoundary: month.slice(5, 7) === '01',
    })
    month = startOfMonth(addMonths(month, 1))
  }
  return ticks
}

/**
 * 把一次拖拽的结果应用到任务日期上。
 *  - `move`：整体平移；
 *  - `start` / `end`：只改一端，**最短一天**（开始不能越过截止，反之亦然）。
 */
export function applyDragDates(
  mode: 'move' | 'start' | 'end',
  base: { start: ISODate; due: ISODate },
  days: number,
): { start: ISODate; due: ISODate } {
  if (mode === 'move') {
    return { start: addDays(base.start, days), due: addDays(base.due, days) }
  }
  if (mode === 'start') {
    const next = addDays(base.start, days)
    return { start: compareISO(next, base.due) > 0 ? base.due : next, due: base.due }
  }
  const next = addDays(base.due, days)
  return { start: base.start, due: compareISO(next, base.start) < 0 ? base.start : next }
}
