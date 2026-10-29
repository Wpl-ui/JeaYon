# 每日工作 · 团队任务与日报

一个小团队自用的协作工具：任务带进度和起止日期，用甘特图看排期，每天写一篇标准日报。
账号、数据、权限都在云端（WorkBuddy Cloud Auth + Database），多人共用同一份数据。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 构建 | Vite 8 + React 19 + TypeScript 5.9（严格模式） |
| 路由 | react-router-dom 7，**HashRouter**（静态托管不需要服务端 rewrite） |
| 后端 | `@tencent-ai/workbuddy-cloud-sdk`（认证 + Postgres 数据库 + RLS + RPC） |
| 日期 | 自写的自然日工具（`src/lib/dates.ts`）+ date-fns 仅用于少量格式化 |
| 样式 | 单一 `global.css`，CSS 变量 + 原生类名，无 UI 库 |
| 甘特图 | React + Pointer Events + 纯函数刻度（`src/gantt/gantt-scale.ts`），无第三方库 |

运行要求：Node ≥ 20（当前验证于 Node 22.22.2 / npm 10.9.7）。

## 线上访问

已发布为 HTTPS 应用，团队直接用这个地址打开：

```
https://daily-work-84804.app.workbuddy.host/?sharecode=2YANPJPZ7B
```

两点必须知道：

- **`?sharecode=` 不能删**。平台按这个参数放行，去掉它或只保留域名会返回 403「链接不完整」。
  转发给同事时请整条复制，微信/钉钉里长链接容易被截断。
- 该域名与云服务的 Origin 绑定，**换域名会让云端登录失效**，不要随意改。
  实测依据与「绑自有域名」的唯一可行路径见 [`docs/custom-domain.md`](docs/custom-domain.md)。

## 本地开发

```bash
npm install
npm run dev          # http://127.0.0.1:5183
```

其他命令：

```bash
npm run typecheck    # tsc --noEmit
npm test             # node:test + tsx，跑 tests/unit 下全部用例
npm run check        # typecheck + test（提交前跑这个）
npm run build        # 类型检查 + 产出 dist/（base 为相对路径，可直接静态托管）
```

## 环境配置

云端连接参数在 `src/config/publicConfig.ts`，已内置本应用的真实配置，可直接运行。
需要切换到别的云环境时，在项目根目录建 `.env.local` 覆盖（Vite 只暴露 `VITE_` 前缀）：

```dotenv
VITE_WBCS_RESOURCE_ID=wbcs_xxx
VITE_WBCS_ENDPOINT=https://xxx.app.workbuddy.host
VITE_WBCS_OAUTH_RELAY=https://www.workbuddy.cn/v2/as/genie-baas/oauth
VITE_WBCS_PUBLISHABLE_KEY=wbpk_xxx
```

- 这里只有 `publishableKey`（可公开的客户端标识），**不含** service_role 等管理员凭证。
- 全应用只创建一个 Cloud Client（`src/lib/cloud.ts`）；不要在组件里重复初始化。
- `endpoint` / `publishableKey` 与实际云环境不匹配时，请求会直接被拒，不会静默降级到本地假数据。

## 云端资源

- 应用名：`每日工作`（`wbapp_0Tm71W7PKSg6dZLqOcVyRB`），环境含 Database / Auth。
- 表：`teams`、`team_members`、`team_invites`、`tasks`、`work_logs`。
- 所有业务表启用 RLS；用户列统一 `TEXT`（`auth.uid()` 返回 text）。
- 写操作契约：`tasks` / `work_logs` 表只授 `SELECT` + `INSERT`，改、删、归档一律走
  `SECURITY DEFINER` 的 RPC（`app_task_update`、`app_task_archive`、`app_worklog_update`、
  `app_worklog_delete` 等），带 `expected_version` 做乐观并发，`team_id` 与作者/创建者客户端改不了。
- `team_invites` 不授任何表权限，邀请码只能通过 `app_get_invite_code` / `app_reset_invite_code` 读写。

## 目录结构

```
src/
  config/      publicConfig        云端连接参数
  lib/         cloud  dates  db  errors  permissions  progress  request-guard  stats  useTeamQuery
  types/       db.ts               与表结构一一对应的行类型
  auth/        api  callback  AuthProvider  LoginPage
  teams/       api  TeamProvider  TeamGate  TeamSettingsPage
  tasks/       api  TaskDrawer  TasksPage
  logs/        api  LogDrawer  LogsPage
  dashboard/   DashboardPage
  gantt/       gantt-scale（纯函数刻度）  GanttPage
  components/  ui（按钮/表单/抽屉/对话框等）  AppShell
tests/unit/    50 个用例：日期、进度、统计、刻度、权限、冲突
```

## 关键约定

- **日期**：一律 `YYYY-MM-DD` 字符串 + 自然日运算，禁止 `new Date('YYYY-MM-DD')` 做日历计算。
  团队时区固定 `Asia/Shanghai`，`今天`、逾期、近期判断都按团队时区。
- **状态与进度**：`todo=0%`、`in_progress=1–99%`、`done=100%`。改进度推状态，改状态设进度；
  切到 `in_progress` 时原来的 0/100 一律置 1。规则在数据库 `CHECK`、RPC、前端各有一份，必须一致。
- **逾期**：未完成且截止日 **早于** 今天；截止当天不算。归档任务不参与任何统计。
- **并发**：所有编辑/归档/拖拽都带版本号；服务端版本不符返回 `conflict`，
  界面保留用户输入并提示重新加载，不静默覆盖。
- **旧响应不回填**：`useTeamQuery` 每次查询领 ticket，切团队/退出/卸载都会作废在途请求。
- **成员移除**是停用而非删除：历史日报与历史负责人姓名保留，未完成的未归档任务转为未分配。

## 已知限制

- **微信登录已具备 HTTPS 域名，但真实扫码往返尚未实测**。本地 `http://127.0.0.1` 无法完成 OAuth 往返，
  登录页会把微信按钮置灰并说明；本机请用手机验证码登录。线上域名下这条链路是否真能跑通，
  需要有人用真实微信账号点一次才能确认。
- 首版不做实时推送：写操作后主动刷新相关数据，页面重新获得焦点时会自动重查，也可手动点「刷新」。
- 首版不含子任务、依赖线、自动排期、附件、评论、导出、通知。
- **不能直接绑定自有域名**。数据面按 Origin 白名单校验，换域名后请求会卡在 CORS 预检（403），
  登录与全部读写失效。且 `endpoint` 与域名在平台侧一对一锁定，代码侧无法绕开。
  详见 [`docs/custom-domain.md`](docs/custom-domain.md)。

## 验收状态

已通过的检查与**尚未验证**的项（尤其是云端权限矩阵、微信登录）见 `docs/acceptance.md`。

结论摘要：`typecheck` / `build` / 50 个单元用例全部通过；已上线到 HTTPS 域名并验证了资源加载链路
（HTML / JS / CSS 均 200，裸请求仍被门禁拦为 403，线上产物哈希与本地一致）；
浏览器内的登录—建团队—建任务—写日报全流程、云端权限负向验证、两客户端并发仍未实测；
微信登录的域名前置条件已满足，往返本身待实测。

数据库的真实结构（5 张表、全部约束与索引、12 个函数、权限与 6 条 RLS 策略）见
`docs/db-schema.sql`——那是从运行中的库导出的只读快照，不是设计稿。
