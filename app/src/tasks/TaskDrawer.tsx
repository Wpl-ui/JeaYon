/**
 * 任务新建 / 编辑抽屉。
 *
 * 两个容易出错的点在这里集中处理：
 *  1. 状态与进度必须始终保持一致（0/1–99/100），由 `lib/progress` 统一推导；
 *  2. 保存带版本号，服务端发现被别人改过会返回 `conflict`：
 *     此时**不覆盖**、**不丢用户输入**，而是拉到最新版本让用户决定是否继续。
 */
import { useCallback, useEffect, useState } from 'react'
import type { TaskRow, TaskStatus, TeamMemberRow } from '../types/db'
import { createTask, fetchTask, fetchTaskLogs, updateTask, setTaskComplete, validateDraft, type TaskDraft } from './api'
import { childTasks, hasActiveChildren } from './hierarchy'
import { withProgress, withStatus } from '../lib/progress'
import { isValidISODate, todayISO, addDays, formatDateTime } from '../lib/dates'
import { errorMessage, toAppError } from '../lib/errors'
import { Banner, Button, Drawer, Field, Select, TextArea, TextInput } from '../components/ui'

interface TaskLogItem {
  id: number
  owner_id: string
  owner_name: string
  work_date: string
  done_today: string
  version: number
}

function emptyDraft(): TaskDraft {
  const today = todayISO()
  return {
    title: '',
    description: '',
    assigneeId: null,
    status: 'todo',
    progress: 0,
    startDate: today,
    dueDate: addDays(today, 6),
  }
}

function draftFromTask(task: TaskRow): TaskDraft {
  return {
    title: task.title,
    description: task.description ?? '',
    assigneeId: task.assignee_id,
    status: task.status,
    progress: task.progress,
    startDate: task.start_date,
    dueDate: task.due_date,
  }
}

