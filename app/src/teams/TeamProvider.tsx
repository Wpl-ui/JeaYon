/**
 * 当前团队上下文。
 *
 * 负责：团队列表、当前团队、当前角色、成员列表。
 * 约束：
 *  - 团队列表只能来自服务端（RLS 过滤后只返回自己仍是有效成员的团队）；
 *  - 记住的"上次选中团队"只是 UI 偏好，必须校验仍在列表中，否则回退到第一个；
 *  - 切换团队时作废在途请求，旧团队的慢响应不得写进当前状态。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { MemberRole, TeamMemberRow } from '../types/db'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage, isSessionExpired } from '../lib/errors'
import { RequestGuard } from '../lib/request-guard'
import { fetchMembers, fetchMyTeams, type TeamSummary } from './api'

const SELECTED_TEAM_KEY = 'dwa:selectedTeamId'

function readStoredTeamId(): number | null {
  try {
    const raw = window.localStorage.getItem(SELECTED_TEAM_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeStoredTeamId(id: number | null): void {
  try {
    if (id === null) window.localStorage.removeItem(SELECTED_TEAM_KEY)
    else window.localStorage.setItem(SELECTED_TEAM_KEY, String(id))
  } catch {
    // localStorage 不可用时忽略：这只影响"上次选的团队"这一便利
  }
}

export interface TeamContextValue {
  loading: boolean
  error: string | null
  teams: TeamSummary[]
  currentTeam: TeamSummary | null
  currentTeamId: number | null
  currentRole: MemberRole | null
  members: TeamMemberRow[]
  membersLoading: boolean
  membersError: string | null
  selectTeam: (teamId: number) => void
  reloadTeams: () => Promise<void>
  reloadMembers: () => Promise<void>
  /** 成员姓名（含已停用成员的历史姓名），找不到返回 null。 */
  memberName: (userId: string | null) => string | null
  /** 仍然有效的成员（用于负责人下拉）。 */
  activeMembers: TeamMemberRow[]
}

const TeamContext = createContext<TeamContextValue | null>(null)

export function TeamProvider({ children }: { children: ReactNode }) {
  const { userId, dataEpoch, expireSession } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(() => readStoredTeamId())

  const [members, setMembers] = useState<TeamMemberRow[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState<string | null>(null)

  const teamsGuard = useRef(new RequestGuard())
  const membersGuard = useRef(new RequestGuard())

  // 未登录：清空一切，并清掉记住的团队选择
  useEffect(() => {
    if (userId) return
    teamsGuard.current.invalidate()
    membersGuard.current.invalidate()
    setTeams([])
    setMembers([])
    setSelectedId(null)
    setLoading(false)
    setError(null)
    writeStoredTeamId(null)
  }, [userId])

  const reloadTeams = useCallback(async () => {
    if (!userId) return
    const ticket = teamsGuard.current.next()
    setLoading(true)
    setError(null)
    try {
      const list = await fetchMyTeams(userId)
      if (!teamsGuard.current.isCurrent(ticket)) return
      setTeams(list)
      setSelectedId((prev) => {
        if (prev !== null && list.some((t) => t.team.id === prev)) return prev
        const next = list[0]?.team.id ?? null
        writeStoredTeamId(next)
        return next
      })
    } catch (err) {
      if (!teamsGuard.current.isCurrent(ticket)) return
      if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
        return
      }
      setTeams([])
      setError(errorMessage(err))
    } finally {
      if (teamsGuard.current.isCurrent(ticket)) setLoading(false)
    }
  }, [userId, expireSession])

  useEffect(() => {
    if (!userId) return
    void reloadTeams()
  }, [userId, dataEpoch, reloadTeams])

  const reloadMembers = useCallback(async () => {
    if (!userId || selectedId === null) {
      setMembers([])
      return
    }
    const ticket = membersGuard.current.next()
    setMembersLoading(true)
    setMembersError(null)
    try {
      const list = await fetchMembers(selectedId)
      if (!membersGuard.current.isCurrent(ticket)) return
      setMembers(list)
    } catch (err) {
      if (!membersGuard.current.isCurrent(ticket)) return
      if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
        return
      }
      setMembersError(errorMessage(err))
    } finally {
      if (membersGuard.current.isCurrent(ticket)) setMembersLoading(false)
    }
  }, [userId, selectedId, expireSession])

  useEffect(() => {
    if (!userId || selectedId === null) {
      setMembers([])
      return
    }
    void reloadMembers()
  }, [userId, selectedId, dataEpoch, reloadMembers])

  // 切团队：先作废上一轮成员请求，避免旧团队成员回填
  useEffect(() => {
    return () => {
      membersGuard.current.invalidate()
    }
  }, [selectedId])

  const selectTeam = useCallback((teamId: number) => {
    setSelectedId((prev) => {
      if (prev === teamId) return prev
      writeStoredTeamId(teamId)
      return teamId
    })
  }, [])

  const currentTeam = useMemo(
    () => teams.find((t) => t.team.id === selectedId) ?? null,
    [teams, selectedId],
  )

  const nameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const member of members) map.set(member.user_id, member.display_name)
    return map
  }, [members])

  const memberName = useCallback(
    (id: string | null) => (id === null ? null : (nameMap.get(id) ?? null)),
    [nameMap],
  )

  const activeMembers = useMemo(() => members.filter((m) => m.active), [members])

  const value = useMemo<TeamContextValue>(
    () => ({
      loading,
      error,
      teams,
      currentTeam,
      currentTeamId: currentTeam?.team.id ?? null,
      currentRole: currentTeam?.role ?? null,
      members,
      membersLoading,
      membersError,
      selectTeam,
      reloadTeams,
      reloadMembers,
      memberName,
      activeMembers,
    }),
    [
      loading,
      error,
      teams,
      currentTeam,
      members,
      membersLoading,
      membersError,
      selectTeam,
      reloadTeams,
      reloadMembers,
      memberName,
      activeMembers,
    ],
  )

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
}

export function useTeam(): TeamContextValue {
  const ctx = useContext(TeamContext)
  if (!ctx) throw new Error('useTeam 必须在 TeamProvider 内使用')
  return ctx
}
