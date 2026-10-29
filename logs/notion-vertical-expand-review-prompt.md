只读审阅 JeaYon Notion 竖直大纲展开。禁止修改、commit/push/delete，禁止虚构验证。工具已禁用；只根据以下实际代码与证据审阅。用户明确批准方案 A。用简体中文 + English 简洁回答，列出实际缺陷（如有）。核对整组竖直 grid 0fr/1fr、200/150ms、右/下三角、无 stagger、inert/aria-hidden/焦点、reduced-motion、卡片/pastel/sessionStorage/同父拖拽键盘/409回滚、品牌导航、无新依赖/API、staging证据。Chrome blank smoke 未返回DOM，DOM+真实HTTP为明确披露的替代，不得声称真实视觉通过。若无阻塞缺陷最后一行必须为“结论：可上线”，否则“结论：需修复”。

FILE: logs/proposal-notion-vertical-expand.md
# 方案：待办展开对齐 Notion 竖直大纲 / Notion-like vertical outline expand

状态 / Status: **待确认 / awaiting approval**（只方案，未改代码）

## 问题 / Problem

当前子项用水平 `clip-path` 短→长扫入 + 错峰，既不像 Notion，也裁掉阴影。用户要求按 Notion **整体重做交互**。

## 目标 / Goal

展开/收起观感对齐 Notion 大纲：子项在父项**下方竖直挤开**、缩进层级清晰、三角/胶囊指示状态；保留已有业务能力。

## 推荐方案 A / Approach A

### 交互

1. **竖直揭示**：子项容器用高度动画（优先 `grid-template-rows: 0fr ↔ 1fr` + 内层 `overflow: hidden`，与早前可上线垂直折叠同族），替代水平 `clip-path` / `display:none` 扫入。
2. **布局**：子项仍在文档流、父卡下方；左侧缩进（现有约 28px 可微调，保持可拖拽命中区）。
3. **指示器**：父卡胶囊保留 `done/total`；三角 **Notion 式**——收起朝右（▸），展开朝下（▾），用旋转过渡（同一字形旋转约 90°），与高度动画同拍。
4. **时长（已确认）**：展开高度 **~200ms**；收起高度 **~150ms**；三角旋转跟对应阶段（展开约 200ms / 收起约 150ms）。ease 用现有 Apple 曲线即可。
5. **错峰 / 收起**：展开与收起均为**整组同时**，**无**逐项 stagger；不做左右短→长。`prefers-reduced-motion: reduce`：高度与三角均瞬时到位。
6. **a11y**：收起子树 `inert` + `aria-hidden`；焦点不困在隐藏项；胶囊 `aria-expanded` / `aria-label` 保留。

### 保留 / Keep

- `ParentTaskCard` / `ChildTaskCard` 组件拆分
- 稳定 pastel（`taskColor(id)`）+ 左侧色条（可继续；不改成纯 Notion 扁行）
- 胶囊折叠 + `sessionStorage`（`collapse.ts`）
- 同父拖拽 / 键盘调序 / 409 回滚 / 筛选上下文
- 无新依赖、无 API/migration、无 commit/push
- 品牌 JeaYon；导航「导航 / 看板 / 待办 / 计划 / 日记 / 组织」

### 代码触点 / Touch points（预期）

- `app/src/styles/global.css`：替换 `.task-child-collapse` 水平规则为竖直 grid 揭示；三角 transition；去掉展开态残留 `clip-path: inset(0 0 0 0)` 裁阴影问题
- `app/src/tasks/TasksPage.tsx`：去掉或停用 expand delay style
- `app/src/tasks/appearance.ts`：可删或 unused `taskExpandDelay`
- DOM/验收脚本：断言从水平 clip/stagger 改为竖直 grid rows + reduced-motion
- 文档 `server/docs/task-expand-cards.md` 或新 `task-notion-vertical-expand.md` + staging 前端热更证据

## 明确不做 / Out of scope

- 无限多层嵌套、拖到任意深度、Notion 全套快捷键
- 方案 B 扁行去色、方案 C 右侧子树面板
- 新动画库（framer-motion 等）
- 密码/设置/ICP/微信
- production cutover、git commit/push/delete

## 更深一层故意不做 / Deeper cut left out

FLIP 共享布局、弹簧物理、虚拟长列表、色弱专用双编码主题（本轮保持对比度即可）。

## 验收 / Acceptance

1. 展开：子项从父下竖直挤开，无水平扫入；阴影不被整卡 clip 裁掉。
2. 收起：高度收合 + inert；胶囊三角状态正确。
3. 无 stagger（或 delay=0）；reduced-motion 安全。
4. 拖拽/筛选/sessionStorage/胶囊计数回归。
5. pastel + 父/子组件仍在；品牌导航未回退。
6. 本地测试 + staging 前端部署证据；Claude 审阅结论行。

## 实施流程 / Process

Codex `gpt-6.1-sol` high 实现并部署 staging → Claude `deepseek-flash` 只审不改 → 原文审阅回传。**确认本方案后才开工。**


FILE: server/docs/task-notion-vertical-expand.md
# JeaYon Notion 竖直大纲展开 / Vertical outline expansion

方案 A 已由用户在本轮任务中明确批准；方案原文件的“待确认”是旧状态。
The user explicitly approved Approach A for this task; the proposal's approval label is stale.

## 实现 / Implementation

- 同父子项放入父卡下的单个 grid 容器，`grid-template-rows: 0fr ↔ 1fr`；内层 `min-height: 0; overflow: hidden`。移除子项水平 clip-path、display 离散过渡、starting-style、错峰样式与 `taskExpandDelay`。展开 200ms、收起 150ms，整组同时；不使用新依赖或 API。
  One grid group below each parent reveals all siblings together, using an inner overflow container. Horizontal clipping and stagger are removed. Expansion takes 200ms; collapse takes 150ms. No new dependencies or APIs.
- 保留同一个 ▾ 字形，展开为 0°（朝下）、收起 -90°（朝右），旋转时长与高度一致；reduced-motion 将高度与三角时长、延迟归零。
  The same triangle rotates between down and right with matching timing; reduced motion makes both instantaneous.
- 收起组及子行保留 DOM，设置 inert/aria-hidden，禁用拖拽手柄；收起前聚焦胶囊，防止焦点留在隐藏子树。内层列表留 4px 阴影空间，桌面卡片缩进约 28px、移动端约 12px。
  Collapsed DOM is retained, inert and aria-hidden, with drag handles disabled. Focus returns to the capsule. A 4px gutter accommodates card shadows; card indentation stays about 28px desktop and 12px mobile.
- 保留 ParentTaskCard/ChildTaskCard、稳定 pastel 与色条、完成/总数胶囊、sessionStorage、真实 API 调序和回滚。JeaYon 与“导航 / 看板 / 待办 / 计划 / 日记 / 组织”保持不变。
  Card components, deterministic pastel colors, counts, stored collapse state, real ordering APIs and rollback remain intact, as do branding and navigation.

产品改动 / Product changes: `app/src/tasks/TasksPage.tsx`, `app/src/tasks/TaskCards.tsx`, `app/src/tasks/appearance.ts`, `app/src/styles/global.css`。
验收改动 / Acceptance changes: `app/tests/unit/task-appearance.test.ts`, `app/tests/task-expand-cards-browser-client.jsx`, `logs/notion-vertical-expand-dom.mjs`。

## 验证 / Verification

Node: `/opt/node24/bin/node` v24.22.1。数据库测试固定使用隔离的 PostgreSQL 16 `dwa_test`；使用 TZ/PGOPTIONS UTC；没有模拟数据库或后端。
Database checks use only isolated PostgreSQL 16 `dwa_test`, with UTC date handling and no mock backend/database.

| 检查 / Check | 结果 / Result | 证据 / Evidence |
| --- | --- | --- |
| 修改前失败复现 / Red reproduction | 2 assertions fail on old CSS | `logs/notion-vertical-expand-red.txt` |
| app 全量 / Full tests | 61/61 PASS; 0 skipped | `logs/notion-vertical-expand-final-app-tests.txt` |
| server 全量 / Full tests | 188/188 PASS; 0 skipped | `logs/notion-vertical-expand-final-server-tests.txt` |
| app typecheck / build | PASS / PASS, exit 0 | `logs/notion-vertical-expand-final-app-typecheck.txt`, `logs/notion-vertical-expand-final-app-build.txt` |
| server typecheck / build | PASS / PASS, exit 0 | `logs/notion-vertical-expand-final-server-typecheck.txt`, `logs/notion-vertical-expand-final-server-build.txt` |
| React DOM + real HTTP/Fastify/PostgreSQL | PASS, 15 acceptance groups | `logs/notion-vertical-expand-dom.txt`, `logs/notion-vertical-expand-dom.html` |
| 独立 lint / Standalone lint | 未配置 / Not configured | app/server package.json |

