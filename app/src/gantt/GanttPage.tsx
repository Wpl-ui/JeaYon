/**
 * 甘特图。
 *
 * 三个容易踩坑的地方，都在这里集中处理：
 *
 *  1. **坐标换算只有一套**：日 / 周 / 月缩放共用 `gantt-scale` 的
 *     `x = 天数差 * dayWidth`，不做三套取整，所以跨月、跨年、闰年都对得上。
 *  2. **拖动用"位移"而不是"绝对坐标"**：记录按下时的 `clientX`，之后只比较位移，
 *     因此横向滚动多少都不影响结果；缩放只影响 `snapDays` 的除法。
 *  3. **失败先撤销乐观显示，再重查服务端**：拖拽写库带 `expected_version`，
 *     被别人改过就回滚并重新拉取，绝不用旧快照覆盖较新的结果。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GanttBarLabel } from './GanttBarLabel'
import { useAuth } from '../auth/AuthProvider'
import { useTeam } from '../teams/TeamProvider'
import { useTeamQuery } from '../lib/useTeamQuery'
import { fetchTasks, updateTask, type TaskDraft } from '../tasks/api'
import { TaskDrawer } from '../tasks/TaskDrawer'
import { canMaintainTasks, roleLabel } from '../lib/permissions'
import { errorMessage, isSessionExpired, toAppError } from '../lib/errors'
import { addDays, diffDays, eachDay, endOfMonth, startOfMonth, startOfWeek, todayISO, weekdayIndex, type ISODate } from '../lib/dates'
import { Avatar, Banner, Button, EmptyState, InlineLoading, PageError, StatusGlyph, SymbolIcon } from '../components/ui'
import type { TaskRow, TaskStatus } from '../types/db'
import {
  ZOOM_LABEL,
  applyDragDates,
  barRect,
  buildTicks,
  createScale,
  dateToX,
  snapDays,
  todayLineX,
  type GanttZoom,
} from './gantt-scale'

type DragMode = 'move' | 'start' | 'end'
type StatusFilter = 'all' | TaskStatus

interface DragState {
  taskId: number
  mode: DragMode
  pointerId: number
  /** 按下时的任务日期（拖动期间不变，作为平移基准） */
  base: { start: ISODate; due: ISODate }
  /** 按下时的客户端横坐标；之后只算位移，天然不受横向滚动影响 */
  startX: number
  /** 预览日期；null 表示还没移动过 */
  preview: { start: ISODate; due: ISODate } | null
}

