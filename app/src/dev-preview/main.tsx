import '../theme/theme'
import './preview.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { DashboardPage } from '../dashboard/DashboardPage'
import { TasksPage } from '../tasks/TasksPage'
import { GanttPage } from '../gantt/GanttPage'
import { LogsPage } from '../logs/LogsPage'
import { TeamSettingsPage } from '../teams/TeamSettingsPage'
import { LoginPage } from '../auth/LoginPage'
import { FIXTURE_MARKER } from './fixtures'
import '../styles/global.css'

if (!import.meta.env.DEV) throw new Error('Visual preview is development-only')
const container = document.getElementById('root')
if (!container) throw new Error('Preview root missing')
createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage bootNotice={null} />} />
        <Route path="*" element={<AppShell><Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/gantt" element={<GanttPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/team" element={<TeamSettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></AppShell>} />
      </Routes>
      <aside className="preview-badge" data-fixture={FIXTURE_MARKER}>
        预览模式 · 示例数据 <a href="#/login" style={{ marginLeft: 8 }}>登录页</a><a href="#/" style={{ marginLeft: 8 }}>仪表盘</a>
      </aside>
    </HashRouter>
  </StrictMode>,
)
