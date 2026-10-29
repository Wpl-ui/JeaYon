/**
 * 仪表盘。
 *
 * 所有数字都由 `lib/stats.ts` 的纯函数从同一份任务/日报数据里算出来，
 * 因此「列表」「甘特图」「仪表盘」看到的口径完全一致，不存在各处各算一套。
 * 统计范围：当前团队的**未归档**任务 + 全团队日报。
 */
import { Link } from 'react-router-dom'
import { useTeam } from '../teams/TeamProvider'
import { useTeamQuery } from '../lib/useTeamQuery'
import { fetchTasks } from '../tasks/api'
import { fetchWorkLogs } from '../logs/api'
import { computeDashboard, DUE_SOON_DAYS, isOverdue } from '../lib/stats'
import { statusLabel } from '../lib/progress'
import { dueLabel, formatMonthDay, todayISO } from '../lib/dates'
import {
  Banner,
  Avatar,
  Button,
  EmptyState,
  InlineLoading,
  PageError,
  ProgressBar,
  Spinner,
  StatusBadge,
  StatusGlyph,
  SymbolIcon,
} from '../components/ui'
import type { TaskStatus } from '../types/db'

type DistributionStatus = TaskStatus | 'overdue'

const DISTRIBUTION_COLOR: Record<DistributionStatus, string> = {
  todo: 'var(--system-gray)',
  in_progress: 'var(--system-blue)',
  done: 'var(--system-green)',
  overdue: 'var(--system-red)',
}

const DISTRIBUTION_LABEL: Record<DistributionStatus, string> = {
  todo: statusLabel('todo'),
  in_progress: statusLabel('in_progress'),
  done: statusLabel('done'),
  overdue: '已逾期',
}

const DISTRIBUTION_ORDER: DistributionStatus[] = ['todo', 'in_progress', 'done', 'overdue']

