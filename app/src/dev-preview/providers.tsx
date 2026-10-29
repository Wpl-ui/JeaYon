import type { AuthContextValue } from '../auth/AuthProvider'
import type { TeamContextValue } from '../teams/TeamProvider'
import { members, summary } from './fixtures'

const noOp = () => {}
const auth: AuthContextValue = {
  status: 'signed-in', user: null, userId: members[0].user_id, expiredNotice: null, dataEpoch: 0,
  expireSession: noOp, clearExpiredNotice: noOp, syncSession: async () => {}, acceptSession: noOp,
  signOut: async () => { window.location.hash = '/login' },
}
const team: TeamContextValue = {
  loading: false, error: null, teams: [summary], currentTeam: summary, currentTeamId: 1, currentRole: 'owner',
  members, activeMembers: members, membersLoading: false, membersError: null, selectTeam: noOp,
  reloadTeams: async () => {}, reloadMembers: async () => {},
  memberName: (id) => members.find((member) => member.user_id === id)?.display_name ?? null,
}
export function useAuth(): AuthContextValue { return auth }
export function useTeam(): TeamContextValue { return team }
