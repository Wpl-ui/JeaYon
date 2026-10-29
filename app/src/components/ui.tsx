/**
 * 共享 UI 组件。
 *
 * 全部为无样式框架的原生实现：只做结构与交互，视觉交给 `styles/global.css`。
 * 刻意不引入第三方 UI 库 —— 首版界面元素很少，自己写比引库更可控。
 */
import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import type { TaskStatus } from '../types/db'
import { statusLabel } from '../lib/progress'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled === true || loading}
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`.trim()}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className = '',
}: {
  label: string
  htmlFor?: string
  required?: boolean
  hint?: string
  error?: string | null
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="req">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field-error">{error}</p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`input ${className}`.trim()} />
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`textarea ${className}`.trim()} />
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`select ${className}`.trim()}>
      {children}
    </select>
  )
}

export function Banner({
  kind = 'info',
  children,
  onClose,
}: {
  kind?: 'info' | 'warn' | 'error' | 'success'
  children: ReactNode
  onClose?: () => void
}) {
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="grow">{children}</div>
      {onClose ? (
        <button type="button" className="banner-close" onClick={onClose} aria-label="关闭提示">
          ×
        </button>
      ) : null}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="spinner" aria-hidden="true" />
      {label ? <span className="muted tiny">{label}</span> : null}
    </span>
  )
}

export function InlineLoading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="inline-loading">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {description ? <p className="empty-desc">{description}</p> : null}
      {action}
    </div>
  )
}

/** Lightweight system-style symbols, drawn locally without an icon dependency. */
const SYMBOL_PATHS = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  tasks: <><circle cx="5" cy="6" r="2" /><circle cx="5" cy="12" r="2" /><circle cx="5" cy="18" r="2" /><path d="M11 6h10M11 12h10M11 18h7" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4M17 3v4M3 10h18M7 14h2M12 14h2M7 18h2M12 18h2" /></>,
  report: <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  'chevron-left': <path d="m14 5-7 7 7 7" />,
  'chevron-right': <path d="m10 5 7 7-7 7" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16v.1" /></>,
  progress: <><path d="M12 3a9 9 0 1 1-9 9" /><path d="M3 5v7h7" /></>,
} as const

export function SymbolIcon({ name }: { name: keyof typeof SYMBOL_PATHS }) {
  return <svg className="symbol-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{SYMBOL_PATHS[name]}</svg>
}

export function StatusGlyph({ status, overdue = false }: { status: TaskStatus; overdue?: boolean }) {
  return (
    <span
      className={`status-glyph glyph-${status}${overdue ? ' glyph-overdue' : ''}`}
      role="img"
      aria-label={overdue ? `${statusLabel(status)} · 逾期` : statusLabel(status)}
    >
      {overdue ? '!' : status === 'done' ? <SymbolIcon name="check" /> : null}
    </span>
  )
}

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const tone = (name.codePointAt(0) ?? 0) % 6
  return (
    <span className={`avatar avatar-${tone}${small ? ' avatar-sm' : ''}`} aria-hidden="true">
      {name.slice(-1) || '?'}
    </span>
  )
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const cls = status === 'todo' ? 'badge-todo' : status === 'in_progress' ? 'badge-progress' : 'badge-done'
  return <span className={`badge ${cls}`}><StatusGlyph status={status} />{statusLabel(status)}</span>
}

export function ProgressBar({
  value,
  status,
  overdue = false,
}: {
  value: number
  status: TaskStatus
  overdue?: boolean
}) {
  const cls = overdue ? 'is-overdue' : status === 'done' ? '' : status === 'todo' ? 'is-todo' : 'is-progress'
  return (
    <div className="progress" role="progressbar" aria-label="任务进度" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill ${cls}`.trim()} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

/** 右侧抽屉。`busy` 为真时禁止 Escape 关闭，避免保存中被误关。 */
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  footer,
  children,
  wide = false,
  busy = false,
}: {
  open: boolean
  title: string
  subtitle?: ReactNode
  onClose: () => void
  footer?: ReactNode
  children: ReactNode
  wide?: boolean
  busy?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [open, busy, onClose])

  if (!open) return null

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`drawer ${wide ? 'wide' : ''}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div className="grow">
            <div className="drawer-title">{title}</div>
            {subtitle ? <div className="drawer-sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

/** 居中确认框，用于不可撤销操作（移除成员、归档、删除日报）。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onCancel])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-title">{title}</div>
        {description ? <div className="modal-desc">{description}</div> : null}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 页面级的加载 / 错误占位，统一整页状态。 */
export function PageLoading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="page-loading">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="page-loading">
      <div className="card" style={{ padding: 24, maxWidth: 420 }}>
        <p style={{ fontWeight: 600, marginBottom: 6 }}>加载失败</p>
        <p className="muted tiny" style={{ marginBottom: 14 }}>
          {message}
        </p>
        {onRetry ? (
          <Button variant="primary" onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </div>
    </div>
  )
}
