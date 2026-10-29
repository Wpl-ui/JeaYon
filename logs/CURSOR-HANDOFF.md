# JeaYon → Cursor 交接包 / Handoff

**日期 / Date:** 2026-10-29  
**品牌 / Brand:** JeaYon only（禁止 佳阳 / 工作台）  
**本助手角色 / This bot’s role:** 方案与审阅；产品实现交给 Cursor cloud agent / Codex（用户授权后）

## 1. 代码位置 / Code location

本地工作区（尚未绑定 remote）：
`/workspace/selfhost`

- `app/` — 前端（Vite/React）
- `server/` — Fastify + Postgres API（目录当前多为 untracked）
- `deploy/` — 部署相关
- `logs/` — 提示词、审阅、效果图、部署证据
- Git：本地 `master`，最新提交 `11a0c0b PLAN: self-hosted backend plan`；**无 `git remote`**
- 大量实现在工作树，**未 commit / 未 push**

## 2. 线上 staging / Live staging

- 域名：`jeayon.com`（DNSPod A → `43.136.106.96`）
- 主机：腾讯云 Lighthouse 广州，SSH `ubuntu@43.136.106.96`
- 栈：Docker + Caddy HTTPS + Fastify API + Postgres
- 前端 dist：`/home/ubuntu/jeayon-work/app/dist`
- ICP 备案仍进行中；大陆访问可能不稳

## 3. 已完成（产品） / Shipped

- 自托管后端 + Caddy/HTTPS
- 团队 / 任务 / 甘特 / 日记 API 迁离 WorkBuddy
- 品牌 JeaYon + 侧栏「导航」：看板 / 待办 / 计划 / 日记 / 组织
- 个人设置 `/settings`（资料 / 安全 / 外观）
- 注册设密 + 改密 OTP 升权
- 父任务完成数胶囊、折叠动画；后改为 Notion 竖直大纲展开（staging 已部署，Claude 结论可上线）
  - 报告：`server/docs/task-notion-vertical-expand.md`
  - 审阅：`logs/claude-review-notion-vertical-expand.log`

## 4. 当前讨论中的方案（未实现） / Open design (not built)

用户要求：**合法参考滴答清单（TickTick）桌面列表视图，1:1 交互结构复刻到 JeaYon**（禁止破解）。

建议边界：
1. 三栏：左智能/自定义清单 · 中任务列表+快速添加 · 右任务详情
2. 不含：日历 / 看板 / 番茄 / 习惯（首期）
3. 品牌 JeaYon；不使用滴答 logo/商标素材
4. 父子：缩进 + 右栏 checklist；智能清单映射为过滤
5. 效果图（图像生成，非 Claude）：见聊天附件与  
   `assets` 中 `mockup-jeayon-ticktick-style` / `0ea00edd…jpg`

此前「父左子右固定分栏」方案（v2/v3）**已被滴答三栏方向取代**，勿再实现。

## 5. 工作流约定 / Workflow

- 实现：Cursor Cloud Agent（或用户本机 Cursor）
- 审阅：Claude CLI 默认 `--model claude-opus-5-5`（网关可能仍显示 DeepSeek）
- UI 效果图：用户要求**不要用 Claude**，用图像生成或其他方式
- 回复：中英双语
- 未经用户明确批准：不 commit/push、不生产切换、不删备份

## 6. Cursor 接手建议步骤 / Suggested Cursor steps

1. 把 `/workspace/selfhost` 推到 GitHub 或 Cursor Origin（新建空仓 → 首次 push）
2. 用 Cloud Agent / 本地 Cursor 打开该仓
3. 先提交当前可运行快照（不含密钥）
4. 再按「滴答三栏」方案开 feature 分支；附上效果图

## 7. 密钥与敏感信息 / Secrets

- 部署密钥等在本机 `~/.ssh/jeayon_deploy_ed25519` 等路径；**勿写入仓库**
- `server/.env` 等环境文件勿提交

## 8. 待用户确认 / Waiting on user

- [ ] 仓库落点：GitHub vs Cursor Origin（名称/可见性）
- [ ] 是否批准把当前工作树做成首个可构建 commit
- [ ] 滴答三栏方案是否定稿开工
- [ ] ICP / 桌面打包等仍可选并行