DOM 验收覆盖单父单组、0fr/1fr、展开/收起时长、无错峰、reduced-motion CSS、三角方向、焦点归位、inert/aria-hidden、DOM 保留、快速反转、sessionStorage 重挂载、叶子任务、父进度/计数、颜色稳定、真实 HTTP 拖拽持久化、真实 409 回滚、断网回滚、跨父拒绝、键盘与筛选隐藏兄弟排序。
DOM acceptance covers the group/CSS contract and preserved behaviors, including real HTTP persistence, conflict and network rollback. React accessibility, hook placement and stable task keys were reviewed using the React best-practices checklist.

首次类型检查发现提取渲染函数后丢失团队 ID 类型收窄，已用守卫后的常量修正；最终检查通过。DOM 脚本最初的零长度断言及挂载选择器也已适配嵌套列表，保留原失败日志 `dom-attempt1/2.txt`。完整事件保留在主证据中。
Initial type narrowing and DOM-harness assertion issues were corrected. The final checks pass; earlier attempts remain in the evidence trail.

**Chrome 不可用，使用 DOM + HTTP 替代。** `/usr/bin/google-chrome` 的独立 about:blank headless smoke 在 15 秒限制内未产出 DOM；输出见 `logs/notion-vertical-expand-chrome-smoke.txt`。浏览器客户端断言已改为竖直 grid，但本轮未能在 Chrome 执行。DOM/CSS 断言不等于浏览器布局或动画采样，未验证像素、插值、帧率、触屏或实际明暗主题观感。
**Chrome is unavailable; DOM + HTTP is the substitute.** The blank-page smoke produced no DOM within its 15-second limit. Browser assertions were updated but not executed in Chrome. Rendered layout, animation interpolation, frame rate, touch behavior and visual light/dark appearance remain unverified.

## Staging 前端部署 / Frontend deployment

状态 / Status: 已激活，部署后双路径 HTTPS 核验通过 / Activated; both HTTPS verification paths passed.
目标 / Target: `ubuntu@43.136.106.96`, `/home/ubuntu/jeayon-work/app/dist`，既有 staging + edge Caddy；不做 production cutover。
备份 / Backup: `/home/ubuntu/jeayon-work/backups/notion-vertical-expand-20261028T050722Z`（0700，文件 0600；旧 dist 哈希已核对）。
发布包 / Archive: `logs/notion-vertical-expand-release.tar.gz`
SHA-256: `92c597383c45f5f05c65c92ceff0a58d0604ad187b420eab4d625061f70d6339`

激活时间 / Activation: 2026-10-28T05:10:26.989862+00:00。11 个发布文件逐一验证，通过原 dist 目录内原子替换，index.html 最后更新；挂载目录 inode 和历史哈希资源均保留。远端 app/src 未同步，以 dist 为运行版本。首次上传 55 秒超时、未激活；延长传输时限后成功。
All 11 release files passed verification and were replaced atomically inside the mounted dist, with index.html last. The directory inode and historical assets remain intact. Remote app/src was not synchronized; the supplied dist is the running version. The initial 55-second upload timed out before activation; the retry succeeded.

API/Postgres/Caddy 的容器 ID、镜像、启动时间、状态、重启次数均与备份一致；服务端 source/dist 与 Caddy/compose 配置摘要一致。未执行远端数据库写入、migration、镜像构建或容器重启。
API/Postgres/Caddy identities, images, start times, states and restart counts match the backup snapshot, as do server source/build and deployment configuration digests. No remote database writes, migrations, image builds or container restarts occurred.

当前入口 / Active bundles: `assets/index-C_hSDo0q.js`, `assets/index-C_kHRnPu.css`。

服务器本机 `--resolve jeayon.com:443:127.0.0.1` 与工作区 SSH 隧道 `127.0.0.1:19443 → 服务器 127.0.0.1:443` 两条 HTTPS 路径均验证 11/11 文件返回 200、SHA-256 与本地 dist 一致；TLS 证书校验开启。品牌、导航、grid 动画及无错峰标记通过当前入口核验。`/api/health/live`、`/api/health/ready` 为 200，匿名 `/api/auth/me` 为预期 401。
Both server-local resolved HTTPS and workspace SSH-tunneled HTTPS returned 200 for all 11 files with matching local dist hashes and TLS verification. Active bundles retain branding/navigation and contain the vertical grid rules without stagger. Health endpoints return 200; anonymous auth returns the expected 401.

证据 / Evidence: `logs/notion-vertical-expand-deployed-verify.txt` 及主 JSONL 的 `remote_https_verification` / `workspace_tunnel_https_verification`。这些路径验证目标 staging Caddy，不等于额外的公网 DNS/CDN 或浏览器验收。
These paths verify the target staging Caddy, without establishing public DNS/CDN routing or browser acceptance.

## 复验与回滚 / Recheck and rollback

- 全量检查 / Full checks: `python3 logs/notion-vertical-expand-checks.py final`。
- DOM/HTTP 验收 / Acceptance: `TZ=UTC PGOPTIONS='-c timezone=UTC' /opt/node24/bin/node --env-file=server/.env --import ./server/node_modules/tsx/dist/loader.mjs logs/notion-vertical-expand-dom.mjs`；只允许隔离本地 `dwa_test`，会重置测试 schema。
- 部署后只读核验 / Read-only deployed verification: `python3 logs/notion-vertical-expand-verify.py`。
- 回滚参考：从备份 dist 逐文件原子恢复，index.html 最后更新，保留挂载目录和历史资源；本轮未执行回滚。
  Rollback can atomically restore the backed-up files, index.html last, while retaining the mounted directory and historical assets. Rollback was not performed.

主证据 / Main evidence: `logs/notion-vertical-expand-20261028.jsonl`。
未 commit/push，未删除源文件、分支、项目或远端历史资源；无依赖/API/migration 改动。
No commit/push, source/branch/project deletion or remote historical-asset deletion; no dependency/API/migration changes.

## Claude 审阅 / Review

待部署后调用 `deepseek-flash` 只读审阅；尚无结论。
Read-only deepseek-flash review will follow deployment; no verdict yet.


