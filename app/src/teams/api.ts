/**
 * 团队相关数据访问 —— 全部走自建 /api/teams/*（cookie 会话）。
 */
import { apiFetch } from '../lib/apiClient'
import { AppError } from '../lib/errors'
import type { MemberRole, TeamMemberRow, TeamRow } from '../types/db'

/** `GET /api/teams` 行：membership + 嵌套 team。 */
interface MembershipQueryRow {
  team_id: number
  role: MemberRole
  display_name: string
  joined_at: string
  teams: TeamRow | TeamRow[] | null
}

export interface TeamSummary {
  team: TeamRow
  role: MemberRole
  displayName: string
  joinedAt: string
}

function pickTeam(value: TeamRow | TeamRow[] | null): TeamRow | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** 当前用户的有效团队列表（服务端按会话用户过滤）。userId 保留兼容调用方。 */
export async function fetchMyTeams(_userId: string): Promise<TeamSummary[]> {
  const rows = await apiFetch<MembershipQueryRow[]>('/api/teams')
  const out: TeamSummary[] = []
  for (const row of rows) {
    const team = pickTeam(row.teams)
    if (!team) continue
    out.push({
      team,
      role: row.role,
      displayName: row.display_name,
      joinedAt: row.joined_at,
    })
  }
  return out
}

/** 团队成员（含已停用行，用于历史姓名展示）。 */
export async function fetchMembers(teamId: number): Promise<TeamMemberRow[]> {
  return apiFetch<TeamMemberRow[]>(`/api/teams/${teamId}/members`)
}

/** 创建团队，创建者自动成为 owner。 */
export async function createTeam(
  name: string,
  displayName: string,
): Promise<{ teamId: number; inviteCode: string }> {
  const data = await apiFetch<{ team_id: number; invite_code: string }>('/api/teams', {
    method: 'POST',
    json: { name, display_name: displayName },
  })
  if (!data) throw new AppError('创建团队后未能取回团队信息', 'unknown')
  return { teamId: data.team_id, inviteCode: data.invite_code }
}

export type JoinResult =
  | { kind: 'joined'; teamId: number; role: MemberRole; teamName: string | null }
  | { kind: 'already'; teamId: number; role: MemberRole }

/** 用邀请码加入团队。重复加入不当作失败。 */
export async function joinTeam(code: string, displayName: string): Promise<JoinResult> {
  try {
    const data = await apiFetch<{ team_id: number; role: MemberRole; name?: string }>(
      '/api/teams/join',
      { method: 'POST', json: { code, display_name: displayName } },
    )
    if (!data) throw new AppError('加入团队后未能取回团队信息', 'unknown')
    return { kind: 'joined', teamId: data.team_id, role: data.role, teamName: data.name ?? null }
  } catch (err) {
    if (err instanceof AppError && err.code === 'already_member') {
      const payload = err.data as { team_id?: number; role?: MemberRole } | undefined
      if (payload?.team_id != null && payload.role) {
        return { kind: 'already', teamId: payload.team_id, role: payload.role }
      }
    }
    throw err
  }
}

/** 读取邀请码（仅 owner / admin）。 */
export async function getInviteCode(teamId: number): Promise<string> {
  const data = await apiFetch<{ invite_code: string }>(`/api/teams/${teamId}/invite-code`)
  if (!data) throw new AppError('未能取回邀请码', 'unknown')
  return data.invite_code
}

/** 重置邀请码，旧码立即失效。 */
export async function resetInviteCode(teamId: number): Promise<string> {
  const data = await apiFetch<{ invite_code: string }>(`/api/teams/${teamId}/invite-code/reset`, {
    method: 'POST',
    json: {},
  })
  if (!data) throw new AppError('未能重置邀请码', 'unknown')
  return data.invite_code
}

/** 授予 / 取消管理员（仅 owner）。 */
export async function setMemberRole(
  teamId: number,
  userId: string,
  role: Exclude<MemberRole, 'owner'>,
): Promise<void> {
  await apiFetch(`/api/teams/${teamId}/members/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    json: { role },
  })
}

/** 移除成员（停用），同时轮换邀请码。 */
export async function removeMember(
  teamId: number,
  userId: string,
): Promise<{ unassignedTasks: number; inviteCode: string }> {
  const data = await apiFetch<{ unassigned_tasks: number; invite_code: string }>(
    `/api/teams/${teamId}/members/${encodeURIComponent(userId)}/remove`,
    { method: 'POST', json: {} },
  )
  return { unassignedTasks: data?.unassigned_tasks ?? 0, inviteCode: data?.invite_code ?? '' }
}
