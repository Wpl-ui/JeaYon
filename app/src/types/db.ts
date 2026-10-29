/** 数据库行类型（与云端表结构一一对应，字段名保持库内命名）。 */

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type MemberRole = 'owner' | 'admin' | 'member'

export interface TeamRow {
  id: number
  name: string
  timezone: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface TeamMemberRow {
  id: number
  team_id: number
  user_id: string
  role: MemberRole
  active: boolean
  display_name: string
  joined_at: string
  deactivated_at: string | null
}

export interface TaskRow {
  id: number
  team_id: number
  parent_id: number | null
  sort_order: number
  created_by: string
  assignee_id: string | null
  title: string
  description: string | null
  status: TaskStatus
  progress: number
  start_date: string
  due_date: string
  archived_at: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface WorkLogRow {
  id: number
  team_id: number
  owner_id: string
  owner_name: string
  work_date: string
  done_today: string
  problems: string | null
  plan_tomorrow: string
  hours: number | string | null
  related_task_id: number | null
  version: number
  created_at: string
  updated_at: string
}

/** 受控 RPC 的统一返回信封。 */
export interface RpcEnvelope<T = unknown> {
  ok: boolean
  code: RpcCode
  message: string
  data?: T
}

export type RpcCode =
  | 'ok'
  | 'forbidden'
  | 'conflict'
  | 'invalid'
  | 'already_member'
  | 'not_found'
  | 'invalid_code'
  | 'already_exists'
  /** 以下为前端补充的传输层错误码 */
  | 'network'
  | 'unauthenticated'
  | 'permission-denied'
  | 'credits-exhausted'
  | 'unknown'