FILE: app/src/tasks/TasksPage.tsx
/**
 * 任务列表。
 *
 * 数据只来自服务端：排序乐观更新，失败回滚；其他写操作完成后重新查询。
 * 归档任务不物理删除，只是退出常规列表与甘特图，历史日报仍可看到关联。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useTeam } from '../teams/TeamProvider'
import { useTeamQuery } from '../lib/useTeamQuery'
import { fetchArchivedTasks, fetchTasks, reorderChildren, setTaskArchived, setTaskComplete } from './api'
import { TaskDrawer } from './TaskDrawer'
import { ChildTaskCard, ParentTaskCard } from './TaskCards'
import { taskColor } from './appearance'
import { childTasks, flattenTaskTree, hasActiveChildren, moveChild } from './hierarchy'
import { collapseKey, readCollapsed, writeCollapsed, type CollapsedTasks } from './collapse'
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  InlineLoading,
  SymbolIcon,
  TextInput,
} from '../components/ui'
import { todayISO } from '../lib/dates'
import { errorMessage, isSessionExpired, toAppError } from '../lib/errors'
import type { TaskRow, TaskStatus } from '../types/db'

type Scope = 'active' | 'archived'
type StatusFilter = 'all' | TaskStatus
type AssigneeFilter = 'all' | 'unassigned' | string

export function TasksPage() {
  const { expireSession, dataEpoch } = useAuth()
  const { currentTeamId, currentTeam, members, memberName, reloadMembers } = useTeam()

  const [scope, setScope] = useState<Scope>('active')
  const activeQuery = useTeamQuery(currentTeamId, fetchTasks)
  const archivedQuery = useTeamQuery(currentTeamId, fetchArchivedTasks, { enabled: scope === 'archived' })

  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<TaskRow | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<TaskRow | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [restoringId, setRestoringId] = useState<number | null>(null)
  const [completingId, setCompletingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<CollapsedTasks>(() => {
    try { return readCollapsed(window.sessionStorage) } catch { return {} }
  })
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [pendingOrder, setPendingOrder] = useState<{ teamId: number; epoch: number; children: TaskRow[] } | null>(null)
  const reorderBusy = useRef(false)
  const context = useRef({ teamId: currentTeamId, epoch: dataEpoch, mounted: true })
  context.current.teamId = currentTeamId
  context.current.epoch = dataEpoch
  useEffect(() => {
    context.current.mounted = true
    return () => { context.current.mounted = false }
  }, [])
  useEffect(() => {
    try { writeCollapsed(window.sessionStorage, collapsed) } catch { /* Storage disabled. */ }
  }, [collapsed])

  const today = todayISO()
  const query = scope === 'active' ? activeQuery : archivedQuery
  const ordering = scope === 'active' && pendingOrder?.teamId === currentTeamId && pendingOrder.epoch === dataEpoch ? pendingOrder : null
  const rows = useMemo(() => {
    const saved = query.data ?? []
    if (!ordering) return saved
    const optimistic = new Map(ordering.children.map(child => [child.id, child]))
    return saved.map(task => optimistic.get(task.id) ?? task)
  }, [query.data, ordering])

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    const matched = rows.filter((task) => {
      if (text) {
        const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase()
        if (!haystack.includes(text)) return false
      }
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (assigneeFilter === 'unassigned' && task.assignee_id !== null) return false
      if (assigneeFilter !== 'all' && assigneeFilter !== 'unassigned' && task.assignee_id !== assigneeFilter) return false
      return true
    })
    // Keep matching children's parents visible so a collapsed result can be expanded.
    const parentIds = new Set(matched.map(task => task.parent_id).filter(id => id != null))
    const matchedIds = new Set(matched.map(task => task.id))
    return flattenTaskTree(rows.filter(task => matchedIds.has(task.id) || parentIds.has(task.id)))
  }, [rows, keyword, statusFilter, assigneeFilter])

  const visible = filtered.filter(task => task.parent_id == null || !currentTeamId ||
    !collapsed[collapseKey(currentTeamId, task.parent_id)])

  function toggleParent(parentId: number) {
    if (!currentTeamId) return
    const key = collapseKey(currentTeamId, parentId)
    setCollapsed(previous => {
      const next = { ...previous }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  async function handleReorder(sourceId: number, targetId: number) {
    if (!currentTeamId || scope !== 'active' || query.loading || reorderBusy.current) return
    const children = moveChild(rows, sourceId, targetId)
    if (!children) return
    const teamId = currentTeamId
    const epoch = dataEpoch
    const isCurrent = () => context.current.mounted && context.current.teamId === teamId && context.current.epoch === epoch
    reorderBusy.current = true
    setActionError(null)
    setPendingOrder({ teamId, epoch, children })
    try {
      const saved = await reorderChildren(children[0].parent_id!, children)
      if (!isCurrent()) return
      const byId = new Map(saved.map(child => [child.id, child]))
      activeQuery.mutate(previous => previous?.map(task => byId.get(task.id) ?? task) ?? null)
      activeQuery.reload()
    } catch (err) {
      if (!isCurrent()) return
      if (isSessionExpired(err)) expireSession(errorMessage(err))
      else setActionError(toAppError(err).code === 'conflict'
        ? '子任务已被他人修改，排序未保存，已回滚并重新加载。'
        : `排序未保存，已回滚。${errorMessage(err)}`)
      activeQuery.reload()
    } finally {
      reorderBusy.current = false
      if (context.current.mounted) setPendingOrder(null)
    }
  }

  const [createParentId, setCreateParentId] = useState<number | null>(null)

  function openCreate(parentId: number | null = null) {
    setEditing(null)
    setCreateParentId(parentId)
    setDrawerOpen(true)
  }

  function openEdit(task: TaskRow) {
    setEditing(task)
    setCreateParentId(null)
    setDrawerOpen(true)
  }

  function refreshAll() {
    activeQuery.reload()
    if (scope === 'archived') archivedQuery.reload()
  }

  async function handleArchive() {
    if (!archiveTarget || archiveBusy) return
    setArchiveBusy(true)
    setActionError(null)
    try {
      await setTaskArchived(archiveTarget.id, archiveTarget.version, true)
      setArchiveTarget(null)
      refreshAll()
    } catch (err) {
      const appError = toAppError(err)
      if (appError.code === 'conflict') {
        setActionError('该任务已被他人修改，已重新加载最新状态，请确认后再归档。')
        refreshAll()
      } else if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
      } else {
        setActionError(errorMessage(err))
      }
      setArchiveTarget(null)
    } finally {
      setArchiveBusy(false)
    }
  }

  async function handleRestore(task: TaskRow) {
    if (restoringId !== null) return
    setRestoringId(task.id)
    setActionError(null)
    try {
      await setTaskArchived(task.id, task.version, false)
      archivedQuery.reload()
      activeQuery.reload()
    } catch (err) {
      const appError = toAppError(err)
      if (appError.code === 'conflict') {
        setActionError('该任务已被他人修改，已重新加载最新状态。')
        archivedQuery.reload()
      } else if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
      } else {
        setActionError(errorMessage(err))
      }
    } finally {
      setRestoringId(null)
    }
  }

  async function handleComplete(task: TaskRow, done: boolean) {
    if (completingId !== null || scope !== 'active') return
    setCompletingId(task.id)
    setActionError(null)
    try {
      await setTaskComplete(task.id, task.version, done)
      refreshAll()
    } catch (err) {
      const appError = toAppError(err)
      if (appError.code === 'conflict') {
        setActionError('该任务已被他人修改，已重新加载最新状态。')
        refreshAll()
      } else if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
      } else {
        setActionError(errorMessage(err))
      }
    } finally {
      setCompletingId(null)
    }
  }


  if (!currentTeamId || !currentTeam) {
    return (
      <div className="page">
        <EmptyState title="还没有选择团队" description="请先在右上角选择一个团队。" />
      </div>
    )
  }

  const teamId = currentTeamId

  function renderTask(task: TaskRow): ReactNode {
    const assignee = task.assignee_id ? (memberName(task.assignee_id) ?? '已停用成员') : '未分配'
    const isChild = task.parent_id != null
    const parentHasKids = !isChild && hasActiveChildren(rows, task.id)
    const kids = parentHasKids ? childTasks(rows, task.id).filter(t => t.archived_at === null) : []
    const doneCount = kids.filter((t) => t.status === 'done').length
    const expanded = !collapsed[collapseKey(teamId, task.id)]
    const childCollapsed = isChild && !!collapsed[collapseKey(teamId, task.parent_id!)]
    const canDrag = isChild && !childCollapsed && scope === 'active' && !query.loading && !ordering
    const dragSource = rows.find(row => row.id === draggingId)
    const validDrop = canDrag && dragSource?.parent_id === task.parent_id && draggingId !== task.id
    const cardProps = {
      task, today, assignee, archived: scope === 'archived', restoring: restoringId === task.id,
      onEdit: () => openEdit(task), onArchive: () => setArchiveTarget(task),
      onRestore: () => void handleRestore(task),
    }
    return (
      <li key={task.id} data-task-id={task.id} data-task-color={taskColor(task.id)}
        className="task-list-item"
        aria-hidden={childCollapsed || undefined} inert={childCollapsed}
        onDragOver={event => {
          if (!validDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropTargetId(task.id)
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(null)
        }}
        onDrop={event => {
          event.preventDefault()
          if (validDrop && draggingId != null) void handleReorder(draggingId, task.id)
          setDraggingId(null)
          setDropTargetId(null)
        }}>
        {isChild ? (
          <ChildTaskCard {...cardProps} completing={completingId === task.id}
            dragging={draggingId === task.id} dropTarget={dropTargetId === task.id}
            onComplete={done => void handleComplete(task, done)}
            dragHandleProps={{
              draggable: canDrag, disabled: !canDrag,
              onDragStart: event => {
                if (!canDrag) { event.preventDefault(); return }
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', String(task.id))
                setDraggingId(task.id)
              },
              onDragEnd: () => { setDraggingId(null); setDropTargetId(null) },
              onKeyDown: event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                const siblings = childTasks(rows, task.parent_id!)
                const index = siblings.findIndex(child => child.id === task.id)
                const target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)]
                if (target) void handleReorder(task.id, target.id)
              }
            }} />
        ) : (
          <ParentTaskCard {...cardProps} childCount={kids.length} doneCount={doneCount}
            expanded={expanded} onToggle={() => toggleParent(task.id)} onCreateChild={() => openCreate(task.id)} />
        )}
        {!isChild && filtered.some(child => child.parent_id === task.id) ? (
          <div className={`task-child-collapse${expanded ? '' : ' is-collapsed'}`}
            aria-hidden={!expanded || undefined} inert={!expanded}>
            <div className="task-child-collapse-inner">
              <ul className="task-list task-child-list" aria-label={`子任务：${task.title}`}>
                {filtered.filter(child => child.parent_id === task.id).map(renderTask)}
              </ul>
            </div>
          </div>
        ) : null}
      </li>
    )
  }

  const hasFilter = keyword.trim() !== '' || statusFilter !== 'all' || assigneeFilter !== 'all'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">待办</h1>
          <p className="page-desc">
            {currentTeam.team.name} · {rows.length} 个{scope === 'active' ? '未归档' : '已归档'}任务
            {rows.length > 0 ? `，当前显示 ${visible.length} 个` : ''}
          </p>
        </div>
        <div className="page-head-actions">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'active'}
              className={scope === 'active' ? 'tab active' : 'tab'}
              onClick={() => setScope('active')}
            >
              进行中与待办
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'archived'}
              className={scope === 'archived' ? 'tab active' : 'tab'}
              onClick={() => setScope('archived')}
            >
              已归档
            </button>
          </div>
          <Button variant="ghost" onClick={refreshAll} disabled={query.loading}>
            刷新
          </Button>
          <Button variant="primary" onClick={() => openCreate()}>
            新建任务
          </Button>
        </div>
      </div>

      {actionError ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="error" onClose={() => setActionError(null)}>
            {actionError}
          </Banner>
        </div>
      ) : null}

      {query.error ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="error">
            <span>{query.error}</span>
            <Button size="sm" variant="ghost" onClick={query.reload}>
              重试
            </Button>
          </Banner>
        </div>
      ) : null}

      <div className="card task-list-card">
        <div className="filter-bar task-filters">
          <div className="search-field">
            <SymbolIcon name="search" />
            <TextInput
              type="search"
              aria-label="搜索任务标题或描述"
              placeholder="搜索标题或描述"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <select className="select" aria-label="按状态筛选" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="all">全部状态</option>
            <option value="todo">未开始</option>
            <option value="in_progress">进行中</option>
            <option value="done">已完成</option>
          </select>
          <select
            className="select"
            aria-label="按负责人筛选"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
          >
            <option value="all">全部负责人</option>
            <option value="unassigned">未分配</option>
            {members
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
          </select>
          {hasFilter ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setKeyword('')
                setStatusFilter('all')
                setAssigneeFilter('all')
              }}
            >
              清除筛选
            </Button>
          ) : null}
          <span className="grow" />
          <span className="tiny faint nowrap task-filter-note">截止 {today} 之前未完成视为逾期</span>
        </div>

        {query.loading && rows.length === 0 ? (
          <InlineLoading label="正在读取任务…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={hasFilter ? '没有符合条件的任务' : scope === 'active' ? '还没有任务' : '没有已归档的任务'}
            description={
              hasFilter
                ? '换个关键词或放宽筛选条件试试。'
                : scope === 'active'
                  ? '新建第一个任务后，它会出现在任务列表与甘特图中。'
                  : '归档的任务会出现在这里，可随时恢复。'
            }
            action={
              !hasFilter && scope === 'active' ? (
                <Button variant="primary" size="sm" onClick={() => openCreate()}>
                  新建任务
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="task-list" aria-label={scope === 'active' ? '任务列表' : '已归档任务'}>
            {filtered.filter(task => task.parent_id == null || !filtered.some(parent => parent.id === task.parent_id)).map(renderTask)}
          </ul>
        )}
      </div>

      <TaskDrawer
        open={drawerOpen}
        task={editing}
        teamId={currentTeamId}
        members={members}
        allTasks={rows}
        parentId={editing ? editing.parent_id : createParentId}
        onClose={() => { setDrawerOpen(false); setCreateParentId(null) }}
        onSaved={() => {
          setDrawerOpen(false)
          setCreateParentId(null)
          refreshAll()
          // 任务里可能有未分配/负责人变化，重拉成员不影响，但保持成员列表新鲜
          void reloadMembers()
        }}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title="归档这个任务？"
        description={
          <>
            <p>「{archiveTarget?.title}」将退出任务列表与甘特图。</p>
            <p style={{ marginTop: 6 }}>归档不会删除记录：历史日报与它的关联仍然可以看到，之后也可以恢复。含子任务的父任务需先归档或处理完子任务。</p>
          </>
        }
        confirmText="归档"
        busy={archiveBusy}
        onConfirm={() => void handleArchive()}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  )
}