export function TaskDrawer({
  open,
  task,
  teamId,
  members,
  allTasks = [],
  parentId = null,
  onClose,
  onSaved,
}: {
  open: boolean
  /** null 表示新建 */
  task: TaskRow | null
  teamId: number
  members: TeamMemberRow[]
  /** Active (or current-scope) tasks — used to detect children / label parent. */
  allTasks?: TaskRow[]
  /** When creating, attach as child of this parent. */
  parentId?: number | null
  onClose: () => void
  onSaved: (mode: 'create' | 'update') => void
}) {
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<TaskRow | null>(null)
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [logs, setLogs] = useState<TaskLogItem[] | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)

  // 打开时重置表单：编辑以服务端行为准，绝不复用上一次的残留状态
  useEffect(() => {
    if (!open) return
    setError(null)
    setConflict(null)
    setLogs(null)
    if (task) {
      setDraft(draftFromTask(task))
      setBaseVersion(task.version)
    } else {
      setDraft(emptyDraft())
      setBaseVersion(null)
    }
  }, [open, task])

  // 编辑时展示该任务的关联日报（归档任务的历史关联同样可见）
  useEffect(() => {
    if (!open || !task) return
    let cancelled = false
    setLogsLoading(true)
    void fetchTaskLogs(teamId, task.id)
      .then((rows) => {
        if (!cancelled) setLogs(rows)
      })
      .catch(() => {
        if (!cancelled) setLogs([])
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, task, teamId])

  const localError = validateDraft(draft)

  function patch(next: Partial<TaskDraft>) {
    setDraft((prev) => ({ ...prev, ...next }))
  }

  function handleStatusChange(status: TaskStatus) {
    setDraft((prev) => {
      const next = withStatus({ status: prev.status, progress: prev.progress }, status)
      return { ...prev, status: next.status, progress: next.progress }
    })
  }

  function handleProgressChange(progress: number) {
    setDraft((prev) => {
      const next = withProgress({ status: prev.status, progress: prev.progress }, progress)
      return { ...prev, status: next.status, progress: next.progress }
    })
  }

  const runSave = useCallback(
    async (overrideVersion?: number) => {
      if (busy) return
      if (localError) {
        setError(localError)
        return
      }
      setBusy(true)
      setError(null)
      try {
        if (task && baseVersion !== null) {
          const child = task.parent_id != null
          let version = overrideVersion ?? baseVersion
          // Child completion only via /complete (contract).
          if (child && (draft.status === 'done') !== (task.status === 'done')) {
            const saved = await setTaskComplete(task.id, version, draft.status === 'done')
            version = saved.version
          }
          await updateTask(task.id, version, {
            ...draft,
            parentId: task.parent_id ?? parentId ?? null,
            // status in body ignored for children; for parents must match derived
            status: child ? (draft.status === 'done' ? 'done' : 'todo') : draft.status,
            progress: child ? (draft.status === 'done' ? 100 : 0) : draft.progress,
          })
          onSaved('update')
        } else {
          const childCreate = parentId != null
          await createTask(teamId, {
            ...draft,
            parentId: parentId ?? null,
            status: childCreate ? (draft.status === 'done' ? 'done' : 'todo') : draft.status,
            progress: childCreate ? (draft.status === 'done' ? 100 : 0) : draft.progress,
          })
          // New child created done → create as todo then complete, or create with done via binaryChild on server
          onSaved('create')
        }
      } catch (err) {
        const appError = toAppError(err)
        if (appError.code === 'conflict') {
          // 版本冲突：保留输入，拉最新版本给用户确认
          try {
            const latest = await fetchTask(task?.id ?? -1)
            setConflict(latest)
          } catch {
            setConflict(null)
          }
          setError(appError.message)
        } else {
          setError(errorMessage(err))
        }
      } finally {
        setBusy(false)
      }
    },
    [baseVersion, busy, draft, localError, onSaved, parentId, task, teamId],
  )

  const activeMembers = members.filter((m) => m.active)
  const assigneeMissing =
    draft.assigneeId !== null && !activeMembers.some((m) => m.user_id === draft.assigneeId)
  const kids = task != null ? childTasks(allTasks, task.id) : []
  const isParentContainer = task != null && hasActiveChildren(allTasks, task.id)
  const isChild = parentId != null || (task != null && task.parent_id != null)
  const parentLabel = parentId != null ? allTasks.find((t) => t.id === parentId)?.title : null
  const doneCount = kids.filter((k) => k.status === 'done').length

  return (
    <Drawer
      open={open}
      title={task ? '编辑任务' : parentId ? '新建子任务' : '新建任务'}
      subtitle={task ? `#${task.id} · 版本 ${task.version} · 更新于 ${formatDateTime(task.updated_at)}` : parentLabel ? `隶属于「${parentLabel}」` : '任务会立即出现在任务列表与甘特图中'}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <span className="tiny faint grow">
            {isParentContainer
              ? '父任务状态与进度完全由子任务完成数决定'
              : isChild
                ? '子任务只需标记完成 / 未完成'
                : draft.status === 'in_progress'
                  ? '进行中任务的进度保持在 1–99%'
                  : null}
          </span>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => void runSave()}
            loading={busy}
            disabled={localError !== null || assigneeMissing || (conflict !== null && baseVersion === null)}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? (
          <Banner kind="error" onClose={() => setError(null)}>
            <div>{error}</div>
            {conflict ? (
              <div style={{ marginTop: 8 }}>
                <p className="tiny">
                  服务端当前版本 {conflict.version}：{conflict.title} · {conflict.start_date} ~ {conflict.due_date} ·{' '}
                  {conflict.progress}%
                </p>
                <div className="row" style={{ marginTop: 8 }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setBaseVersion(conflict.version)
                      setConflict(null)
                      setError(null)
                    }}
                  >
                    保留我的输入并重试
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDraft(draftFromTask(conflict))
                      setBaseVersion(conflict.version)
                      setConflict(null)
                      setError(null)
                    }}
                  >
                    放弃我的修改，改用最新版本
                  </Button>
                </div>
              </div>
            ) : null}
          </Banner>
        ) : null}

        <Field label="标题" htmlFor="task-title" required>
          <TextInput
            id="task-title"
            value={draft.title}
            maxLength={120}
            placeholder="例如：完成端子压接工艺卡评审"
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>

        <Field label="描述" htmlFor="task-desc" hint="可留空；最多 2000 字">
          <TextArea
            id="task-desc"
            value={draft.description}
            maxLength={2000}
            placeholder="补充背景、验收标准等"
            onChange={(e) => patch({ description: e.target.value })}
          />
        </Field>

        <div className="form-grid">
          <Field label="负责人" htmlFor="task-assignee" hint={assigneeMissing ? '该成员已不在团队中，请重新选择' : '可留空（未分配）'}>
            <Select
              id="task-assignee"
              value={draft.assigneeId ?? ''}
              onChange={(e) => patch({ assigneeId: e.target.value === '' ? null : e.target.value })}
            >
              <option value="">未分配</option>
              {activeMembers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </Select>
          </Field>

          {isParentContainer ? (
            <Field label="状态与进度" className="span-2" hint="不可自定义：完成数 / 子任务数">
              <p className="tiny" style={{ margin: 0 }}>
                {draft.status === 'done' ? '已完成' : draft.status === 'in_progress' ? '进行中' : '未开始'}
                {' · '}
                {doneCount}/{kids.length} 子任务完成 · {draft.progress}%
              </p>
            </Field>
          ) : isChild ? (
            <Field label="完成" htmlFor="task-done" className="span-2" hint="子任务只有完成 / 未完成">
              <label className="row" style={{ gap: 10, alignItems: 'center' }} htmlFor="task-done">
                <input
                  id="task-done"
                  type="checkbox"
                  checked={draft.status === 'done'}
                  onChange={(e) => handleStatusChange(e.target.checked ? 'done' : 'todo')}
                />
                <span>{draft.status === 'done' ? '已完成' : '未完成'}</span>
              </label>
            </Field>
          ) : (
            <>
              <Field label="状态" htmlFor="task-status" hint="状态与进度会自动保持一致">
                <Select id="task-status" value={draft.status} onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}>
                  <option value="todo">未开始（0%）</option>
                  <option value="in_progress">进行中（1–99%）</option>
                  <option value="done">已完成（100%）</option>
                </Select>
              </Field>
              <Field label={`进度 ${draft.progress}%`} htmlFor="task-progress" className="span-2">
                <input
                  id="task-progress"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={draft.progress}
                  onChange={(e) => handleProgressChange(Number(e.target.value))}
                />
              </Field>
            </>
          )}

          <Field label="开始日期" htmlFor="task-start" required>
            <TextInput
              id="task-start"
              type="date"
              value={draft.startDate}
              onChange={(e) => patch({ startDate: e.target.value })}
            />
          </Field>

          <Field
            label="截止日期"
            htmlFor="task-due"
            required
            error={isValidISODate(draft.startDate) && isValidISODate(draft.dueDate) && draft.dueDate < draft.startDate ? '截止日期不能早于开始日期' : null}
          >
            <TextInput
              id="task-due"
              type="date"
              value={draft.dueDate}
              onChange={(e) => patch({ dueDate: e.target.value })}
            />
          </Field>
        </div>

        {task && kids.length > 0 ? (
          <div className="card">
            <div className="card-head">
              <span className="card-title">子任务</span>
              <span className="faint tiny">{doneCount}/{kids.length} 完成</span>
            </div>
            <div className="card-body-tight">
              {kids.map((child) => (
                <div className="list-row" key={child.id}>
                  <span className="tiny grow">{child.title}</span>
                  <span className="tiny faint nowrap">{child.status === 'done' ? '已完成' : '未完成'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {task ? (
          <div className="card">
            <div className="card-head">
              <span className="card-title">关联日报</span>
              <span className="faint tiny">{logs ? `${logs.length} 篇` : ''}</span>
            </div>
            <div className="card-body-tight">
              {logsLoading ? (
                <p className="tiny faint" style={{ padding: '10px 0' }}>
                  正在读取…
                </p>
              ) : !logs || logs.length === 0 ? (
                <p className="tiny faint" style={{ padding: '10px 0' }}>
                  还没有日报关联到该任务。写日报时可以选一个主要关联任务。
                </p>
              ) : (
                logs.map((log) => (
                  <div className="list-row" key={log.id}>
                    <span className="tiny faint nowrap">{log.work_date}</span>
                    <span className="tiny nowrap">{log.owner_name}</span>
                    <span className="tiny muted grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.done_today}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Drawer>
  )
}