export function DashboardPage() {
  const { currentTeamId, currentTeam, memberName, activeMembers, membersLoading, membersError } = useTeam()

  const tasksQuery = useTeamQuery(currentTeamId, fetchTasks)
  const logsQuery = useTeamQuery(currentTeamId, fetchWorkLogs)

  const today = todayISO()
  const tasks = tasksQuery.data ?? []
  const logs = logsQuery.data ?? []
  const stats = computeDashboard(tasks, logs, today)

  // 逾期任务从原状态中拆出来单列，保证四项占比相加仍为 100%。
  const distribution: Record<DistributionStatus, number> = {
    todo: 0,
    in_progress: 0,
    done: 0,
    overdue: 0,
  }
  for (const task of tasks) {
    if (task.archived_at !== null) continue
    distribution[isOverdue(task, today) ? 'overdue' : task.status] += 1
  }

  if (!currentTeamId || !currentTeam) {
    return (
      <div className="page">
        <EmptyState title="还没有选择团队" description="请先在右上角选择一个团队。" />
      </div>
    )
  }

  const loading = tasksQuery.loading && tasksQuery.data === null
  const failure = tasksQuery.error ?? logsQuery.error

  if (loading) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">看板</h1>
            <p className="page-desc">{currentTeam.team.name}</p>
          </div>
        </div>
        <div className="card">
          <InlineLoading label="正在汇总任务与日报…" />
        </div>
      </div>
    )
  }

  if (failure && tasksQuery.data === null) {
    return (
      <div className="page">
        <PageError message={failure} onRetry={tasksQuery.reload} />
      </div>
    )
  }

  const refreshedAt = new Date()
  const refreshAll = () => {
    tasksQuery.reload()
    logsQuery.reload()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="dash-greeting">{formatMonthDay(today)} · {new Date(`${today}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })}</p>
          <h1 className="page-title">看板</h1>
          <p className="dash-intro">{currentTeam.team.name} · 近 7 天有 {stats.dueSoon.length} 项任务到期{stats.overdue > 0 ? `，${stats.overdue} 项已逾期需跟进。` : '，一起从容推进。'}</p>
        </div>
        <div className="page-head-actions">
          {tasksQuery.loading || logsQuery.loading ? <Spinner label="刷新中" /> : null}
          <Button variant="ghost" onClick={refreshAll} disabled={tasksQuery.loading}>
            刷新
          </Button>
          <Link to="/logs" className="btn btn-primary">
            写日报
          </Link>
        </div>
      </div>

      {failure ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="error">
            <span>{failure}</span>
            <Button size="sm" variant="ghost" onClick={refreshAll}>
              重试
            </Button>
          </Banner>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat">
          <div className="stat-label"><span className="stat-symbol"><SymbolIcon name="tasks" /></span>任务总数</div>
          <div className="stat-value">
            {stats.total}
            <span className="stat-unit">个</span>
          </div>
          <p className="stat-note">当前团队 · 未归档任务</p>
        </div>
        <div className="stat">
          <div className="stat-label"><span className="stat-symbol"><SymbolIcon name="clock" /></span>进行中</div>
          <div className="stat-value">
            {stats.inProgress}
            <span className="stat-unit">个</span>
          </div>
          <p className="stat-note"><StatusGlyph status="in_progress" /> 正在稳步推进</p>
        </div>
        <div className="stat">
          <div className="stat-label"><span className="stat-symbol"><SymbolIcon name="check" /></span>已完成</div>
          <div className="stat-value">
            {stats.done}
            <span className="stat-unit">个</span>
          </div>
          <p className="stat-note"><StatusGlyph status="done" /> 已完成的工作</p>
        </div>
        <div className={stats.overdue > 0 ? 'stat is-alert' : 'stat'}>
          <div className="stat-label"><span className="stat-symbol"><SymbolIcon name="alert" /></span>已逾期</div>
          <div className="stat-value">
            {stats.overdue}
            <span className="stat-unit">个</span>
          </div>
          <p className="stat-note">{stats.overdue > 0 ? '需要优先关注' : '当前没有逾期任务'}</p>
        </div>
        <div className="stat">
          <div className="stat-label"><span className="stat-symbol"><SymbolIcon name="progress" /></span>平均进度</div>
          <div className="stat-value">
            {stats.avgProgress === null ? (
              <span className="stat-unit" style={{ fontSize: 15, marginLeft: 0 }}>
                暂无数据
              </span>
            ) : (
              <>
                {stats.avgProgress}
                <span className="stat-unit">%</span>
              </>
            )}
          </div>
          {stats.avgProgress !== null ? <ProgressBar value={stats.avgProgress} status="in_progress" /> : null}
        </div>
      </div>

      <div className="dash-grid">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <span className="card-title grow">状态分布</span>
              <span className="tiny faint nowrap">等权平均进度 {stats.avgProgress === null ? '—' : `${stats.avgProgress}%`}</span>
            </div>
            <div className="card-body">
              {stats.total === 0 ? (
                <EmptyState title="暂无数据" description="当前团队还没有未归档任务。" />
              ) : (
                <div>
                  <div className="distribution-summary" aria-hidden="true">
                    {DISTRIBUTION_ORDER.map((status) => (
                      <span
                        key={status}
                        style={{
                          flex: distribution[status],
                          background: DISTRIBUTION_COLOR[status],
                          display: distribution[status] === 0 ? 'none' : undefined,
                        }}
                      />
                    ))}
                  </div>
                  {DISTRIBUTION_ORDER.map((status) => {
                    const count = distribution[status]
                    if (status === 'overdue' && count === 0) return null
                    const percent = stats.total === 0 ? 0 : Math.round((count / stats.total) * 100)
                    return (
                      <div className="dist-row" key={status}>
                        <span>
                          <span className="legend-dot" style={{ background: DISTRIBUTION_COLOR[status] }} />
                          {DISTRIBUTION_LABEL[status]}
                        </span>
                        <span className="dist-num">
                          {count} · {percent}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title grow">近 {DUE_SOON_DAYS} 天到期</span>
              <span className="tiny faint nowrap">今天起 7 个自然日</span>
            </div>
            <div className="card-body-tight">
              {stats.dueSoon.length === 0 ? (
                <EmptyState title="近 7 天没有到期任务" description="已完成或已归档的任务不计入这里。" />
              ) : (
                <div>
                  {stats.dueSoon.map((task) => (
                    <div className="list-row" key={task.id}>
                      <div className="grow">
                        <div style={{ fontWeight: 550 }}>{task.title}</div>
                        <div className="tiny faint">
                          {task.assignee_id === null
                            ? '未分配'
                            : (memberName(task.assignee_id) ?? '已停用成员')}
                          {' · '}
                          <span className="invite-input">{task.due_date}</span> · {dueLabel(task.due_date, today)}
                        </div>
                      </div>
                      <StatusBadge status={task.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            {stats.dueSoon.length > 0 ? (
              <div className="card-foot">
                <Link to="/tasks" className="tiny">
                  前往任务列表调整 →
                </Link>
              </div>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title grow">今日日报</span>
            {logsQuery.data !== null && !membersLoading && !membersError ? (
              <span className="tiny muted">
                {activeMembers.filter((member) => logs.some((log) => log.owner_id === member.user_id && log.work_date === today)).length} / {activeMembers.length} 已提交
              </span>
            ) : null}
          </div>
          <div className="card-body-tight report-members">
            {membersError || (logsQuery.error && logsQuery.data === null) ? (
              <p className="muted tiny">日报提交状态暂不可用，请刷新重试。</p>
            ) : membersLoading || logsQuery.data === null ? (
              <InlineLoading label="正在读取提交状态…" />
            ) : activeMembers.map((member) => {
              const report = logs.find((log) => log.owner_id === member.user_id && log.work_date === today)
              return (
                <div className="list-row" key={member.user_id}>
                  <Avatar name={member.display_name} small />
                  <span className="grow">{member.display_name}</span>
                  <span className={`badge ${report ? 'badge-done' : 'badge-muted'}`}>
                    {report ? '已提交' : '未提交'}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="card-head">
            <span className="card-title grow">最新团队日报</span>
            {stats.latestLog ? (
              <span className="tiny faint nowrap">{stats.latestLog.work_date}</span>
            ) : null}
          </div>
          <div className="card-body">
            {stats.latestLog === null ? (
              <EmptyState
                title="还没有团队日报"
                description="写第一篇日报后，这里会显示团队最新的工作记录。"
                action={
                  <Link to="/logs" className="btn btn-primary btn-sm">
                    去写日报
                  </Link>
                }
              />
            ) : (
              <div>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className="avatar" aria-hidden="true">
                    {stats.latestLog.owner_name.slice(0, 1)}
                  </span>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{stats.latestLog.owner_name}</div>
                    <div className="tiny faint">
                      {formatMonthDay(stats.latestLog.work_date)}
                      {stats.latestLog.hours == null ? ' · 工时未填' : ` · 工时 ${stats.latestLog.hours} 小时`}
                    </div>
                  </div>
                </div>
                <div className="log-section">
                  <h4>今日完成</h4>
                  <div className="log-body">{stats.latestLog.done_today}</div>
                </div>
                {stats.latestLog.problems ? (
                  <div className="log-section">
                    <h4>遇到问题</h4>
                    <div className="log-body">{stats.latestLog.problems}</div>
                  </div>
                ) : null}
                <div className="log-section">
                  <h4>明日计划</h4>
                  <div className="log-body">{stats.latestLog.plan_tomorrow}</div>
                </div>
              </div>
            )}
          </div>
          <div className="card-foot">
            <div className="row">
              <Link to="/logs" className="tiny">
                查看团队日报 →
              </Link>
              <span className="grow" />
              <span className="tiny faint nowrap">刷新于 {refreshedAt.toLocaleTimeString('zh-CN', { hour12: false })}</span>
            </div>
          </div>
        </div>
      </div>

      {stats.overdue > 0 ? (
        <div style={{ marginTop: 24 }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title grow">逾期任务</span>
              <span className="badge badge-overdue">{stats.overdue} 个</span>
            </div>
            <div className="card-body-tight">
              {tasks
                .filter((task) => isOverdue(task, today))
                .sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
                .map((task) => (
                  <div className="list-row" key={task.id}>
                    <StatusGlyph status={task.status} overdue />
                    <div className="grow">
                      <div style={{ fontWeight: 550 }}>{task.title}</div>
                      <div className="tiny faint">
                        截止 <span className="invite-input">{task.due_date}</span> · {dueLabel(task.due_date, today)}
                        {' · '}
                        {task.assignee_id === null ? '未分配' : (memberName(task.assignee_id) ?? '已停用成员')}
                      </div>
                    </div>
                    <div style={{ width: 110 }}>
                      <ProgressBar value={task.progress} status={task.status} overdue />
                    </div>
                    <span className="progress-num">{task.progress}%</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