export function GanttPage() {
  const { expireSession } = useAuth()
  const { currentTeam, currentTeamId, currentRole, memberName, activeMembers, members } = useTeam()

  const query = useTeamQuery(currentTeamId, fetchTasks)

  const [zoom, setZoom] = useState<GanttZoom>('week')
  const [visibleMonth, setVisibleMonth] = useState(todayISO().slice(0, 7))
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [drag, setDrag] = useState<DragState | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<TaskRow | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)

  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const [timelineWidth, setTimelineWidth] = useState(0)
  const leftBodyRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const savingRef = useRef<Set<number>>(new Set())

  const today = todayISO()
  const rows = useMemo(() => query.data ?? [], [query.data])

  const filtered = useMemo(() => {
    return rows.filter((task) => {
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (assigneeFilter === 'unassigned') return task.assignee_id === null
      if (assigneeFilter !== 'all') return task.assignee_id === assigneeFilter
      return true
    })
  }, [rows, statusFilter, assigneeFilter])

  // 时间轴范围覆盖"全部未归档任务 + 今天"，而不是只覆盖筛选后的任务，
  // 否则一换筛选条件整条轴就会跳。
  const scale = useMemo(() => {
    const base = createScale(zoom, rows, today)
    const x = todayLineX(base, today) ?? 0
    // Leave enough calendar space on both sides to center today at every zoom,
    // even when the desktop viewport is wider than the original date range.
    const before = Math.max(0, Math.ceil((timelineWidth / 2 - x) / base.dayWidth))
    const after = Math.max(0, Math.ceil((timelineWidth / 2 - (base.totalWidth - x)) / base.dayWidth))
    const first = addDays(base.origin, -before)
    const last = addDays(base.end, after)
    const origin = zoom === 'month' ? startOfMonth(first) : zoom === 'week' ? startOfWeek(first) : first
    const end = zoom === 'month' ? endOfMonth(last) : zoom === 'week' ? addDays(startOfWeek(last), 6) : last
    const totalDays = diffDays(origin, end) + 1
    return {
      ...base,
      origin,
      end,
      totalDays,
      totalWidth: Math.ceil(totalDays * base.dayWidth),
    }
  }, [zoom, rows, today, timelineWidth])
  const ticks = useMemo(() => buildTicks(scale, today), [scale, today])
  const todayX = useMemo(() => todayLineX(scale, today), [scale, today])
  const calendar = useMemo(() => {
    const days = eachDay(scale.origin, scale.end)
    const months: { key: string; left: number; width: number }[] = []
    for (const day of days) {
      const key = day.slice(0, 7)
      const last = months[months.length - 1]
      if (last?.key === key) last.width += scale.dayWidth
      else months.push({ key, left: dateToX(scale, day), width: scale.dayWidth })
    }
    return { days, months, weekends: days.filter((day) => weekdayIndex(day) >= 5) }
  }, [scale])

  const canEdit = canMaintainTasks(currentRole)

  const scrollToToday = useCallback(
    (behavior: ScrollBehavior) => {
      const el = scrollElement
      if (!el) return
      const x = todayX
      const target = x === null ? 0 : Math.max(0, x - el.clientWidth / 2)
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollTo({ left: target, behavior: reduceMotion ? 'auto' : behavior })
    },
    [todayX, scrollElement],
  )

  useLayoutEffect(() => {
    if (!scrollElement) return
    const measure = () => setTimelineWidth(scrollElement.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scrollElement)
    return () => observer.disconnect()
  }, [scrollElement])

  // Wait for the asynchronously loaded chart to mount; also recenter on zoom
  // and viewport changes after the calendar's new dimensions are committed.
  useLayoutEffect(() => {
    if (!scrollElement) return
    scrollToToday('auto')
    setScrollLeft(scrollElement.scrollLeft)
    setVisibleMonth(today.slice(0, 7))
  }, [zoom, scrollToToday, scrollElement, timelineWidth, scale.totalWidth, today])

  const scrollCalendar = (direction: -1 | 1) => {
    const el = scrollElement
    if (!el) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  const cancelDrag = useCallback(() => {
    dragRef.current = null
    setDrag(null)
  }, [])

  // Escape 取消拖动：指针事件之外的第二道逃生口
  useEffect(() => {
    if (drag === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelDrag()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drag, cancelDrag])

  // 切换团队时清掉拖动残留，避免把旧团队的任务 id 带到新团队
  useEffect(() => {
    cancelDrag()
    savingRef.current.clear()
    setSavingId(null)
    setActionError(null)
    setDrawerOpen(false)
    setEditing(null)
  }, [currentTeamId, cancelDrag])

  const openCreate = () => {
    setEditing(null)
    setDrawerOpen(true)
  }

  const openEdit = (task: TaskRow) => {
    setEditing(task)
    setDrawerOpen(true)
  }

  /** 拖拽落库：乐观更新 → 服务端校验版本 → 失败回滚并重查。 */
  const commitDrag = useCallback(
    async (task: TaskRow, next: { start: ISODate; due: ISODate }) => {
      if (savingRef.current.has(task.id)) return
      savingRef.current.add(task.id)
      setSavingId(task.id)
      setActionError(null)

      const draft: TaskDraft = {
        title: task.title,
        description: task.description ?? '',
        assigneeId: task.assignee_id,
        status: task.status,
        progress: task.progress,
        startDate: next.start,
        dueDate: next.due,
        parentId: task.parent_id,
      }

      query.mutate((prev) =>
        prev === null
          ? prev
          : prev.map((row) =>
              row.id === task.id ? { ...row, start_date: next.start, due_date: next.due } : row,
            ),
      )

      try {
        const saved = await updateTask(task.id, task.version, draft)
        query.mutate((prev) =>
          prev === null ? prev : prev.map((row) => (row.id === saved.id ? saved : row)),
        )
      } catch (err) {
        // 先撤掉乐观显示，再让服务端事实覆盖本地
        query.mutate((prev) =>
          prev === null
            ? prev
            : prev.map((row) =>
                row.id === task.id
                  ? { ...row, start_date: task.start_date, due_date: task.due_date }
                  : row,
              ),
        )
        if (isSessionExpired(err)) {
          expireSession(errorMessage(err))
          return
        }
        if (toAppError(err).code === 'conflict') {
          setActionError('该任务已被他人修改，已重新加载最新状态。你的这次拖动没有生效。')
        } else {
          setActionError(errorMessage(err))
        }
        query.reload()
      } finally {
        savingRef.current.delete(task.id)
        setSavingId(null)
      }
    },
    [expireSession, query],
  )

  const handlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    task: TaskRow,
    mode: DragMode,
  ) => {
    if (event.button !== 0) return
    if (savingRef.current.has(task.id)) return
    if (!canEdit) {
      openEdit(task)
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const next: DragState = {
      taskId: task.id,
      mode,
      pointerId: event.pointerId,
      base: { start: task.start_date, due: task.due_date },
      startX: event.clientX,
      preview: null,
    }
    dragRef.current = next
    setDrag(next)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const days = snapDays(scale, event.clientX - state.startX)
    const preview = applyDragDates(state.mode, state.base, days)
    if (state.preview && preview.start === state.preview.start && preview.due === state.preview.due) {
      return
    }
    const next: DragState = { ...state, preview }
    dragRef.current = next
    setDrag(next)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDrag(null)

    const task = rows.find((row) => row.id === state.taskId)
    if (!task) return

    const moved =
      state.preview !== null &&
      (state.preview.start !== task.start_date || state.preview.due !== task.due_date)

    if (!moved) {
      // 没移动 = 用户只是想打开这个任务
      openEdit(task)
      return
    }
    if (!state.preview) return
    void commitDrag(task, state.preview)
  }

  // 指针被系统抢走（比如触控板手势打断）时不算保存，直接恢复原日期
  const handleLostCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    cancelDrag()
  }

  const syncLeftScroll = () => {
    const el = scrollElement
    const left = leftBodyRef.current
    if (!el || !left) return
    // 表头 sticky，行内容随滚动上移，左栏只同步行部分
    left.scrollTop = el.scrollTop
    setScrollLeft(el.scrollLeft)
    const center = Math.floor((el.scrollLeft + el.clientWidth / 2) / scale.dayWidth)
    setVisibleMonth(addDays(scale.origin, center).slice(0, 7))
  }

  if (!currentTeamId || !currentTeam) {
    return (
      <div className="page">
        <EmptyState title="还没有选择团队" description="请先在右上角选择一个团队。" />
      </div>
    )
  }

  if (query.error) {
    return (
      <div className="page">
        <PageError message={query.error} onRetry={query.reload} />
      </div>
    )
  }

  const hasFilter = statusFilter !== 'all' || assigneeFilter !== 'all'
  const dragging = drag?.preview ?? null

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">计划</h1>
          <p className="page-desc">
            {currentTeam.team.name} · {filtered.length} 个任务
            {hasFilter ? `（已筛选，共 ${rows.length} 个）` : ''}
            {currentRole ? ` · 我的角色：${roleLabel(currentRole)}` : ''}
          </p>
        </div>
        <div className="page-head-actions">
          <Button variant="ghost" onClick={query.reload} disabled={query.loading}>
            刷新
          </Button>
          {canEdit ? (
            <Button variant="primary" onClick={openCreate}>
              新建任务
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="error" onClose={() => setActionError(null)}>
            {actionError}
          </Banner>
        </div>
      ) : null}

      <div className="card gantt-card">
        <div className="calendar-toolbar">
          <h2 className="calendar-month-title">{visibleMonth.slice(0, 4)}年{Number(visibleMonth.slice(5))}月</h2>
          <div className="calendar-navigation">
            <Button variant="ghost" aria-label="上一个时间段" onClick={() => scrollCalendar(-1)}><SymbolIcon name="chevron-left" /></Button>
            <Button variant="secondary" onClick={() => scrollToToday('smooth')}>今天</Button>
            <Button variant="ghost" aria-label="下一个时间段" onClick={() => scrollCalendar(1)}><SymbolIcon name="chevron-right" /></Button>
          </div>
          <div className="tabs" role="tablist" aria-label="时间刻度">
            {(['day', 'week', 'month'] as GanttZoom[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={zoom === item}
                className={zoom === item ? 'tab active' : 'tab'}
                onClick={() => setZoom(item)}
              >
                {ZOOM_LABEL[item]}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-bar">
          <select
            className="select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            aria-label="按状态筛选"
          >
            <option value="all">全部状态</option>
            <option value="todo">未开始</option>
            <option value="in_progress">进行中</option>
            <option value="done">已完成</option>
          </select>
          <select
            className="select"
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            aria-label="按负责人筛选"
          >
            <option value="all">全部负责人</option>
            <option value="unassigned">未分配</option>
            {activeMembers.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name}
              </option>
            ))}
          </select>
          {hasFilter ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setStatusFilter('all')
                setAssigneeFilter('all')
              }}
            >
              清除筛选
            </Button>
          ) : null}
          <span className="grow" />
          <span className="tiny faint nowrap">
            {scale.origin} → {scale.end}
          </span>
        </div>
        <div className="gantt-legend" aria-label="甘特图图例">
          <span><StatusGlyph status="todo" />未开始</span>
          <span><StatusGlyph status="in_progress" />进行中</span>
          <span><StatusGlyph status="done" />已完成</span>
          <span><StatusGlyph status="in_progress" overdue />已逾期</span>
          <span>◆ 里程碑</span>
          <span className="legend-note">{filtered.length} 项任务 · {filtered.filter((task) => task.start_date === task.due_date).length} 个里程碑</span>
        </div>

        {query.loading && rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <InlineLoading label="正在读取任务…" />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 16 }}>
            <EmptyState
              title={rows.length === 0 ? '还没有任务' : '当前筛选下没有任务'}
              description={
                rows.length === 0
                  ? canEdit
                    ? '新建一个任务后，它会按起止日期出现在时间轴上。'
                    : '当前角色只能查看任务。'
                  : '换一个状态或负责人再看看。'
              }
              action={
                rows.length === 0 && canEdit ? (
                  <Button variant="primary" onClick={openCreate}>
                    新建任务
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="gantt-shell">
            <div
              className="gantt-left"
              style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
              <div className="gantt-left-head" style={{ flex: 'none' }}>
                任务 <span>{filtered.length} 项 · 负责人</span>
              </div>
              <div ref={leftBodyRef} style={{ flex: '1 1 auto', overflow: 'hidden' }}>
                {filtered.map((task) => {
                  const name = task.assignee_id ? memberName(task.assignee_id) : null
                  const isSelected = drawerOpen && editing?.id === task.id
                  return (
                    <button
                      type="button"
                      key={task.id}
                      className={`gantt-left-row${isSelected ? ' selected' : ''}${hoveredId === task.id ? ' hovered' : ''}`}
                      onClick={() => openEdit(task)}
                      onMouseEnter={() => setHoveredId(task.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      title={task.title}
                    >
                      <StatusGlyph status={task.status} overdue={task.status !== 'done' && task.due_date < today} />
                      <div className="gantt-task-title">{task.title}</div>
                      <Avatar name={name ?? '未分配'} small />
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="gantt-right" ref={setScrollElement} onScroll={syncLeftScroll}>
              <div className="gantt-canvas" style={{ width: scale.totalWidth }}>
                <div className="gantt-header">
                  <div className="gantt-month-row">
                    {calendar.months.map((month) => (
                      <div key={month.key} className="gantt-month" style={{ left: month.left, width: month.width }}>
                        {month.key.slice(0, 4)} 年 {Number(month.key.slice(5))} 月
                      </div>
                    ))}
                  </div>
                  <div className="gantt-head-row">
                  {zoom === 'month' ? ticks.map((tick) => (
                    <div key={tick.key} className="gantt-tick" style={{ width: tick.width }} title={tick.key}>
                      <span>{tick.label}</span><span>{tick.sub}</span>
                    </div>
                  )) : calendar.days.map((day) => (
                    <div key={day} className={`gantt-tick${weekdayIndex(day) >= 5 ? ' is-weekend' : ''}${day === today ? ' is-today' : ''}`} style={{ width: scale.dayWidth }} title={day}>
                      <span className="calendar-weekday">{['一', '二', '三', '四', '五', '六', '日'][weekdayIndex(day)]}</span>
                      <span className="calendar-day-number">{Number(day.slice(8))}</span>
                    </div>
                  ))}
                  {zoom === 'month' && todayX !== null ? <span className="calendar-today-marker" style={{ left: todayX }}>{Number(today.slice(8))}</span> : null}
                  </div>
                </div>

                <div className="gantt-body">
                  <div className="gantt-grid-layer">
                    {calendar.weekends.map((day) => (
                      <div key={day} className="gantt-weekend" style={{ left: dateToX(scale, day), width: scale.dayWidth }} />
                    ))}
                    {calendar.days.map((day) => (
                      <div key={`day-line-${day}`} className="gantt-day-line" style={{ left: dateToX(scale, day) }} />
                    ))}
                    {calendar.months.slice(1).map((month) => (
                      <div
                        key={`month-line-${month.key}`}
                        className="gantt-month-line"
                        style={{ left: month.left }}
                      />
                    ))}
                  </div>

                  {filtered.map((task) => {
                    const isDragging = drag !== null && drag.taskId === task.id
                    const start = isDragging && dragging ? dragging.start : task.start_date
                    const due = isDragging && dragging ? dragging.due : task.due_date
                    const rect = barRect(scale, start, due)
                    const milestone = start === due
                    const overdue = task.status !== 'done' && task.due_date < today
                    const barLeft = milestone ? rect.left + (rect.width - 24) / 2 : rect.left
                    const barWidth = milestone ? 24 : Math.max(rect.width, 12)
                    const label = `${task.title} · ${task.progress}%${milestone ? ` · ${due.slice(5).replace('-', '/')}` : ''}${overdue ? ' · 已逾期' : ''}${savingId === task.id ? ' · 保存中…' : ''}`
                    const tooltip = `${task.title}｜${start} → ${due}（${rect.days} 天，进度 ${task.progress}%）`
                    const classes = ['gantt-bar', `status-${task.status}`]
                    if (milestone) classes.push('is-milestone')
                    if (overdue) classes.push('is-overdue')
                    if (isDragging) classes.push('is-dragging')

                    return (
                      <div
                        key={task.id}
                        className={`gantt-row${hoveredId === task.id ? ' hovered' : ''}${drawerOpen && editing?.id === task.id ? ' selected' : ''}`}
                        title={tooltip}
                        onMouseEnter={() => setHoveredId(task.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handleLostCapture}
                        onLostPointerCapture={handleLostCapture}
                      >
                        <div
                          className={classes.join(' ')}
                          style={{ left: barLeft, width: barWidth }}
                          role="button"
                          tabIndex={0}
                          aria-label={`${task.title}，进度 ${task.progress}%，${start} 至 ${due}，按回车编辑`}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openEdit(task)
                            }
                          }}
                          title={tooltip}
                          onPointerDown={(event) => handlePointerDown(event, task, 'move')}
                        >
                          <div className="gantt-bar-progress" style={{ width: `${task.progress}%` }} />
                          {canEdit ? (
                            <>
                              <div
                                className="gantt-handle left"
                                onPointerDown={(event) => handlePointerDown(event, task, 'start')}
                              />
                              <div
                                className="gantt-handle right"
                                onPointerDown={(event) => handlePointerDown(event, task, 'end')}
                              />
                            </>
                          ) : null}
                        </div>
                        <GanttBarLabel
                          text={label}
                          title={tooltip}
                          left={barLeft}
                          width={barWidth}
                          timelineWidth={scale.totalWidth}
                          viewportWidth={timelineWidth}
                          scrollLeft={scrollLeft}
                          milestone={milestone}
                        />
                      </div>
                    )
                  })}

                  {todayX !== null ? (
                    <div className="gantt-today-line" style={{ left: todayX }} title="今天" />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}

        {filtered.length > 0 ? (
          <div className="gantt-hint">
            {canEdit ? '拖动任务条调整日期，拖动边缘调整起止日期。点击查看详情。' : '点击任务查看详情。当前角色仅可查看。'}
            <span className="grow" />
            <span className="gantt-hint-today">今天 {today} · Asia/Shanghai</span>
          </div>
        ) : null}
      </div>

      <TaskDrawer
        open={drawerOpen}
        task={editing}
        teamId={currentTeamId}
        members={members}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          setDrawerOpen(false)
          setEditing(null)
          query.reload()
        }}
      />
    </div>
  )
}
