/**
 * 权限判定（仅用于决定界面显隐与按钮可用性）。
 *
 * ⚠️ 这不是安全边界。真正的授权在服务端：
 *  - 表级：`GRANT` 只给 `tasks` / `work_logs` 的 SELECT+INSERT，`team_invites` 零权限；
 *  - 行级：RLS 策略按 `team_role(team_id)` 与 `auth.uid()` 判定；
 *  - 动作级：所有写操作走 `SECURITY DEFINER` RPC，用 `auth.uid()` 重新校验角色。
 * 因此即使有人改前端或直接调 API，也只会被服务端拒绝。
 */
import type { MemberRole, TeamMemberRow } from '../types/db'

/** 能否查看 / 重置邀请码：owner 与 admin。 */
export function canManageInviteCode(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'admin'
}

/** 能否变更成员角色：仅 owner（且不能改自己、不能改 owner）。 */
export function canChangeRoles(role: MemberRole | null): boolean {
  return role === 'owner'
}

/**
 * 能否移除某个成员。
 * - owner：可移除除自己和 owner 之外的任何人；
 * - admin：只能移除普通 member；
 * - member：不可移除任何人。
 */
export function canRemoveMember(
  callerRole: MemberRole | null,
  callerId: string | null,
  target: Pick<TeamMemberRow, 'user_id' | 'role' | 'active'>,
): boolean {
  if (!callerId || target.user_id === callerId || !target.active) return false
  if (target.role === 'owner') return false
  if (callerRole === 'owner') return true
  if (callerRole === 'admin') return target.role === 'member'
  return false
}

/** 能否给某个成员设置/取消管理员。 */
export function canToggleAdmin(callerRole: MemberRole | null, callerId: string | null, target: Pick<TeamMemberRow, 'user_id' | 'role' | 'active'>): boolean {
  if (!canChangeRoles(callerRole)) return false
  if (!callerId || target.user_id === callerId) return false
  if (!target.active) return false
  return target.role === 'admin' || target.role === 'member'
}

/** 团队成员（任意角色）都可以维护团队任务。 */
export function canMaintainTasks(role: MemberRole | null): boolean {
  return role !== null
}

/** 只能改删自己写的日报，且必须仍是该团队有效成员。 */
export function canEditWorkLog(
  role: MemberRole | null,
  viewerId: string | null,
  logOwnerId: string,
): boolean {
  return role !== null && viewerId !== null && viewerId === logOwnerId
}

/** 角色中文名。 */
export function roleLabel(role: MemberRole): string {
  if (role === 'owner') return '群主'
  if (role === 'admin') return '管理员'
  return '成员'
}

/** 角色排序权重（列表里 owner 在最前）。 */
export function roleRank(role: MemberRole): number {
  if (role === 'owner') return 0
  if (role === 'admin') return 1
  return 2
}
