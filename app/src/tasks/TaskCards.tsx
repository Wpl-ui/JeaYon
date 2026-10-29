import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Avatar, Button, ProgressBar, StatusGlyph } from '../components/ui'
import { diffDays, formatDateTime, type ISODate } from '../lib/dates'
import { isOverdue } from '../lib/stats'
import { statusLabel } from '../lib/progress'
import type { TaskRow, TaskStatus } from '../types/db'

type CardProps = {
  task: TaskRow
  today: ISODate
  assignee: string
  archived: boolean
  restoring: boolean
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
}

type ParentProps = CardProps & {
  childCount: number
  doneCount: number
  expanded: boolean
  onToggle: () => void
  onCreateChild: () => void
}

export function ParentTaskCard({ childCount, doneCount, expanded, onToggle, onCreateChild, ...props }: ParentProps) {
  const { task, today, onEdit } = props
  const hasKids = childCount > 0
  return (
    <TaskCard {...props}
      summary={hasKids ? `${doneCount}/${childCount} · ${task.progress}%` : `${task.progress}%`}
      detail={`${statusLabel(task.status)}${hasKids ? ' · 状态由子任务决定' : ''}`}
      leading={
        <button className="task-open-glyph" onClick={onEdit} aria-hidden="true" tabIndex={-1}>
          <StatusGlyph status={task.status} overdue={isOverdue(task, today)} />
        </button>
      }
      trailing={<>
        {hasKids ? (
          <button type="button" className="task-count-capsule" aria-expanded={expanded}
            aria-label={`${expanded ? '收起' : '展开'}子任务：${task.title}，已完成 ${doneCount}/${childCount}`}
            onClick={event => {
              if (expanded) event.currentTarget.focus()
              onToggle()
            }}>
            <span aria-hidden="true" className="task-count-triangle">▾</span>
            {doneCount}/{childCount}
          </button>
        ) : null}
        <ProgressBar value={task.progress} status={task.status} overdue={isOverdue(task, today)} />
      </>}
      extraAction={!props.archived ? <Button size="sm" variant="ghost" onClick={onCreateChild}>子任务</Button> : null}
      archiveDisabled={hasKids}
    />
  )
}

type ChildProps = CardProps & {
  completing: boolean
  dragging: boolean
  dropTarget: boolean
  dragHandleProps: ButtonHTMLAttributes<HTMLButtonElement>
  onComplete: (done: boolean) => void
}

export function ChildTaskCard({ completing, dragging, dropTarget, dragHandleProps, onComplete, ...props }: ChildProps) {
  const done = props.task.status === 'done'
  const summary = done ? '已完成' : '未完成'
  return (
    <TaskCard {...props} summary={summary} detail={summary}
      className={`task-child${dragging ? ' task-dragging' : ''}${dropTarget ? ' task-drop-target' : ''}`}
      leading={!props.archived ? <>
        <button type="button" className="task-drag-handle" {...dragHandleProps}
          aria-label={`调整子任务顺序：${props.task.title}`} title="拖拽调序；也可用上下方向键">
          <span aria-hidden="true">⠿</span>
        </button>
        <label className="task-check" title={done ? '标为未完成' : '标为完成'}>
          <input type="checkbox" checked={done} disabled={completing}
            onChange={event => onComplete(event.target.checked)}
            aria-label={`${done ? '取消完成' : '完成'}：${props.task.title}`} />
        </label>
      </> : (
        <button className="task-open-glyph" onClick={props.onEdit} aria-hidden="true" tabIndex={-1}>
          <StatusGlyph status={props.task.status} overdue={isOverdue(props.task, props.today)} />
        </button>
      )}
    />
  )
}

function TaskCard({ task, today, assignee, archived, restoring, onEdit, onArchive, onRestore,
  leading, trailing, extraAction, summary, detail, className = '', archiveDisabled = false,
}: CardProps & {
  leading: ReactNode
  trailing?: ReactNode
  extraAction?: ReactNode
  summary: string
  detail: string
  className?: string
  archiveDisabled?: boolean
}) {
  const overdue = isOverdue(task, today)
  const description = task.description?.trim()
  return (
    <div className={`reminder-row task-card${overdue ? ' task-overdue' : ''} ${className}`}>
      {leading}
      <button className="task-open" onClick={onEdit} aria-label={`编辑任务：${task.title}`}>
        <span className="task-content">
          <span className="task-title">{task.title}</span>
          {description && description !== task.title.trim() ? <span className="task-description">{description}</span> : null}
          <span className="task-meta">
            <span className="assignee"><Avatar name={assignee} small />{assignee}</span>
            <span aria-hidden="true">·</span>
            <span className={overdue ? 'overdue-text' : ''}>{task.due_date} · {dueHint(task.due_date, today, task.status)}</span>
            <span aria-hidden="true">·</span>
            <span>{summary}</span>
          </span>
          <span className="task-detail">
            {detail} · {task.start_date} 开始 · {archived ? '归档于' : '更新于'} {formatDateTime(archived ? task.archived_at : task.updated_at)}
          </span>
        </span>
      </button>
      <div className="task-trailing">
        {trailing}
        <div className="task-actions">
          <Button size="sm" variant="ghost" onClick={onEdit}>编辑</Button>
          {extraAction}
          {archived ? (
            <Button size="sm" variant="ghost" loading={restoring} onClick={onRestore}>恢复</Button>
          ) : (
            <Button size="sm" variant="ghost" className="destructive-text" onClick={onArchive} disabled={archiveDisabled}>归档</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function dueHint(due: ISODate, today: ISODate, status: TaskStatus): string {
  if (status === 'done') return statusLabel(status)
  const delta = diffDays(today, due)
  if (delta === 0) return '今天截止'
  if (delta > 0) return `还有 ${delta} 天`
  return `逾期 ${-delta} 天`
}
