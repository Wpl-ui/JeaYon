/**
 * 任务列表。
 *
 * 数据只来自服务端：排序乐观更新，失败回滚；其他写操作完成后重新查询。
 * 归档任务不物理删除，只是退出常规列表与甘特图，历史日报仍可看到关联。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useTeam } from '../teams/TeamProvider'
import { useTeamQuery } from '../lib/useTeamQuery'
import { fetchArchivedTasks, fetchTasks, reorderChildren, setTaskArchived, setTaskComplete } from './api'
import { TaskDrawer } from './TaskDrawer'
import { ChildTaskCard, ParentTaskCard } from './TaskCards'
import { taskColor } from './appearance'
import { childTasks, flattenTaskTree, hasActiveChildren, moveChild } from './hierarchy'
import { collapseKey, readCollapsed, writeCollapsed, type CollapsedTasks } from './collapse'
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  InlineLoading,
  SymbolIcon,
  TextInput,
} from '../components/ui'
import { todayISO } from '../lib/dates'
import { errorMessage, isSessionExpired, toAppError } from '../lib/errors'
import type { TaskRow, TaskStatus } from '../types/db'

type Scope = 'active' | 'archived'
type StatusFilter = 'all' | TaskStatus
type AssigneeFilter = 'all' | 'unassigned' | string

export function TasksPage() {
  const { expireSession, dataEpoch } = useAuth()
  const { currentTeamId, currentTeam, members, memberName, reloadMembers } = useTeam()

  const [scope, setScope] = useState<Scope>('active')
  const activeQuery = useTeamQuery(currentTeamId, fetchTasks)
  const archivedQuery = useTeamQuery(currentTeamId, fetchArchivedTasks, { enabled: scope === 'archived' })

  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<TaskRow | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<TaskRow | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [restoringId, setRestoringId] = useState<number | null>(null)
  const [completingId, setCompletingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<CollapsedTasks>(() => {
    try { return readCollapsed(window.sessionStorage) } catch { return {} }
  })
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [pendingOrder, setPendingOrder] = useState<{ teamId: number; epoch: number; children: TaskRow[] } | null>(null)
  const reorderBusy = useRef(false)
  const context = useRef({ teamId: currentTeamId, epoch: dataEpoch, mounted: true })
  context.current.teamId = currentTeamId
  context.current.epoch = dataEpoch
  useEffect(() => {
    context.current.mounted = true
    return () => { context.current.mounted = false }
  }, [])
  useEffect(() => {
    try { writeCollapsed(window.sessionStorage, collapsed) } catch { /* Storage disabled. */ }
  }, [collapsed])

  const today = todayISO()
  const query = scope === 'active' ? activeQuery : archivedQuery
  const ordering = scope === 'active' && pendingOrder?.teamId === currentTeamId && pendingOrder.epoch === dataEpoch ? pendingOrder : null
  const rows = useMemo(() => {
    const saved = query.data ?? []
    if (!ordering) return saved
    const optimistic = new Map(ordering.children.map(child => [child.id, child]))
    return saved.map(task => optimistic.get(task.id) ?? task)
  }, [query.data, ordering])

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    const matched = rows.filter((task) => {
      if (text) {
        const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase()
        if (!haystack.includes(text)) return false
      }
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (assigneeFilter === 'unassigned' && task.assignee_id !== null) return false
      if (assigneeFilter !== 'all' && assigneeFilter !== 'unassigned' && task.assignee_id !== assigneeFilter) return false
      return true
    })
    // Keep matching children's parents visible so a collapsed result can be expanded.
    const parentIds = new Set(matched.map(task => task.parent_id).filter(id => id != null))
    const matchedIds = new Set(matched.map(task => task.id))
    return flattenTaskTree(rows.filter(task => matchedIds.has(task.id) || parentIds.has(task.id)))
  }, [rows, keyword, statusFilter, assigneeFilter])

  const visible = filtered.filter(task => task.parent_id == null || !currentTeamId ||
    !collapsed[collapseKey(currentTeamId, task.parent_id)])

  function toggleParent(parentId: number) {
    if (!currentTeamId) return
    const key = collapseKey(currentTeamId, parentId)
    setCollapsed(previous => {
      const next = { ...previous }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  async function handleReorder(sourceId: number, targetId: number) {
    if (!currentTeamId || scope !== 'active' || query.loading || reorderBusy.current) return
    const children = moveChild(rows, sourceId, targetId)
    if (!children) return
    const teamId = currentTeamId
    const epoch = dataEpoch
    const isCurrent = () => context.current.mounted && context.current.teamId === teamId && context.current.epoch === epoch
    reorderBusy.current = true
    setActionError(null)
    setPendingOrder({ teamId, epoch, children })
    try {
      const saved = await reorderChildren(children[0].parent_id!, children)
      if (!isCurrent()) return
      const byId = new Map(saved.map(child => [child.id, child]))
      activeQuery.mutate(previous => previous?.map(task => byId.get(task.id) ?? task) ?? null)
      activeQuery.reload()
    } catch (err) {
      if (!isCurrent()) return
      if (isSessionExpired(err)) expireSession(errorMessage(err))
      else setActionError(toAppError(err).code === 'conflict'
        ? '子任务已被他人修改，排序未保存，已回滚并重新加载。'
        : `排序未保存，已回滚。${errorMessage(err)}`)
      activeQuery.reload()
    } finally {
      reorderBusy.current = false
      if (context.current.mounted) setPendingOrder(null)
    }
  }

  const [createParentId, setCreateParentId] = useState<number | null>(null)

  function openCreate(parentId: number | null = null) {
    setEditing(null)
    setCreateParentId(parentId)
    setDrawerOpen(true)
  }

  function openEdit(task: TaskRow) {
    setEditing(task)
    setCreateParentId(null)
    setDrawerOpen(true)
  }

  function refreshAll() {
    activeQuery.reload()
    if (scope === 'archived') archivedQuery.reload()
  }

  async function handleArchive() {
    if (!archiveTarget || archiveBusy) return
    setArchiveBusy(true)
    setActionError(null)
    try {
      await setTaskArchived(archiveTarget.id, archiveTarget.version, true)
      setArchiveTarget(null)
      refreshAll()
    } catch (err) {
      const appError = toAppError(err)
      if (appError.code === 'conflict') {
        setActionError('该任务已被他人修改，已重新加载最新状态，请确认后再归档。')
        refreshAll()
      } else if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
      } else {
        setActionError(errorMessage(err))
      }
      setArchiveTarget(null)
    } finally {
      setArchiveBusy(false)
    }
  }

  async function handleRestore(task: TaskRow) {
    if (restoringId !== null) return
    setRestoringId(task.id)
    setActionError(null)
    try {
      await setTaskArchived(task.id, task.version, false)
      archivedQuery.reload()
      activeQuery.reload()
    } catch (err) {
      const appError = toAppError(err)
      if (appError.code === 'conflict') {
        setActionError('该任务已被他人修改，已重新加载最新状态。')
        archivedQuery.reload()
      } else if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
      } else {
        setActionError(errorMessage(err))
      }
    } finally {
      setRestoringId(null)
    }
  }

  async function handleComplete(task: TaskRow, done: boolean) {
    if (completingId !== null || scope !== 'active') return
    setCompletingId(task.id)
    setActionError(null)
    try {
      await setTaskComplete(task.id, task.version, done)
      refreshAll()
    } catch (err) {
      const appError = toAppError(err)
      if (appError.code === 'conflict') {
        setActionError('该任务已被他人修改，已重新加载最新状态。')
        refreshAll()
      } else if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
      } else {
        setActionError(errorMessage(err))
      }
    } finally {
      setCompletingId(null)
    }
  }


  if (!currentTeamId || !currentTeam) {
    return (
      <div className="page">
        <EmptyState title="还没有选择团队" description="请先在右上角选择一个团队。" />
      </div>
    )
  }

  const teamId = currentTeamId

  function renderTask(task: TaskRow): ReactNode {
    const assignee = task.assignee_id ? (memberName(task.assignee_id) ?? '已停用成员') : '未分配'
    const isChild = task.parent_id != null
    const parentHasKids = !isChild && hasActiveChildren(rows, task.id)
    const kids = parentHasKids ? childTasks(rows, task.id).filter(t => t.archived_at === null) : []
    const doneCount = kids.filter((t) => t.status === 'done').length
    const expanded = !collapsed[collapseKey(teamId, task.id)]
    const childCollapsed = isChild && !!collapsed[collapseKey(teamId, task.parent_id!)]
    const canDrag = isChild && !childCollapsed && scope === 'active' && !query.loading && !ordering
    const dragSource = rows.find(row => row.id === draggingId)
    const validDrop = canDrag && dragSource?.parent_id === task.parent_id && draggingId !== task.id
    const cardProps = {
      task, today, assignee, archived: scope === 'archived', restoring: restoringId === task.id,
      onEdit: () => openEdit(task), onArchive: () => setArchiveTarget(task),
      onRestore: () => void handleRestore(task),
    }
    return (
      <li key={task.id} data-task-id={task.id} data-task-color={taskColor(task.id)}
        className="task-list-item"
        aria-hidden={childCollapsed || undefined} inert={childCollapsed}
        onDragOver={event => {
          if (!validDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropTargetId(task.id)
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(null)
        }}
        onDrop={event => {
          event.preventDefault()
          if (validDrop && draggingId != null) void handleReorder(draggingId, task.id)
          setDraggingId(null)
          setDropTargetId(null)
        }}>
        {isChild ? (
          <ChildTaskCard {...cardProps} completing={completingId === task.id}
            dragging={draggingId === task.id} dropTarget={dropTargetId === task.id}
            onComplete={done => void handleComplete(task, done)}
            dragHandleProps={{
              draggable: canDrag, disabled: !canDrag,
              onDragStart: event => {
                if (!canDrag) { event.preventDefault(); return }
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', String(task.id))
                setDraggingId(task.id)
              },
              onDragEnd: () => { setDraggingId(null); setDropTargetId(null) },
              onKeyDown: event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                const siblings = childTasks(rows, task.parent_id!)
                const index = siblings.findIndex(child => child.id === task.id)
                const target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)]
                if (target) void handleReorder(task.id, target.id)
              }
            }} />
        ) : (
          <ParentTaskCard {...cardProps} childCount={kids.length} doneCount={doneCount}
            expanded={expanded} onToggle={() => toggleParent(task.id)} onCreateChild={() => openCreate(task.id)} />
        )}
        {!isChild && filtered.some(child => child.parent_id === task.id) ? (
          <div className={`task-child-collapse${expanded ? '' : ' is-collapsed'}`}
            aria-hidden={!expanded || undefined} inert={!expanded}>
            <div className="task-child-collapse-inner">
              <ul className="task-list task-child-list" aria-label={`子任务：${task.title}`}>
                {filtered.filter(child => child.parent_id === task.id).map(renderTask)}
              </ul>
            </div>
          </div>
        ) : null}
      </li>
    )
  }

  const hasFilter = keyword.trim() !== '' || statusFilter !== 'all' || assigneeFilter !== 'all'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">待办</h1>
          <p className="page-desc">
            {currentTeam.team.name} · {rows.length} 个{scope === 'active' ? '未归档' : '已归档'}任务
            {rows.length > 0 ? `，当前显示 ${visible.length} 个` : ''}
          </p>
        </div>
        <div className="page-head-actions">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'active'}
              className={scope === 'active' ? 'tab active' : 'tab'}
              onClick={() => setScope('active')}
            >
              进行中与待办
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'archived'}
              className={scope === 'archived' ? 'tab active' : 'tab'}
              onClick={() => setScope('archived')}
            >
              已归档
            </button>
          </div>
          <Button variant="ghost" onClick={refreshAll} disabled={query.loading}>
            刷新
          </Button>
          <Button variant="primary" onClick={() => openCreate()}>
            新建任务
          </Button>
        </div>
      </div>

      {actionError ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="error" onClose={() => setActionError(null)}>
            {actionError}
          </Banner>
        </div>
      ) : null}

      {query.error ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="error">
            <span>{query.error}</span>
            <Button size="sm" variant="ghost" onClick={query.reload}>
              重试
            </Button>
          </Banner>
        </div>
      ) : null}

      <div className="card task-list-card">
        <div className="filter-bar task-filters">
          <div className="search-field">
            <SymbolIcon name="search" />
            <TextInput
              type="search"
              aria-label="搜索任务标题或描述"
              placeholder="搜索标题或描述"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <select className="select" aria-label="按状态筛选" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">全部状态</option>
            <option value="todo">未开始</option>
            <option value="in_progress">进行中</option>
            <option value="done">已完成</option>
          </select>
          <select
            className="select"
            aria-label="按负责人筛选"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          >
            <option value="all">全部负责人</option>
            <option value="unassigned">未分配</option>
            {members
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
          </select>
          {hasFilter ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setKeyword('')
                setStatusFilter('all')
                setAssigneeFilter('all')
              }}
            >
              清除筛选
            </Button>
          ) : null}
          <span className="grow" />
          <span className="tiny faint nowrap task-filter-note">截止 {today} 之前未完成视为逾期</span>
        </div>

        {query.loading && rows.length === 0 ? (
          <InlineLoading label="正在读取任务…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={hasFilter ? '没有符合条件的任务' : scope === 'active' ? '还没有任务' : '没有已归档的任务'}
            description={
              hasFilter
                ? '换个关键词或放宽筛选条件试试。'
                : scope === 'active'
                  ? '新建第一个任务后，它会出现在任务列表与甘特图中。'
                  : '归档的任务会出现在这里，可随时恢复。'
            }
            action={
              !hasFilter && scope === 'active' ? (
                <Button variant="primary" size="sm" onClick={() => openCreate()}>
                  新建任务
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="task-list" aria-label={scope === 'active' ? '任务列表' : '已归档任务'}>
            {filtered.filter(task => task.parent_id == null || !filtered.some(parent => parent.id === task.parent_id)).map(renderTask)}
          </ul>
        )}
      </div>

      <TaskDrawer
        open={drawerOpen}
        task={editing}
        teamId={currentTeamId}
        members={members}
        allTasks={rows}
        parentId={editing ? editing.parent_id : createParentId}
        onClose={() => { setDrawerOpen(false); setCreateParentId(null) }}
        onSaved={() => {
          setDrawerOpen(false)
          setCreateParentId(null)
          refreshAll()
          // 任务里可能有未分配/负责人变化，重拉成员不影响，但保持成员列表新鲜
          void reloadMembers()
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title="归档这个任务？"
        description={
          <>
            <p>「{archiveTarget?.title}」将退出任务列表与甘特图。</p>
            <p style={{ marginTop: 6 }}>归档不会删除记录：历史日报与它的关联仍然可以看到，之后也可以恢复。含子任务的父任务需先归档或处理完子任务。</p>
          </>
        }
        confirmText="归档"
        busy={archiveBusy}
        onConfirm={() => void handleArchive()}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  )
}