FILE: app/src/tasks/TaskCards.tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Avatar, Button, ProgressBar, StatusGlyph } from '../components/ui'
import { diffDays, formatDateTime, type ISODate } from '../lib/dates'
import { isOverdue } from '../lib/stats'
import { statusLabel } from '../lib/progress'
import type { TaskRow, TaskStatus } from '../types/db'

type CardProps = {
  task: TaskRow
  today: ISODate
  assignee: string
  archived: boolean
  restoring: boolean
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
}

type ParentProps = CardProps & {
  childCount: number
  doneCount: number
  expanded: boolean
  onToggle: () => void
  onCreateChild: () => void
}

export function ParentTaskCard({ childCount, doneCount, expanded, onToggle, onCreateChild, ...props }: ParentProps) {
  const { task, today, onEdit } = props
  const hasKids = childCount > 0
  return (
    <TaskCard {...props}
      summary={hasKids ? `${doneCount}/${childCount} · ${task.progress}%` : `${task.progress}%`}
      detail={`${statusLabel(task.status)}${hasKids ? ' · 状态由子任务决定' : ''}`}
      leading={
        <button className="task-open-glyph" onClick={onEdit} aria-hidden="true" tabIndex={-1}>
          <StatusGlyph status={task.status} overdue={isOverdue(task, today)} />
        </button>
      }
      trailing={<>
        {hasKids ? (
          <button type="button" className="task-count-capsule" aria-expanded={expanded}
            aria-label={`${expanded ? '收起' : '展开'}子任务：${task.title}，已完成 ${doneCount}/${childCount}`}
            onClick={event => {
              if (expanded) event.currentTarget.focus()
              onToggle()
            }}>
            <span aria-hidden="true" className="task-count-triangle">▾</span>
            {doneCount}/{childCount}
          </button>
        ) : null}
        <ProgressBar value={task.progress} status={task.status} overdue={isOverdue(task, today)} />
      </>}
      extraAction={!props.archived ? <Button size="sm" variant="ghost" onClick={onCreateChild}>子任务</Button> : null}
      archiveDisabled={hasKids}
    />
  )
}

type ChildProps = CardProps & {
  completing: boolean
  dragging: boolean
  dropTarget: boolean
  dragHandleProps: ButtonHTMLAttributes<HTMLButtonElement>
  onComplete: (done: boolean) => void
}

export function ChildTaskCard({ completing, dragging, dropTarget, dragHandleProps, onComplete, ...props }: ChildProps) {
  const done = props.task.status === 'done'
  const summary = done ? '已完成' : '未完成'
  return (
    <TaskCard {...props} summary={summary} detail={summary}
      className={`task-child${dragging ? ' task-dragging' : ''}${dropTarget ? ' task-drop-target' : ''}`}
      leading={!props.archived ? <>
        <button type="button" className="task-drag-handle" {...dragHandleProps}
          aria-label={`调整子任务顺序：${props.task.title}`} title="拖拽调序；也可用上下方向键">
          <span aria-hidden="true">⠿</span>
        </button>
        <label className="task-check" title={done ? '标为未完成' : '标为完成'}>
          <input type="checkbox" checked={done} disabled={completing}
            onChange={event => onComplete(event.target.checked)}
            aria-label={`${done ? '取消完成' : '完成'}：${props.task.title}`} />
        </label>
      </> : (
        <button className="task-open-glyph" onClick={props.onEdit} aria-hidden="true" tabIndex={-1}>
          <StatusGlyph status={props.task.status} overdue={isOverdue(props.task, props.today)} />
        </button>
      )}
    />
  )
}

