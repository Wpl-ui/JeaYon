# JeaYon task-expand-cards 验收报告 / Acceptance report

本轮续接只补文档、打包、部署和核验证据，未重新实现卡片或动画。最终部署结果见下文。
This finish pass adds documentation, packaging, deployment and verification evidence without reimplementing cards or animation. Deployment results are recorded below.

## 已有变更 / Existing changes

- `ParentTaskCard` / `ChildTaskCard` 将父子任务呈现为独立卡片；圆角、浅色背景、左侧色条。十种 pastel 颜色按任务 ID 稳定映射，提供浅色/深色主题值，筛选、排序、重挂载不重新随机。
  Parent and child components render separate cards with rounded corners, pastel backgrounds and accent stripes. Ten colors map deterministically from task IDs, with light/dark theme values.
- 子卡仍在父卡下方，通过 `clip-path: inset(0 100% 0 0)` 到完整宽度实现水平短→长显示，文字不缩放。展开 260ms，每项错落 50ms、最大延迟 350ms；收起 160ms、无延迟。CSS 使用 `@starting-style` 和受支持时的 `display ... allow-discrete`；reduced-motion 将时长与延迟归零。
  Children remain below their parent and reveal horizontally through clipping without scaling text. Expansion takes 260ms with 50ms stagger capped at 350ms; collapse takes 160ms without delay. CSS includes starting styles, supported discrete display transitions and zero-duration/delay reduced motion.
- 保留默认展开、按团队/父任务的 sessionStorage、数量胶囊、父任务进度、筛选上下文、同父拖拽/键盘排序、乐观更新及冲突/网络回滚。收起子卡保留 DOM，设置 inert/aria-hidden 并禁用拖拽手柄。
  Default expansion, stored collapse state, counts, derived progress, filtered parent context, sibling drag/keyboard ordering, optimistic updates and rollback are preserved. Collapsed child DOM is inert and hidden from accessibility APIs, with disabled drag handles.

涉及既有产品文件：`app/src/tasks/TasksPage.tsx`、`app/src/tasks/TaskCards.tsx`、`app/src/tasks/appearance.ts`、`app/tests/unit/task-appearance.test.ts`、`app/src/styles/global.css`。服务端源码、API、migration 与依赖未改；本次续接不修改产品源码。
Existing product changes are in the listed frontend files. Server source, APIs, migrations and dependencies are unchanged; this finish pass does not modify product source.

品牌保持 **JeaYon**，导航保持 **导航 / 看板 / 待办 / 计划 / 日记 / 组织**。
Branding remains **JeaYon** and navigation retains the exact labels above.

## 已完成的本地验收 / Completed local acceptance

下表来自已有最终检查，不是本次重新运行；六份输出的 SHA-256 已与主证据记录核对一致。使用 `/opt/node24/bin/node`；未修改源码，因此按要求不重跑 typecheck/build/tests。app/server 均未配置独立 lint script。
These are existing final results, not reruns. All six output hashes match the evidence trail. Checks used the requested Node executable. Since source is unchanged, this pass does not rerun checks. Neither project defines a standalone lint script.

| 检查 / Check | 结果 / Result | 证据 / Evidence |
| --- | --- | --- |
| app tests | 59/59 PASS, 0 skipped | `logs/task-expand-cards-final-app-tests.txt` |
| app typecheck | PASS, exit 0 | `logs/task-expand-cards-final-app-typecheck.txt` |
| app build | PASS, exit 0 | `logs/task-expand-cards-final-app-build.txt` |
| server tests | 188/188 PASS, 0 skipped | `logs/task-expand-cards-final-server-tests.txt` |
| server typecheck | PASS, exit 0 | `logs/task-expand-cards-final-server-typecheck.txt` |
| server build | PASS, exit 0 | `logs/task-expand-cards-final-server-build.txt` |
| React DOM + real HTTP/Fastify/PostgreSQL 16 `dwa_test` | PASS, 15 acceptance groups | `logs/task-expand-cards-dom.txt`, `logs/task-expand-cards-dom.html` |

原代码失败复现：`logs/task-expand-cards-red.txt`，缺少水平 260ms 展开规则；修改后组件验收通过。组件验收涵盖水平裁剪/CSS 时间与错落、稳定颜色、收起可访问性、快速反转后的状态、sessionStorage 重挂载、叶子任务、父进度、真实 HTTP 排序持久化、真实 409 和断网回滚、跨父拒绝、键盘及筛选隐藏兄弟排序。没有模拟后端或数据库。
The red reproduction failed on the missing horizontal expansion rule. The passing component checks cover CSS rules and state, stable colors, accessibility, rapid toggle state, persistence, progress and real HTTP ordering/conflict/network regressions, using a real backend and test database.

**Chrome/CUA/browser 视觉验收不可用。** 先前浏览器尝试未产出可用结果，`logs/task-expand-cards-browser.txt` 记录 `Browser result missing`。本次按要求跳过 Chrome/headless 重试，使用已有 React DOM + HTTP 验收及部署后 HTTPS 哈希核验。jsdom DOM/CSS 断言不等于实际浏览器渲染；未验证布局像素、动画插值、帧率、闪烁、主观流畅度或触屏效果，不声称这些项目通过。
**Chrome/CUA/browser visual acceptance is unavailable.** The prior browser run produced no usable result. This pass skips browser/headless retries and relies on existing React DOM + HTTP acceptance and deployed HTTPS hash checks. DOM/CSS assertions do not establish rendered layout, animation interpolation, frame rate, absence of flicker, perceived smoothness or touch behavior.

