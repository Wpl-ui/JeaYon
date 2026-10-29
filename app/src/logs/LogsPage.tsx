/**
 * 标准日报页。
 *
 * 两个视图共用一份服务端数据：
 *  - 「我的」只显示自己的日报，可新建 / 编辑 / 删除；
 *  - 「团队」显示全部成员的日报（只读），按工作日期倒序分组。
 * 写库一律走服务端，成功后重新查询，不在本地伪造结果。
 */
import { useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useTeam } from '../teams/TeamProvider'
import { useTeamQuery } from '../lib/useTeamQuery'
import { deleteWorkLog, fetchWorkLogs } from './api'
import { fetchTasks } from '../tasks/api'
import { LogDrawer } from './LogDrawer'
import { groupLogsByDate } from '../lib/stats'
import { canEditWorkLog } from '../lib/permissions'
import { formatDateTime, formatMonthDay, todayISO } from '../lib/dates'
import { errorMessage, isSessionExpired, toAppError } from '../lib/errors'
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  InlineLoading,
  TextInput,
} from '../components/ui'
import type { TaskRow, WorkLogRow } from '../types/db'

type View = 'mine' | 'team'

export function LogsPage() {
  const { userId, user, expireSession } = useAuth()
  const { currentTeamId, currentTeam, currentRole, memberName } = useTeam()

  const logsQuery = useTeamQuery(currentTeamId, fetchWorkLogs)
  const tasksQuery = useTeamQuery(currentTeamId, fetchTasks)

  const [view, setView] = useState<View>('mine')
  const [dateFilter, setDateFilter] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<WorkLogRow | null>(null)
  const [drawerDate, setDrawerDate] = useState(todayISO())

  const [deleteTarget, setDeleteTarget] = useState<WorkLogRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const today = todayISO()
  const logs = logsQuery.data ?? []
  const tasks = useMemo<TaskRow[]>(() => tasksQuery.data ?? [], [tasksQuery.data])

  const myLogs = useMemo(() => (userId === null ? [] : logs.filter((log) => log.owner_id === userId)), [logs, userId])
  const scoped = view === 'mine' ? myLogs : logs
  const filtered = useMemo(
    () => (dateFilter === '' ? scoped : scoped.filter((log) => log.work_date === dateFilter)),
    [scoped, dateFilter],
  )
  const grouped = useMemo(() => groupLogsByDate(filtered), [filtered])

  const todayLog = myLogs.find((log) => log.work_date === today) ?? null
  const myName = (userId === null ? null : memberName(userId)) ?? user?.name ?? '我'

  const taskTitle = useMemo(() => {
    const map = new Map<number, string>()
    for (const task of tasks) map.set(task.id, task.title)
    return map
  }, [tasks])

  function openCreate() {
    const date = dateFilter === '' ? today : dateFilter
    const existing = myLogs.find((log) => log.work_date === date) ?? null
    if (existing) {
      setEditing(existing)
      setDrawerDate(date)
      setDrawerOpen(true)
      setNotice('该日期已有日报，已为你打开那一篇编辑。每人每天只能写一篇。')
      return
    }
    setEditing(null)
    setDrawerDate(date)
    setDrawerOpen(true)
  }

  function openEdit(log: WorkLogRow) {
    setEditing(log)
    setDrawerDate(log.work_date)
    setDrawerOpen(true)
  }

  function openToday() {
    if (todayLog) openEdit(todayLog)
    else {
      setEditing(null)
      setDrawerDate(today)
      setDrawerOpen(true)
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleteBusy) return
    setDeleteBusy(true)
    setActionError(null)
    try {
      await deleteWorkLog(deleteTarget.id, deleteTarget.version)
      setDeleteTarget(null)
      logsQuery.reload()
    } catch (err) {
      const appError = toAppError(err)
      if (appError.code === 'conflict') {
        setActionError('这篇日报已被修改，已重新加载最新内容，请确认后再删除。')
        logsQuery.reload()
      } else if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
      } else {
        setActionError(errorMessage(err))
      }
      setDeleteTarget(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  if (!currentTeamId || !currentTeam || userId === null) {
    return (
      <div className="page logs-page">
        <EmptyState title="还没有选择团队" description="请先在右上角选择一个团队。" />
      </div>
    )
  }

  const loading = logsQuery.loading && logsQuery.data === null

  return (
    <div className="page logs-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">日记</h1>
          <p className="page-desc">
            {currentTeam.team.name} · 标准日报（今日完成 / 遇到问题 / 明日计划）
            {dateFilter === '' ? '' : ` · 只看 ${dateFilter}`}
          </p>
        </div>
        <div className="page-head-actions">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={view === 'mine'} className={view === 'mine' ? 'tab active' : 'tab'} onClick={() => setView('mine')}>
              我的
            </button>
            <button type="button" role="tab" aria-selected={view === 'team'} className={view === 'team' ? 'tab active' : 'tab'} onClick={() => setView('team')}>
              团队
            </button>
          </div>
          <Button variant="ghost" onClick={() => logsQuery.reload()} disabled={logsQuery.loading}>
            刷新
          </Button>
          <Button variant="primary" onClick={openToday}>
            {todayLog ? '编辑今日日报' : '写今日日报'}
          </Button>
        </div>
      </div>

      {notice ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="warn" onClose={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      ) : null}

      {actionError ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="error" onClose={() => setActionError(null)}>
            {actionError}
          </Banner>
        </div>
      ) : null}

      {logsQuery.error ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="error">
            <span>{logsQuery.error}</span>
            <Button size="sm" variant="ghost" onClick={logsQuery.reload}>
              重试
            </Button>
          </Banner>
        </div>
      ) : null}

      <div className="reports-container">
        <div className="filter-bar report-filters">
          <TextInput
            type="date"
            value={dateFilter}
            max={today}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label="按工作日期筛选"
          />
          {dateFilter !== '' ? (
            <Button size="sm" variant="ghost" onClick={() => setDateFilter('')}>
              清除日期
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={openCreate}>
            {dateFilter === '' ? '按所选日期补写' : `写 ${dateFilter} 的日报`}
          </Button>
          <span className="grow" />
          <span className="tiny faint nowrap">
            {view === 'mine' ? `${myLogs.length} 篇我的日报` : `${logs.length} 篇团队日报`}
            {dateFilter === '' ? '' : `，其中 ${filtered.length} 篇在所选日期`}
          </span>
        </div>

        {loading ? (
          <InlineLoading label="正在读取日报…" />
        ) : grouped.length === 0 ? (
          <EmptyState
            title={dateFilter === '' ? '还没有日报' : '这一天没有日报'}
            description={
              view === 'mine'
                ? '日报是团队同步进度的主要方式，写完会显示在仪表盘和团队视图里。'
                : '等成员写完后，这里会按日期倒序列出团队日报。'
            }
            action={
              view === 'mine' ? (
                <Button variant="primary" size="sm" onClick={openCreate}>
                  写日报
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="reports-body">
            <div className="stack">
              {grouped.map((group) => (
                <div key={group.date}>
                  <div className="report-date-heading">
                    <span style={{ fontWeight: 650 }}>{formatMonthDay(group.date)}</span>
                    <span className="tiny faint">{group.date}</span>
                    {group.date === today ? <span className="badge badge-done">今天</span> : null}
                    <span className="grow" />
                    <span className="tiny faint">{group.logs.length} 篇</span>
                  </div>
                  <div className="stack">
                    {group.logs.map((log) => {
                      const editable = canEditWorkLog(currentRole, userId, log.owner_id)
                      return (
                        <div className="card report-card" key={log.id}>
                          <div className="card-head">
                            <span className="avatar" aria-hidden="true">
                              {log.owner_name.slice(0, 1)}
                            </span>
                            <div className="grow">
                              <div style={{ fontWeight: 600 }}>{log.owner_name}</div>
                              <div className="tiny faint">
                                {log.hours == null ? '工时未填' : `工时 ${Number(log.hours)} 小时`}
                                {' · '}
                                {log.related_task_id === null
                                  ? '未关联任务'
                                  : `关联：${taskTitle.get(log.related_task_id) ?? `任务 #${log.related_task_id}`}`}
                                {' · '}
                                更新于 {formatDateTime(log.updated_at)}
                              </div>
                            </div>
                            {editable ? (
                              <div className="row" style={{ gap: 4 }}>
                                <Button size="sm" variant="ghost" onClick={() => openEdit(log)}>
                                  编辑
                                </Button>
                                <Button size="sm" variant="ghost" className="destructive-text" onClick={() => setDeleteTarget(log)}>
                                  删除
                                </Button>
                              </div>
                            ) : (
                              <span className="tiny faint nowrap">只读</span>
                            )}
                          </div>
                          <div className="card-body">
                            <div className="log-section">
                              <h4>今日完成</h4>
                              <div className="log-body">{log.done_today}</div>
                            </div>
                            {log.problems ? (
                              <div className="log-section">
                                <h4>遇到问题</h4>
                                <div className="log-body">{log.problems}</div>
                              </div>
                            ) : null}
                            <div className="log-section">
                              <h4>明日计划</h4>
                              <div className="log-body">{log.plan_tomorrow}</div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <LogDrawer
        open={drawerOpen}
        log={editing}
        defaultDate={drawerDate}
        teamId={currentTeamId}
        ownerId={userId}
        ownerName={myName}
        tasks={tasks}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          setDrawerOpen(false)
          setNotice(null)
          logsQuery.reload()
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除这篇日报？"
        description={
          <>
            <p>
              {deleteTarget?.work_date} 的日报将被删除，删除后无法恢复。
            </p>
            <p style={{ marginTop: 6 }}>如果只是想改内容，建议直接编辑。</p>
          </>
        }
        confirmText="删除"
        danger
        busy={deleteBusy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