function TaskCard({ task, today, assignee, archived, restoring, onEdit, onArchive, onRestore,
  leading, trailing, extraAction, summary, detail, className = '', archiveDisabled = false,
}: CardProps & {
  leading: ReactNode
  trailing?: ReactNode
  extraAction?: ReactNode
  summary: string
  detail: string
  className?: string
  archiveDisabled?: boolean
}) {
  const overdue = isOverdue(task, today)
  const description = task.description?.trim()
  return (
    <div className={`reminder-row task-card${overdue ? ' task-overdue' : ''} ${className}`}>
      {leading}
      <button className="task-open" onClick={onEdit} aria-label={`编辑任务：${task.title}`}>
        <span className="task-content">
          <span className="task-title">{task.title}</span>
          {description && description !== task.title.trim() ? <span className="task-description">{description}</span> : null}
          <span className="task-meta">
            <span className="assignee"><Avatar name={assignee} small />{assignee}</span>
            <span aria-hidden="true">·</span>
            <span className={overdue ? 'overdue-text' : ''}>{task.due_date} · {dueHint(task.due_date, today, task.status)}</span>
            <span aria-hidden="true">·</span>
            <span>{summary}</span>
          </span>
          <span className="task-detail">
            {detail} · {task.start_date} 开始 · {archived ? '归档于' : '更新于'} {formatDateTime(archived ? task.archived_at : task.updated_at)}
          </span>
        </span>
      </button>
      <div className="task-trailing">
        {trailing}
        <div className="task-actions">
          <Button size="sm" variant="ghost" onClick={onEdit}>编辑</Button>
          {extraAction}
          {archived ? (
            <Button size="sm" variant="ghost" loading={restoring} onClick={onRestore}>恢复</Button>
          ) : (
            <Button size="sm" variant="ghost" className="destructive-text" onClick={onArchive} disabled={archiveDisabled}>归档</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function dueHint(due: ISODate, today: ISODate, status: TaskStatus): string {
  if (status === 'done') return statusLabel(status)
  const delta = diffDays(today, due)
  if (delta === 0) return '今天截止'
  if (delta > 0) return `还有 ${delta} 天`
  return `逾期 ${-delta} 天`
}


FILE: app/src/tasks/appearance.ts
const taskColors = ['mint', 'sky', 'lemon', 'peach', 'lavender', 'apricot', 'aqua', 'rose', 'sage', 'periwinkle'] as const

export function taskColor(id: number): typeof taskColors[number] {
  let hash = 2166136261
  for (const char of String(id)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return taskColors[(hash >>> 0) % taskColors.length]
}


FILE: app/src/tasks/collapse.ts
const key = 'jeayon.tasks.collapsed'
export type CollapsedTasks = Record<string, true>

export function collapseKey(teamId: number, parentId: number): string {
  return `${teamId}:${parentId}`
}

export function readCollapsed(storage: Pick<Storage, 'getItem'>): CollapsedTasks {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([id, collapsed]) => /^\d+:\d+$/.test(id) && collapsed === true))
  } catch { return {} }
}

export function writeCollapsed(storage: Pick<Storage, 'setItem'>, value: CollapsedTasks): void {
  try { storage.setItem(key, JSON.stringify(value)) } catch { /* Storage may be disabled; in-page state still works. */ }
}


FILE: app/src/tasks/hierarchy.ts
/**
 * One-level parent → children ordering for list/gantt.
 *
 * Contract (mirrors server/src/tasks/hierarchy-contract.ts):
 * - PARENT progress = round(done_count / active_children * 100); status from that.
 * - CHILD is binary done/todo; completion via PATCH /complete.
 * - LEAF keeps full status/progress.
 */
import type { TaskRow } from '../types/db'

export function childTasks(tasks: readonly TaskRow[], parentId: number): TaskRow[] {
  return tasks.filter((t) => t.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
}

export function hasActiveChildren(tasks: readonly TaskRow[], parentId: number): boolean {
  return tasks.some((t) => t.parent_id === parentId && t.archived_at === null)
}

/** Keep root query order; siblings always follow their persisted order. */
export function flattenTaskTree(tasks: readonly TaskRow[]): TaskRow[] {
  const roots = tasks.filter((t) => t.parent_id == null)
  const out: TaskRow[] = []
  for (const root of roots) {
    out.push(root)
    out.push(...childTasks(tasks, root.id))
  }
  const seen = new Set(out.map((t) => t.id))
  for (const t of tasks) {
    if (!seen.has(t.id)) out.push(t)
  }
  return out
}

/** Move within the complete active sibling set, including siblings hidden by filters. */
export function moveChild(tasks: readonly TaskRow[], sourceId: number, targetId: number): TaskRow[] | null {
  const source = tasks.find(task => task.id === sourceId)
  const target = tasks.find(task => task.id === targetId)
  if (!source || !target || sourceId === targetId || source.parent_id == null ||
    source.parent_id !== target.parent_id || source.archived_at || target.archived_at) return null
  const siblings = childTasks(tasks, source.parent_id).filter(task => task.archived_at === null)
  const from = siblings.findIndex(task => task.id === sourceId)
  const to = siblings.findIndex(task => task.id === targetId)
  siblings.splice(from, 1)
  siblings.splice(to, 0, source)
  return siblings.map((task, sort_order) => ({ ...task, sort_order }))
}


FILE: app/tests/unit/task-appearance.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { taskColor } from '../../src/tasks/appearance'

test('task IDs keep their colors independently of input order and cover the pastel palette', () => {
  const ids = Array.from({ length: 1000 }, (_, index) => index + 1)
  const colors = new Map(ids.map(id => [id, taskColor(id)]))
  for (const id of [...ids].reverse()) assert.equal(taskColor(id), colors.get(id))
  assert.equal(new Set(colors.values()).size, 10)
  assert.equal(taskColor(Number.MAX_SAFE_INTEGER), taskColor(Number.MAX_SAFE_INTEGER))
})

const css = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8')
const rule = (selector: string) => css.slice(css.indexOf(`\n${selector} {`)).split('}')[0]

test('the sibling group reveals vertically with 200ms expansion and 150ms collapse', () => {
  assert.match(rule('.task-child-collapse'), /display: grid/)
  assert.match(rule('.task-child-collapse'), /grid-template-rows: 1fr/)
  assert.match(rule('.task-child-collapse'), /transition: grid-template-rows 200ms/)
  assert.match(rule('.task-child-collapse.is-collapsed'), /grid-template-rows: 0fr/)
  assert.match(rule('.task-child-collapse.is-collapsed'), /transition-duration: 150ms/)
  assert.match(rule('.task-child-collapse-inner'), /min-height: 0/)
  assert.match(rule('.task-child-collapse-inner'), /overflow: hidden/)
  assert.match(rule('.task-child-list'), /padding: 4px/)
  assert.doesNotMatch(rule('.task-child-collapse'), /clip-path|display: none|opacity|delay/)
  assert.doesNotMatch(css, /task-expand-delay|@starting-style|allow-discrete/)
})

test('disclosure points right when collapsed and down when expanded, with matching timing', () => {
  assert.match(rule('.task-count-triangle'), /transform: rotate\(0deg\)/)
  assert.match(rule('.task-count-triangle'), /transition: transform 200ms/)
  assert.match(rule('.task-count-capsule[aria-expanded="false"] .task-count-triangle'), /rotate\(-90deg\)/)
  assert.match(rule('.task-count-capsule[aria-expanded="false"] .task-count-triangle'), /transition-duration: 150ms/)
})

test('reduced motion makes the group height and triangle instantaneous without stagger', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.task-child-collapse, \.task-count-triangle \{ transition-duration: 0s !important; transition-delay: 0s !important;/)
})


FILE: logs/notion-vertical-expand-dom.mjs
// Real React components + real HTTP/Fastify/PostgreSQL; jsdom supplies DOM/event APIs only.
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { JSDOM } from '../app/node_modules/jsdom/lib/api.js';
import React, { act } from '../app/node_modules/react/index.js';
import { createServer } from '../app/node_modules/vite/dist/node/index.js';
import { harness, task } from '../server/tests/helpers.ts';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://127.0.0.1/tasks' });
for (const key of ['window','document','HTMLElement','Element','Node','MutationObserver']) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('../app/node_modules/react-dom/client.js');
const h = await harness();
const vite = await createServer({ root: new URL('../app', import.meta.url).pathname, configFile: false, server: { middlewareMode: true } });
const originalFetch = globalThis.fetch;
let root;
const traffic = [];
let gate = null;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function settle(check, label) {
  for (let i = 0; i < 120; i++) {
    await act(async () => { await pause(10); });
    if (check()) return;
  }
  throw new Error('Timed out: ' + label);
}
try {
  const owner = await h.login('task-dom@example.test');
  const created = (await owner.client.send('POST', '/api/teams', { name: 'DOM acceptance', display_name: 'Tester' })).json().data;
  const team = created.team_id;
  async function create(title, parentId) {
    const r = await owner.client.send('POST', `/api/teams/${team}/tasks`, { ...task, title, ...(parentId ? { parent_id: parentId } : {}) });
    assert.equal(r.statusCode, 201, r.body); return r.json().data;
  }
  const p = await create('Capsule parent');
  const a = await create('Child A', p.id);
  const b = await create('Child B', p.id);
  const c = await create('Child C', p.id);
  const other = await create('Other parent');
  const foreign = await create('Foreign child', other.id);
  const leaf = await create('Standalone leaf');
  assert.equal((await owner.client.send('PATCH', `/api/tasks/${b.id}/complete`, { done: true, expected_version: b.version })).statusCode, 200);
  const initialSession = (await owner.client.send('GET', '/api/auth/me')).json().data;
  const origin = await h.app.listen({ host: '127.0.0.1', port: 0 });
  globalThis.fetch = async (path, options = {}) => {
    if (String(path).endsWith('/children/reorder') && gate) await gate;
    const headers = new Headers(options.headers);
    headers.set('Origin', h.config.APP_ORIGIN);
    headers.set('Cookie', owner.client.cookieHeader());
    const response = await originalFetch(new URL(path, origin), { ...options, headers });
    traffic.push({ path: String(path), method: options.method ?? 'GET', status: response.status });
    return response;
  };
  const { TasksPage } = await vite.ssrLoadModule('/src/tasks/TasksPage.tsx');
  const { AuthProvider } = await vite.ssrLoadModule('/src/auth/AuthProvider.tsx');
  const { TeamProvider } = await vite.ssrLoadModule('/src/teams/TeamProvider.tsx');
  function app() { return React.createElement(AuthProvider, { initialSession }, React.createElement(TeamProvider, null, React.createElement(TasksPage))); }
  async function mount() {
    root = createRoot(document.getElementById('root'));
    await act(async () => { root.render(app()); });
    await settle(() => document.querySelector(`[data-task-id="${p.id}"]`), 'load parent');
    await settle(() => !document.querySelector('.task-list-item:not([inert]) > .task-child .task-drag-handle:disabled'), 'finish query');
  }
  const ids = () => [...document.querySelectorAll('[data-task-id]')].filter(el => el.querySelector(':scope > .task-child') && el.getAttribute('aria-hidden') !== 'true').map(el => Number(el.dataset.taskId));
  const row = id => document.querySelector(`[data-task-id="${id}"]`);
  const capsule = () => row(p.id).querySelector('.task-count-capsule');
  const group = () => row(p.id).querySelector('.task-child-collapse');
  const handle = id => row(id).querySelector('.task-drag-handle');
  const dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' };
  async function drag(sourceId, targetId) {
    await act(async () => {
      const e = new window.Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: dataTransfer }); handle(sourceId).dispatchEvent(e);
    });
    await act(async () => {
      const e = new window.Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: dataTransfer }); row(targetId).dispatchEvent(e);
    });
    await act(async () => {
      const e = new window.Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'dataTransfer', { value: dataTransfer }); row(targetId).dispatchEvent(e);
    });
  }
  await mount();
  const style = await readFile(new URL('../app/src/styles/global.css', import.meta.url), 'utf8');
  const stylesheet = document.createElement('style');
  stylesheet.textContent = style; document.head.appendChild(stylesheet);
  assert.match(style, /grid-template-rows 200ms cubic-bezier/);
  assert.match(style, /grid-template-rows: 0fr; transition-duration: 150ms/);
  assert.doesNotMatch(style, /task-expand-delay|@starting-style|allow-discrete/);
  assert.match(style, /transition-delay:\s*0s !important/);
  assert.match(style, /transition-duration:\s*0s !important/);
  assert.deepEqual(ids(), [a.id,b.id,c.id,foreign.id]);
  assert.equal(capsule().getAttribute('aria-expanded'), 'true');
  assert.equal(capsule().textContent.replace(/[▾▸\s]/g, ''), '1/3');
  assert.ok(row(p.id).querySelector('.progress'));
  assert.ok(!document.querySelector('.task-detail').textContent.includes('#'));
  assert.ok([...document.querySelectorAll('.task-child .task-title')].every(el => !/^\d+[.、\s]/.test(el.textContent)));
  const derived = row(p.id).querySelector('.task-meta').textContent;
  assert.equal(row(leaf.id).querySelector('.task-count-capsule'), null, 'leaf has no disclosure');
  assert.equal(row(leaf.id).hasAttribute('inert'), false);
  assert.ok(!row(leaf.id).classList.contains('task-child-collapse'));
  const keptChild = row(a.id);
  assert.ok(keptChild.querySelector('.task-card.task-child'));
  const colors = new Map([...document.querySelectorAll('[data-task-id]')].map(el => [el.dataset.taskId, el.dataset.taskColor]));
  assert.ok([...colors.values()].every(color => color));
  assert.deepEqual([a,b,c].map(t => row(t.id).style.getPropertyValue('--task-expand-delay')), ['', '', '']);
  assert.equal(document.querySelectorAll('.task-child-collapse').length, 2, 'one disclosure container per parent');
  assert.deepEqual([...group().querySelectorAll('[data-task-id]')].map(el => Number(el.dataset.taskId)), [a.id,b.id,c.id]);
  assert.match(window.getComputedStyle(group()).transition, /grid-template-rows 200ms/);
  assert.equal(window.getComputedStyle(group()).gridTemplateRows, '1fr');
  assert.equal(window.getComputedStyle(group().firstElementChild).overflow, 'hidden');
  assert.equal(parseFloat(window.getComputedStyle(group().firstElementChild).minHeight), 0);
  handle(a.id).focus();
  assert.equal(document.activeElement, handle(a.id));
  await act(async () => capsule().click());
  assert.equal(row(a.id), keptChild, 'collapse retains the same DOM node for transition');
  assert.equal(document.activeElement, capsule(), 'focus leaves the hidden subtree');
  assert.equal(window.getComputedStyle(group()).display, 'grid');
  assert.equal(window.getComputedStyle(group()).gridTemplateRows, '0fr');
  assert.equal(window.getComputedStyle(group()).transitionDuration, '150ms');
  assert.equal(group().getAttribute('aria-hidden'), 'true');
  assert.equal(group().hasAttribute('inert'), true);
  assert.equal(window.getComputedStyle(capsule().querySelector('.task-count-triangle')).transform, 'rotate(-90deg)');
  assert.equal(row(a.id).getAttribute('aria-hidden'), 'true');
  assert.equal(row(a.id).hasAttribute('inert'), true);
  assert.ok(group().classList.contains('is-collapsed'));
  assert.equal(handle(a.id).draggable, false);
  assert.equal(capsule().getAttribute('aria-expanded'), 'false');
  assert.deepEqual(ids(), [foreign.id]);
  assert.equal(row(p.id).querySelector('.task-meta').textContent, derived);
  assert.ok(row(p.id).querySelector('.progress'));
  await act(async () => root.unmount()); root = null;
  await mount();
  assert.equal(capsule().getAttribute('aria-expanded'), 'false');
  assert.deepEqual(ids(), [foreign.id]);
  await act(async () => capsule().click());
  assert.equal(window.getComputedStyle(group()).gridTemplateRows, '1fr');
  assert.equal(group().hasAttribute('inert'), false);
  assert.equal(group().getAttribute('aria-hidden'), null);
  for (const [id, color] of colors) assert.equal(row(id).dataset.taskColor, color, 'color survives remount');
  assert.equal(window.getComputedStyle(capsule().querySelector('.task-count-triangle')).transform, 'rotate(0deg)');
  assert.equal(row(a.id).hasAttribute('inert'), false);
  assert.equal(row(a.id).getAttribute('aria-hidden'), null);
  assert.ok(!group().classList.contains('is-collapsed'));
  assert.deepEqual(ids(), [a.id,b.id,c.id,foreign.id]);
  const stableChild = row(a.id);
  for (let i = 0; i < 8; i++) await act(async () => capsule().click());
  assert.equal(row(a.id), stableChild, 'rapid reversals keep DOM and final expanded state');
  assert.equal(capsule().getAttribute('aria-expanded'), 'true');
  assert.deepEqual(ids(), [a.id,b.id,c.id,foreign.id]);
  let release;
  gate = new Promise(resolve => { release = resolve; });
  await drag(c.id, a.id);
  assert.deepEqual(ids(), [c.id,a.id,b.id,foreign.id]); // optimistic, request still held
  release(); gate = null;
  await settle(() => !handle(c.id).disabled, 'persist drag');
  const persisted = (await owner.client.send('GET', `/api/teams/${team}/tasks`)).json().data.filter(t => t.parent_id === p.id);
  assert.deepEqual(persisted.map(t => t.id), [c.id,a.id,b.id]);
  await act(async () => root.unmount()); root = null;
  await mount();
  assert.deepEqual(ids(), [c.id,a.id,b.id,foreign.id]);
  // A real concurrent edit makes the held reorder stale and returns HTTP 409.
  gate = new Promise(resolve => { release = resolve; });
  await drag(c.id, b.id);
  assert.deepEqual(ids(), [a.id,b.id,c.id,foreign.id]);
  const current = (await owner.client.send('GET', `/api/tasks/${a.id}`)).json().data;
  assert.equal((await owner.client.send('PUT', `/api/tasks/${a.id}`, { ...task, title: 'Child A edited', expected_version: current.version })).statusCode, 200);
  release(); gate = null;
  await settle(() => document.body.textContent.includes('排序未保存'), 'conflict banner');
  await settle(() => !handle(c.id).disabled, 'reload after rollback');
  assert.deepEqual(ids(), [c.id,a.id,b.id,foreign.id]);
  const calls = traffic.filter(t => t.path.endsWith('/children/reorder')).length;
  await drag(c.id, foreign.id);
  assert.deepEqual(ids(), [c.id,a.id,b.id,foreign.id]);
  assert.equal(traffic.filter(t => t.path.endsWith('/children/reorder')).length, calls);
  await act(async () => handle(c.id).dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  await settle(() => !handle(c.id).disabled, 'keyboard persist');
  assert.deepEqual(ids(), [a.id,c.id,b.id,foreign.id]);
  // A filtered drag must still submit siblings hidden by the filter.
  const search = document.querySelector('input[type=search]');
  const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setInput.call(search, 'Child'); search.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  assert.ok(row(p.id), 'matching children retain their parent context');
  await act(async () => capsule().click());
  assert.deepEqual(ids(), [foreign.id]);
  await act(async () => capsule().click());
  assert.deepEqual(ids(), [a.id,c.id,b.id,foreign.id]);
  const filter = document.querySelector('select[aria-label="按状态筛选"]');
  await act(async () => { filter.value = 'todo'; filter.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.deepEqual(ids(), [a.id,c.id,foreign.id]); // completed B is hidden
  await drag(c.id, a.id);
  await settle(() => !handle(c.id).disabled, 'filtered reorder persists');
  const complete = (await owner.client.send('GET', `/api/teams/${team}/tasks`)).json().data.filter(t => t.parent_id === p.id);
  assert.deepEqual(complete.map(t => t.id), [c.id,a.id,b.id]);
  await act(async () => { filter.value = 'all'; filter.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.deepEqual(ids(), [c.id,a.id,b.id,foreign.id]);
  await act(async () => { setInput.call(search, ''); search.dispatchEvent(new window.Event('input', { bubbles: true })); });
  for (const [id, color] of colors) assert.equal(row(id).dataset.taskColor, color, 'color survives filter/reorder');
  // Stop the real HTTP listener to verify network failure rollback without a fake response.
  await h.app.close();
  await drag(c.id, b.id);
  await settle(() => document.body.textContent.includes('排序未保存，已回滚。网络请求失败'), 'network failure banner');
  assert.deepEqual(ids(), [c.id,a.id,b.id,foreign.id]);
  await writeFile(new URL('./notion-vertical-expand-dom.html', import.meta.url), document.documentElement.outerHTML);
  const result = { time: new Date().toISOString(), event: 'notion_vertical_react_dom_acceptance', result: 'PASS', backend: 'real HTTP/Fastify/PostgreSQL16 dwa_test', browser: 'unavailable; DOM events are automated component checks, no visual claim', checks: ['default expanded capsule 1/3','collapse hides children and keeps derived parent progress','sessionStorage survives remount','one vertical sibling grid, 200ms expand/150ms collapse, no stagger, shadow gutter + reduced-motion zero duration/delay','retained child DOM inert/aria-hidden while collapsed','rapid repeated reversal and enabled drag after expansion','leaf remains unchanged without disclosure','no database/group numbering','native drag events optimistic before HTTP','order persists across component remount','real 409 rollback and banner','cross-parent drag sends no request','keyboard reorder persists','filtered reorder includes hidden siblings and keeps parent context','real disconnected HTTP listener rolls back with network error'], traffic };
  await appendFile(new URL('./notion-vertical-expand-20261028.jsonl', import.meta.url), JSON.stringify(result)+'\n');
  console.log(JSON.stringify(result));
} finally {
  gate = null;
  if (root) await act(async () => root.unmount());
  globalThis.fetch = originalFetch;
  await vite.close(); await h.close(); dom.window.close();
}


FILE: logs/notion-vertical-expand-deployed-verify.txt
Server-local resolved HTTPS: PASS; 11 hashes match; health/brand/animation/unchanged backend verified
Workspace --resolve over SSH tunnel: PASS; 11 hashes match; TLS verified


FILE: app/src/styles/global.css (task-card section)
.task-list-item[data-task-color="mint"] { --task-tint: light-dark(#edf8f2, #182c25); --task-stripe: light-dark(#78b69a, #70b296); }
.task-list-item[data-task-color="sky"] { --task-tint: light-dark(#edf5fc, #1b2837); --task-stripe: light-dark(#84add3, #7ca6cf); }
.task-list-item[data-task-color="lemon"] { --task-tint: light-dark(#faf8e9, #2c2a1b); --task-stripe: light-dark(#c1b66f, #bdb174); }
.task-list-item[data-task-color="peach"] { --task-tint: light-dark(#fcf0ec, #32231f); --task-stripe: light-dark(#d9a18d, #ca9a87); }
.task-list-item[data-task-color="lavender"] { --task-tint: light-dark(#f4effb, #292236); --task-stripe: light-dark(#b49bcf, #ad95c6); }
.task-list-item[data-task-color="apricot"] { --task-tint: light-dark(#fcf4e9, #30271b); --task-stripe: light-dark(#d2ae7c, #c4a477); }
.task-list-item[data-task-color="aqua"] { --task-tint: light-dark(#eaf7f7, #182c2f); --task-stripe: light-dark(#7db8bd, #76acb2); }
.task-list-item[data-task-color="rose"] { --task-tint: light-dark(#fbeff4, #32222b); --task-stripe: light-dark(#cf9bb1, #c293aa); }
.task-list-item[data-task-color="sage"] { --task-tint: light-dark(#f2f6ec, #252c20); --task-stripe: light-dark(#a3b68a, #9eae87); }
.task-list-item[data-task-color="periwinkle"] { --task-tint: light-dark(#f0f1fc, #22263a); --task-stripe: light-dark(#9ba4d4, #959fcb); }
.task-list-item { padding-bottom: 10px; }
.task-list-item + .task-list-item:not(.task-child-collapse) { padding-top: 10px; }
.task-card { padding: 18px 20px; border: 1px solid var(--line); border-left: 4px solid var(--task-stripe); border-radius: 16px; background: var(--task-tint); box-shadow: var(--shadow-1); }
.task-card .task-title { color: var(--ink); }
.task-card .task-trailing { width: 144px; }
.task-child { gap: 16px; }
.task-child .task-title { font-weight: 500; }
/* Reveal all siblings together below the parent; padding keeps card shadows inside the clip. */
.task-child-collapse { display: grid; grid-template-rows: 1fr; margin-left: 24px; transition: grid-template-rows 200ms cubic-bezier(.22, 1, .36, 1); }
.task-child-collapse.is-collapsed { grid-template-rows: 0fr; transition-duration: 150ms; }
.task-child-collapse-inner { min-height: 0; overflow: hidden; }
.task-child-list { padding: 4px; }
@media (prefers-reduced-motion: reduce) {
  .task-child-collapse, .task-count-triangle { transition-duration: 0s !important; transition-delay: 0s !important; }
}

.task-check { display: inline-grid; place-items: center; width: 28px; flex: none; margin-top: 4px; cursor: pointer; }
.task-check input { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; }
.task-open-glyph { border: 0; background: transparent; padding: 0; margin-top: 2px; cursor: pointer; }
.task-child .task-open { padding-left: 0; }
.task-count-capsule { align-self: flex-end; display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 58px; min-height: 30px; padding: 4px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-soft); font: inherit; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; transition: background .15s, color .15s; }
.task-count-capsule:hover { background: var(--fill-soft, #f2f2f7); color: var(--ink); }
.task-count-capsule:focus-visible, .task-drag-handle:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.task-count-triangle { display: inline-block; font-size: 11px; opacity: .65; transform: rotate(0deg); transition: transform 200ms cubic-bezier(.22, 1, .36, 1); }
.task-count-capsule[aria-expanded="false"] .task-count-triangle { transform: rotate(-90deg); transition-duration: 150ms; }
.task-drag-handle { flex: none; width: 24px; min-height: 32px; margin-right: -8px; border: 0; border-radius: 6px; background: transparent; color: var(--ink-faint); font-size: 20px; cursor: grab; }
.task-drag-handle:active { cursor: grabbing; }
.task-drag-handle:disabled { opacity: .35; cursor: default; }
.task-dragging { opacity: .45; }
.task-drop-target { box-shadow: inset 0 2px var(--accent); }
@media (max-width: 760px) {
  .task-card { padding: 16px 12px; }
  .task-child-collapse { margin-left: 8px; }
  .task-child .task-drag-handle { float: left; margin: 0 4px 0 0; }
  .task-child .task-check { float: left; margin: 4px 4px 0 0; }
  .task-child .task-open { width: calc(100% - 60px); }
  .task-child .task-open-glyph { float: left; margin-right: 8px; }
  .task-card .task-trailing { width: auto; padding-left: 0; gap: 12px; flex-wrap: wrap; }
  .task-card .task-trailing > .progress { min-width: 48px; }
  .task-count-capsule { align-self: center; flex: none; }
}



Latest actual checks:
{"app-tests": {"check": "app-tests", "exit_code": 0, "file": "logs/notion-vertical-expand-final-app-tests.txt", "sha256": "b38b2e3920a17e99fde45063afdd7927aa325f5e0314470f07ef0f126a505dab", "output_tail": "dateToX / dateAtX 严格互逆（含跨月、跨年、闰年） (0.524721ms)\n✔ dateAtX 在格子中间仍然落在当天（向下取整） (0.136156ms)\n✔ barRect：结束日含当天，起止同日为 1 天宽 (0.146145ms)\n✔ snapDays 按当前缩放吸附到整天 (0.281667ms)\n✔ todayLineX 在区间内返回坐标，区间外返回 null (0.145016ms)\n✔ daysInMonth 处理闰年与大小月 (0.162334ms)\n✔ buildTicks：月视图按真实月长铺格，闰年 2 月是 29 天 (0.461139ms)\n✔ buildTicks：周视图每格 7 天，第 N 周标注正确 (0.502281ms)\n✔ buildTicks：日视图区分周末与今天 (2.028469ms)\n✔ applyDragDates：整体平移不改变长度 (0.872312ms)\n✔ applyDragDates：拖边缘保持最短一天，且不越过另一端 (0.153615ms)\n✔ applyDragDates 跨月跨年都用自然日累加 (1.195699ms)\n✔ 邀请码：仅 owner 与 admin 可查看/重置 (1.829589ms)\n✔ 改角色：仅 owner (0.131183ms)\n✔ 移除成员：owner 可移除除 owner 外的任何人，admin 只能移除 member (0.210233ms)\n✔ 移除成员：不能移除自己，也不能重复移除已停用成员 (0.187695ms)\n✔ 授予/取消管理员：仅 owner，且不能对自己或已停用成员操作 (0.117033ms)\n✔ 任务维护：只要还是有效成员就可以 (0.085868ms)\n✔ 日报改删：只能动自己的，且必须仍是有效成员 (0.082967ms)\n✔ 角色文案与排序 (0.545488ms)\n✔ normalizeProgress 夹到 0–100 并取整 (0.630573ms)\n✔ statusForProgress：0 未开始，1–99 进行中，100 已完成 (0.13233ms)\n✔ progressForStatus：todo/done 强制 0/100，in_progress 保留 1–99 (0.121545ms)\n✔ withStatus 与 withProgress 保持状态与进度一致 (0.62644ms)\n✔ averageProgress：等权平均、保留一位小数、无任务返回 null (0.256679ms)\n✔ statusLabel 使用固定中文文案 (0.10903ms)\n✔ isOverdue：截止当天不算逾期，已完成与已归档都不算 (0.687992ms)\n✔ isDueSoon：今天起 7 个自然日闭区间，第 8 天不算 (0.310952ms)\n✔ computeDashboard 汇总口径与归档过滤 (0.745824ms)\n✔ computeDashboard：无任务时平均进度为 null (0.111912ms)\n✔ latestLog 取工作日期最大者，同日取更新时间最晚 (0.229848ms)\n✔ groupLogsByDate 按日期倒序、同日按姓名中文排序 (5.876078ms)\n✔ task IDs keep their colors independently of input order and cover the pastel palette (2.221064ms)\n✔ the sibling group reveals vertically with 200ms expansion and 150ms collapse (0.522926ms)\n✔ disclosure points right when collapsed and down when expanded, with matching timing (0.178763ms)\n✔ reduced motion makes the group height and triangle instantaneous without stagger (0.150741ms)\n✔ tree keeps roots in query order and children in sort_order/id order (1.079351ms)\n✔ move uses all active siblings, keeps metadata and refuses cross-parent/root/archive/no-op drops (0.31402ms)\n✔ collapse defaults open, persists per team/parent and tolerates unavailable or corrupt session storage (0.550517ms)\nℹ tests 61\nℹ suites 0\nℹ pass 61\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 193.803868\n"}, "app-typecheck": {"check": "app-typecheck", "exit_code": 0, "file": "logs/notion-vertical-expand-final-app-typecheck.txt", "sha256": "187e0b490daa5ebc2861ac4109468cdf17a1269a389ad5276cb7aef2b34018d8", "output_tail": "\n> daily-work-agent@0.1.0 typecheck\n> tsc --noEmit -p tsconfig.json\n\n"}, "app-build": {"check": "app-build", "exit_code": 0, "file": "logs/notion-vertical-expand-final-app-build.txt", "sha256": "563d561d01d12c2e40084203dd7a12e41a89b8ebf1601810c1083e257a03e90a", "output_tail": "\n> daily-work-agent@0.1.0 build\n> tsc --noEmit -p tsconfig.json && vite build\n\nvite v8.3.5 building client environment for production...\ntransforming...\n✓ 61 modules transformed.\nrendering chunks...\ncomputing gzip size...\ndist/index.html                        1.17 kB │ gzip:   0.56 kB\ndist/assets/brand-icon-DuH0ontR.png   28.36 kB\ndist/assets/index-C_kHRnPu.css        45.35 kB │ gzip:   9.66 kB\ndist/assets/index-C_hSDo0q.js        375.08 kB │ gzip: 114.87 kB\n\n✓ built in 792ms\n"}, "server-tests": {"check": "server-tests", "exit_code": 0, "file": "logs/notion-vertical-expand-final-server-tests.txt", "sha256": "91ec923d439b0abd34be30ace7f0fd329aeb66aab1452c906eb9a7839bcfb01d", "output_tail": "125550100 (0.077002ms)\n  ✔ rejects invalid phone 23800138000 (0.06075ms)\n  ✔ rejects invalid phone 138001380001 (0.07097ms)\n  ✔ rejects invalid phone 1380013800 (0.115442ms)\n  ✔ rejects invalid phone 13800138000ext1 (0.191894ms)\n  ✔ lowercases email, preserving plus tags and dots (0.263873ms)\n  ✔ rejects invalid email \"a@b.com\\n\" (0.126356ms)\n  ✔ rejects invalid email \"a@b.com\\r\\nBcc:x@y.com\" (0.049123ms)\n  ✔ rejects invalid email \"a@b.com,c@d.com\" (0.119325ms)\n  ✔ rejects invalid email \"中@b.com\" (0.111313ms)\n  ✔ rejects invalid email \"a..b@x.com\" (0.071803ms)\n  ✔ rejects invalid email \"a@-x.com\" (0.075529ms)\n  ✔ rejects invalid email \"a@b..com\" (0.054981ms)\n  ✔ rejects invalid email \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa (0.039917ms)\n  ✔ HMAC is bound to challenge, purpose, identity, channel and key version (0.676073ms)\n  ✔ expires at the exact boundary and closes after five attempts (0.116822ms)\n  ✔ uses IPv6 /64 buckets and collapses IPv4 mapped addresses (1.095019ms)\n  ✔ validates real calendar dates and guards unsafe IDs (1.46472ms)\n✔ normalization and OTP primitives (7.681024ms)\n▶ startup and destructive test guard\n  ✔ accepts only explicit development console configuration (2.728185ms)\n  ✔ refuses console in test (0.475324ms)\n  ✔ refuses console in production (0.252562ms)\n  ✔ refuses missing production providers and weak secrets (1.000191ms)\n  ✔ refuses unsafe origins and identical secrets (0.478522ms)\n  ✔ refuses test database omission or a non-dwa_test database (0.156006ms)\n✔ startup and destructive test guard (5.364222ms)\n▶ Tencent TC3 and request adapters (no network)\n  ✔ matches an independent Python hashlib/hmac vector using the official canonical example (0.37414ms)\n  ✔ sends exact SES template fields and validates the receipt (1.682335ms)\n  ✔ sends SmsSdkAppId, ordered params and validates per-number acceptance (0.713393ms)\n  ✔ rejects HTTP error (0.699701ms)\n  ✔ rejects API error (0.878349ms)\n  ✔ rejects SMS status failure (0.507425ms)\n  ✔ rejects missing receipt (0.48134ms)\n✔ Tencent TC3 and request adapters (no network) (5.638239ms)\nℹ tests 188\nℹ suites 19\nℹ pass 188\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 14089.096835\n"}, "server-typecheck": {"check": "server-typecheck", "exit_code": 0, "file": "logs/notion-vertical-expand-final-server-typecheck.txt", "sha256": "00a80dae07ba5af2a311a3613678bfdb832822ef4c083c0f10cd38e8af5c2632", "output_tail": "\n> daily-work-api@0.1.0 typecheck\n> tsc --noEmit\n\n"}, "server-build": {"check": "server-build", "exit_code": 0, "file": "logs/notion-vertical-expand-final-server-build.txt", "sha256": "516c237e1b17e72df71c506820a113003dcc76a3ed2b0fd5d97d594d5ffab412", "output_tail": "\n> daily-work-api@0.1.0 build\n> tsc -p tsconfig.build.json\n\n"}}

Brand/nav source:
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
              value={cu