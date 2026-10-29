/**
 * 应用外壳：桌面侧栏、移动标签栏、团队切换与当前用户。
 *
 * 团队切换只改「当前团队」这一层状态，各页面的查询通过 `useTeamQuery` 的
 * teamId 依赖自动重查，并把旧团队的响应作废。
 */
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useTeam } from '../teams/TeamProvider'
import { roleLabel } from '../lib/permissions'
import { Avatar, Button, SymbolIcon } from './ui'
import brandIcon from '../assets/brand-icon.png'
import { publicConfig } from '../config/publicConfig'
import { useState } from 'react'

const NAV_ITEMS = [
  { to: '/', label: '看板', icon: 'overview', end: true },
  { to: '/tasks', label: '待办', icon: 'tasks', end: false },
  { to: '/gantt', label: '计划', icon: 'calendar', end: false },
  { to: '/logs', label: '日记', icon: 'report', end: false },
  { to: '/team', label: '组织', icon: 'team', end: false },
] as const

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const { teams, currentTeamId, currentTeam, currentRole, selectTeam } = useTeam()
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  const displayName = user?.name ?? currentTeam?.displayName ?? '我'

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <img src={brandIcon} alt="" className="brand-mark-img" />
          </span>
          <span>{publicConfig.appName}</span>
        </div>

        <p className="sidebar-section">导航</p>

        <div className="topbar-right">
          {teams.length > 0 ? <div className="team-switch">
            <label htmlFor="team-select">团队</label>
            <select
              id="team-select"
              value={currentTeamId ?? ''}
              onChange={(e) => selectTeam(Number(e.target.value))}
            >
              {teams.map((item) => (
                <option key={item.team.id} value={item.team.id}>
                  {item.team.name}
                </option>
              ))}
            </select>
          </div> : null}

          <div className="user-chip">
            <NavLink to="/settings" aria-label="设置" className="user-settings-link">
              <Avatar name={displayName} small />
              <span className="nowrap">
                {displayName}
                <span className="faint">设置{currentRole ? ` · ${roleLabel(currentRole)}` : ''}</span>
              </span>
              <span className="user-settings-label">设置</span>
            </NavLink>
            <Button size="sm" variant="ghost" onClick={() => void handleSignOut()} loading={signingOut}>
              退出
            </Button>
          </div>
        </div>
      </header>

      <nav id="main-nav" className="nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            <SymbolIcon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <main className="shell-content">{children}</main>
    </div>
  )
}
