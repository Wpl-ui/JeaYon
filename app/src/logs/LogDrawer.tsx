/**
 * 标准日报编辑抽屉。
 *
 * 规则要点：
 *  - 今日完成 / 明日计划必填，遇到问题可空；
 *  - 工时留空表示"未填"，填了就必须是 0–24 且最多两位小数；
 *  - 每人每团队每天只能有一篇（数据库唯一约束兜底），重复时提示去编辑那一篇；
 *  - 关联任务只能是本团队未归档任务；原关联任务归档后保留关联。
 */
import { useCallback, useEffect, useState } from 'react'
import type { TaskRow, WorkLogRow } from '../types/db'
import {
  createWorkLog,
  fetchMyLogOnDate,
  updateWorkLog,
  validateDraft,
  type WorkLogDraft,
} from './api'
import { addDays, formatDateTime, isValidISODate, todayISO } from '../lib/dates'
import { errorMessage, toAppError } from '../lib/errors'
import { Banner, Button, Drawer, Field, Select, TextArea, TextInput } from '../components/ui'

function emptyDraft(date: string): WorkLogDraft {
  return {
    workDate: date,
    doneToday: '',
    problems: '',
    planTomorrow: '',
    hours: '',
    relatedTaskId: null,
  }
}

function draftFromLog(log: WorkLogRow): WorkLogDraft {
  return {
    workDate: log.work_date,
    doneToday: log.done_today,
    problems: log.problems ?? '',
    planTomorrow: log.plan_tomorrow,
    hours: log.hours == null ? '' : String(log.hours),
    relatedTaskId: log.related_task_id,
  }
}

export function LogDrawer({
  open,
  log,
  defaultDate,
  teamId,
  ownerId,
  ownerName,
  tasks,
  onClose,
  onSaved,
}: {
  open: boolean
  /** null 表示新建 */
  log: WorkLogRow | null
  defaultDate: string
  teamId: number
  ownerId: string
  ownerName: string
  tasks: TaskRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<WorkLogDraft>(() => emptyDraft(defaultDate))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictVersion, setConflictVersion] = useState<number | null>(null)
  const [conflictAt, setConflictAt] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setConflictVersion(null)
    setConflictAt(null)
    setDraft(log ? draftFromLog(log) : emptyDraft(defaultDate))
  }, [open, log, defaultDate])

  const localError = validateDraft(draft)

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
        if (log) {
          await updateWorkLog(log.id, overrideVersion ?? log.version, draft)
        } else {
          await createWorkLog(teamId, ownerName, draft)
        }
        onSaved()
      } catch (err) {
        const appError = toAppError(err)
        if (appError.code === 'conflict') {
          try {
            const latest = await fetchMyLogOnDate(teamId, ownerId, draft.workDate)
            if (latest) {
              setConflictVersion(latest.version)
              setConflictAt(formatDateTime(latest.updated_at))
            }
          } catch {
            setConflictVersion(null)
          }
          setError(appError.message)
        } else {
          setError(errorMessage(err))
        }
      } finally {
        setBusy(false)
      }
    },
    [busy, draft, localError, log, onSaved, ownerId, ownerName, teamId],
  )

  const activeTasks = tasks.filter((t) => t.archived_at === null)
  const relatedMissing =
    draft.relatedTaskId !== null && !activeTasks.some((t) => t.id === draft.relatedTaskId)

  return (
    <Drawer
      open={open}
      title={log ? '编辑日报' : '写日报'}
      subtitle={log ? `版本 ${log.version} · 更新于 ${formatDateTime(log.updated_at)}` : `署名：${ownerName}`}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={() => void runSave()} loading={busy} disabled={localError !== null}>
            保存
          </Button>
        </>
      }
    >
      <div className="stack">
        {error ? (
          <Banner kind="error" onClose={() => setError(null)}>
            <div>{error}</div>
            {conflictVersion !== null ? (
              <div style={{ marginTop: 8 }}>
                <p className="tiny">服务端已有更新的版本（版本 {conflictVersion}，更新于 {conflictAt}）。</p>
                <div className="row" style={{ marginTop: 8 }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void runSave(conflictVersion)
                    }}
                  >
                    保留我的内容并覆盖
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onSaved()
                      onClose()
                    }}
                  >
                    重新加载后再改
                  </Button>
                </div>
              </div>
            ) : null}
          </Banner>
        ) : null}

        <div className="form-grid">
          <Field label="工作日期" htmlFor="log-date" required hint="默认今天（团队时区 Asia/Shanghai）">
            <TextInput
              id="log-date"
              type="date"
              value={draft.workDate}
              max={addDays(todayISO(), 365)}
              onChange={(e) => setDraft((prev) => ({ ...prev, workDate: e.target.value }))}
            />
          </Field>

          <Field label="工时（小时）" htmlFor="log-hours" hint="可留空；0–24，最多两位小数">
            <TextInput
              id="log-hours"
              inputMode="decimal"
              placeholder="例如 8 或 7.5"
              value={draft.hours}
              onChange={(e) => setDraft((prev) => ({ ...prev, hours: e.target.value }))}
            />
          </Field>
        </div>

        <Field label="今日完成" htmlFor="log-done" required hint="必填，最多 2000 字">
          <TextArea
            id="log-done"
            value={draft.doneToday}
            maxLength={2000}
            placeholder="今天做完的事，尽量写成可核对的结果"
            style={{ minHeight: 110 }}
            onChange={(e) => setDraft((prev) => ({ ...prev, doneToday: e.target.value }))}
          />
        </Field>

        <Field label="遇到问题" htmlFor="log-problems" hint="可留空；有阻塞就写清楚卡在哪一步">
          <TextArea
            id="log-problems"
            value={draft.problems}
            maxLength={2000}
            placeholder="例如：端子压接模具到货延迟，压接验证顺延一天"
            onChange={(e) => setDraft((prev) => ({ ...prev, problems: e.target.value }))}
          />
        </Field>

        <Field label="明日计划" htmlFor="log-plan" required hint="必填，最多 2000 字">
          <TextArea
            id="log-plan"
            value={draft.planTomorrow}
            maxLength={2000}
            placeholder="明天准备推进的事项"
            style={{ minHeight: 90 }}
            onChange={(e) => setDraft((prev) => ({ ...prev, planTomorrow: e.target.value }))}
          />
        </Field>

        <Field
          label="主要关联任务"
          htmlFor="log-task"
          hint={relatedMissing ? '原关联任务已归档，关联会保留；如需更换请重新选择' : '可留空；只列出本团队未归档任务'}
        >
          <Select
            id="log-task"
            value={draft.relatedTaskId === null ? '' : String(draft.relatedTaskId)}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, relatedTaskId: e.target.value === '' ? null : Number(e.target.value) }))
            }
          >
            <option value="">不关联</option>
            {activeTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}（截止 {task.due_date}）
              </option>
            ))}
            {relatedMissing && draft.relatedTaskId !== null ? (
              <option value={String(draft.relatedTaskId)}>已归档任务 #{draft.relatedTaskId}（保留关联）</option>
            ) : null}
          </Select>
        </Field>

        {!isValidISODate(draft.workDate) ? <p className="field-error">请选择有效的工作日期</p> : null}
        {localError && !error ? <p className="field-error">{localError}</p> : null}
      </div>
    </Drawer>
  )
}
