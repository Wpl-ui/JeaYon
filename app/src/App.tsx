/**
 * Routing and guards.
 *
 * Guard only splits UI — real auth is cookie + /api/auth/me.
 * Teams / tasks / gantt / logs all use the self-hosted /api/* cookie session.
 */
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { AuthSession } from './auth/types'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { LoginPage } from './auth/LoginPage'
import { TeamProvider, useTeam } from './teams/TeamProvider'
import { TeamGate } from './teams/TeamGate'
import { TeamSettingsPage } from './teams/TeamSettingsPage'
import { AppShell } from './components/AppShell'
import { Banner, Button, PageLoading } from './components/ui'
import { DashboardPage } from './dashboard/DashboardPage'
import { TasksPage } from './tasks/TasksPage'
import { GanttPage } from './gantt/GanttPage'
import { LogsPage } from './logs/LogsPage'
import { SettingsPage } from './settings/SettingsPage'

export function App({
  initialSession,
  bootNotice,
}: {
  initialSession: AuthSession | null
  bootNotice: string | null
}) {
  return (
    <AuthProvider initialSession={initialSession}>
      <TeamProvider>
        <HashRouter>
          <AppRoutes bootNotice={bootNotice} />
        </HashRouter>
      </TeamProvider>
    </AuthProvider>
  )
}

function AppRoutes({ bootNotice }: { bootNotice: string | null }) {
  const { status } = useAuth()
  const { loading, error, teams, reloadTeams } = useTeam()
  const isSettings = useLocation().pathname === '/settings'

  if (status === 'signed-out') {
    return <LoginPage bootNotice={bootNotice} />
  }

  if (loading && teams.length === 0 && !isSettings) {
    return <PageLoading label="正在读取你的团队…" />
  }

  // No teams yet: create/join gate. Real errors (network etc.) still show a banner.
  if (teams.length === 0 && !isSettings) {
    return (
      <div style={{ minHeight: '100vh' }}>
        {error ? (
          <div className="page page-narrow" style={{ paddingBottom: 0 }}>
            <Banner kind="warn">
              <span>{error}</span>
              <Button size="sm" variant="ghost" onClick={() => void reloadTeams()}>
                重试
              </Button>
            </Banner>
          </div>
        ) : null}
        <TeamGate />
      </div>
    )
  }

  return (
    <AppShell>
      {error ? (
        <div className="page page-narrow" style={{ paddingBottom: 0 }}>
          <Banner kind="error">
            <span>团队信息刷新失败：{error}</span>
            <Button size="sm" variant="ghost" onClick={() => void reloadTeams()}>
              重试
            </Button>
          </Banner>
        </div>
      ) : null}
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/gantt" element={<GanttPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/team" element={<TeamSettingsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