## 如何核验 / How to verify

1. 在 staging 登录并打开「待办」；选择有多个子任务的父任务，检查独立卡片、胶囊计数及收起/展开状态。筛选、刷新、排序后检查同一任务颜色与顺序保持稳定。浅色、深色及 reduced-motion 的实际视觉效果仍需可用浏览器人工检查。
   Sign in to staging and open Tasks. Inspect separate cards, counts, collapse state, stable colors and ordering. Actual light/dark/reduced-motion rendering still needs manual browser inspection.
2. `python3 logs/task-expand-cards-verify.py` 对 staging Caddy 做服务器本机及工作区 SSH 隧道 HTTPS 验证：逐文件核对本地 dist SHA-256、当前 JS/CSS、品牌/导航、动画标记、健康接口和未变更容器/配置。此命令为只读核验并追加证据，不执行部署。
   The existing verifier checks every local dist hash over server-local and workspace-tunneled HTTPS, active bundles, branding/navigation, CSS markers, health and unchanged services/configuration. It appends evidence without deploying.
3. 组件复现入口是 `logs/task-expand-cards-dom.mjs`；它会使用本机测试数据库并创建测试数据，应仅在已有隔离 `dwa_test` 环境运行，不能指向 staging/production。完整检查入口为 `logs/task-expand-cards-checks.py final`；本次未重跑。
   The component runner creates test data and belongs only in the isolated local test environment. Full checks can be run through the existing checks script; this pass did not rerun them.

## 部署结果 / Deployment results

2026-10-28 北京时间 07:11 完成前端静态热更，目标为 Lighthouse `ubuntu@43.136.106.96` 的既有 staging + edge Caddy，未切换 production。
The frontend static update completed at 07:11 Beijing time on 2026-10-28, targeting the existing Lighthouse staging + edge Caddy deployment. Production was not activated.

- 远端备份：`/home/ubuntu/jeayon-work/backups/task-expand-cards-20261027T231130Z`。目录 0700、文件 0600，旧 dist 与备份逐文件一致，保留相关前端源码和部署配置。
  The restricted backup preserves the complete old dist, relevant frontend source and deployment configuration; old dist hashes match the backup.
- 发布包：`logs/task-expand-cards-release.tar.gz`，SHA-256 `d6e7d1ca4a8e906130521a2f293813ee9d559870d1fe7f5dcf21c970d6ad9eee`。11 个文件均为 `app/dist/` 内容，上传后逐个核验。
  All 11 release files belong to app/dist and were individually verified after upload.
- 原 dist 内逐文件原子替换，`index.html` 最后更新；保持 bind mount 目录 inode，保留所有历史哈希资源。远端 `app/src` 未同步，部署运行版本以 dist 为准。
  Files were atomically replaced within the existing dist, with index.html last. The mounted directory inode and all historical assets remain intact. Remote frontend source was not synchronized; the running version is the supplied dist.
- 当前生效入口：`assets/index-CbiMMmYm.js`、`assets/index-D_C3oTIF.css`。服务器本机 HTTPS 使用 `--resolve jeayon.com:443:127.0.0.1`，11/11 文件均返回 200 且与本地 SHA-256 匹配，TLS 证书校验开启；品牌、导航及水平展开 CSS/JS 标记通过核验。
  Server-local resolved HTTPS verifies all 11 files against the local build with HTTP 200 and TLS validation, including the active bundle references, branding/navigation and horizontal expansion markers.
- 工作区第二条路径：SSH 隧道 `127.0.0.1:19443 → 服务器 127.0.0.1:443`，通过 `--resolve jeayon.com:19443:127.0.0.1` 核验 11/11 文件，全部 200、SHA-256 匹配且 TLS 校验开启。该路径验证目标 staging Caddy，不代表额外完成公网 DNS/CDN 或浏览器验收。
  An independent workspace HTTPS check through the SSH tunnel also passed all 11 hashes with HTTP 200 and certificate validation. These paths verify the target staging Caddy; they do not establish public DNS/CDN routing or browser acceptance.
- `/api/health/live` 与 `/api/health/ready` 返回 200；匿名 `/api/auth/me` 返回预期 401。API、Postgres、Caddy 容器 ID、镜像、启动时间、状态及重启次数与备份时一致，均 healthy；服务端 source/dist、Caddy/compose 配置摘要一致。没有数据库写入、migration、镜像重建或服务重启。
  Health endpoints return 200 and anonymous auth returns the expected 401. API, Postgres and Caddy remain healthy with unchanged identities, images, start times and restart counts. Server source/build and deployment configuration digests match the backup. No database writes, migrations, image builds or service restarts were performed.

回滚参考：从上述备份 dist 逐文件原子复制回原 dist，保留挂载目录和其他历史资源，最后更新 index.html；无需重启容器。仅记录方法，本次未执行回滚。未 git commit/push，未删除文件、分支、项目或数据卷。
For rollback, atomically copy the backed-up dist files into the existing mounted directory, preserving other assets and updating index.html last; containers need no restart. Rollback was not executed. No commit, push or file/branch/project/volume deletion was performed.

主证据：`logs/task-expand-cards-20261027.jsonl`，包含原始快照、失败复现、最终检查、React DOM 验收及本次续接事件。部署工具为 `logs/task-expand-cards-deploy.py`；核验工具为 `logs/task-expand-cards-verify.py`。
The single evidence trail contains the baseline, reproduction, final checks, component acceptance and finish events. Deployment and verification use the existing helpers.
