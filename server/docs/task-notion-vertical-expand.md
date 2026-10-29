# JeaYon Notion 竖直大纲展开 / Vertical outline expansion

方案 A 已由用户在本轮任务中明确批准；方案原文件的“待确认”是旧状态。
The user explicitly approved Approach A for this task; the proposal's approval label is stale.

## 实现 / Implementation

- 同父子项放入父卡下的单个 grid 容器，`grid-template-rows: 0fr ↔ 1fr`；内层 `min-height: 0; overflow: hidden`。移除子项水平 clip-path、display 离散过渡、starting-style、错峰样式与 `taskExpandDelay`。展开 200ms、收起 150ms，整组同时；不使用新依赖或 API。
  One grid group below each parent reveals all siblings together, using an inner overflow container. Horizontal clipping and stagger are removed. Expansion takes 200ms; collapse takes 150ms. No new dependencies or APIs.
- 保留同一个 ▾ 字形，展开为 0°（朝下）、收起 -90°（朝右），旋转时长与高度一致；reduced-motion 将高度与三角时长、延迟归零。
  The same triangle rotates between down and right with matching timing; reduced motion makes both instantaneous.
- 收起组及子行保留 DOM，设置 inert/aria-hidden，禁用拖拽手柄；收起前聚焦胶囊，防止焦点留在隐藏子树。内层列表留 4px 阴影空间；容器 margin-left 桌面 24px、移动端 8px，加列表左侧 4px padding 后，卡片缩进分别约 28px、12px。
  Collapsed DOM is retained, inert and aria-hidden, with drag handles disabled. Focus returns to the capsule. The container margins are 24px desktop and 8px mobile; adding the list’s 4px left padding places cards about 28px/12px from the parent. The gutter accommodates shadows; actual rendering remains unverified.
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

`deepseek-flash` 首轮只读审阅（工具禁用、未修改文件）未发现阻塞代码缺陷，原文结论“结论：可上线”。原文保存在 `logs/claude-review-notion-vertical-expand-readonly.log`。两项非阻塞意见为缩进说明及审阅输入未展开主 JSONL：已明确 24/8px margin + 4px padding，并提取实际部署事件供复核。
The first read-only review found no blocking code defect and concluded “ready to ship.” Two non-blocking presentation comments were addressed by clarifying margin plus padding and supplying raw deployment events. The original review is preserved unchanged.

独立部署证据副本 / Standalone raw deployment evidence: `logs/notion-vertical-expand-deployment-evidence.json`，逐条取自主 JSONL，保留时间戳、每个资源 SHA-256、两条 HTTPS 路径、容器与配置快照和上传重试记录。
The standalone evidence is extracted directly from the main JSONL and retains timestamps, per-file hashes, both HTTPS paths, container/config snapshots and upload retry history.

补充只读复核完成：两项文档/证据意见均已解决，未发现新的阻塞缺陷。原文见 `logs/claude-review-notion-vertical-expand-followup.log`；两轮审阅均为工具禁用的 `deepseek-flash`，exit 0。
The read-only follow-up confirms both presentation comments are resolved and finds no new blocking defect. Both reviews used deepseek-flash with tools disabled and exited 0. Original outputs are preserved.

Claude 原文结论 / Verbatim verdict: **结论：可上线**。
