# JeaYon 待办折叠动画 / Task collapse animation

2026-10-27 UTC：实现、全量检查、组件验收与现有 **staging + edge Caddy** 前端热更完成；未切换 production。
Implementation, full checks, component acceptance, and a frontend hot update to the existing **staging + edge Caddy** deployment passed on 2026-10-27 UTC. Production was not activated.

## 实现 / Implementation

- 子任务保留原有 key 和 DOM，使用 `grid-template-rows: 1fr ↔ 0fr`、透明度与 `translateY(0 ↔ -4px)`，统一 **260ms / cubic-bezier(.22, 1, .36, 1)**。内层 `min-height: 0; overflow: hidden` 将子行内容和 padding 一起收起；不需要量高、计时器或额外 React 状态。快速反向点击直接从当前 CSS 过渡继续。
  Child rows keep their keys and DOM. Grid height, opacity, and a 4px shift transition together over 260ms with the same easing. The inner clip includes row padding, allowing zero collapsed height without measurement, timers, or additional React state. CSS transitions handle reversals.
- 数量胶囊沿用 `aria-expanded`；固定 ▾ 字符通过 `rotate(0deg ↔ -90deg)` 同步旋转。收起子行设置 `inert`、`aria-hidden` 并禁用拖拽手柄，避免保留的 DOM 接收焦点或操作。展开时恢复。
  The capsule retains `aria-expanded`; its triangle rotates with the same timing. Collapsed rows are inert, hidden from assistive technology, and have disabled drag handles; expanding restores interaction.
- 默认全部展开；原有按团队/父任务保存的 `sessionStorage` 逻辑未改。筛选仍保留命中子任务的父行和可操作胶囊；计数继续使用完整活跃子任务集合，页面“当前显示”数量仍排除收起子行。没有活跃子任务的父行仍不显示胶囊。
  Default expansion, per-team/parent session storage, filtered parent context, complete active-child counts, and the visible-row count are preserved. Parents without active children still have no disclosure capsule.
- 原生拖拽事件仍在同一个外层 `li[data-task-id]` 处理；键盘调序、完整兄弟列表、乐观顺序、请求、冲突与网络回滚均沿用既有实现。行分隔线适配新增裁剪层。
  Native drag events remain on the same outer list item. Keyboard ordering, complete sibling sets, optimistic updates, requests, and conflict/network rollback retain the existing implementation. Row separators account for the added clip layer.
- 沿用全局 `prefers-reduced-motion: reduce` 的 `.01ms !important` 过渡时长；本次动画没有 transition delay。
  The existing global reduced-motion rule makes transitions nearly instant at .01ms; these transitions have no delay.

产品源码只修改 `app/src/tasks/TasksPage.tsx` 与 `app/src/styles/global.css`。`collapse.ts`、`hierarchy.ts`、原有折叠单测、package manifest/lock 均与修改前快照一致。没有新增依赖、后端、API、migration 或业务功能；没有组内序号、微信、ICP、设置页或品牌改动。JeaYon 与「导航 / 看板、待办、计划、日记、组织」在部署 bundle 中校验通过。
Product source changes are limited to TasksPage and global CSS. Collapse/hierarchy contracts, existing collapse unit tests, and dependency manifests/lockfile match the baseline. No dependencies, backend/API/migrations, business features, numbering, WeChat, ICP, settings, or branding changes were added. The deployed bundle preserves JeaYon and the established navigation labels.

## 检查 / Checks

使用 **`/opt/node24/bin/node` v24.22.1**。服务端测试使用 `TZ=UTC PGOPTIONS='-c timezone=UTC'`，与既有验收一致；测试仅使用本机明确限定的 PostgreSQL 16 `dwa_test`，不连接线上数据库。
Checks used the requested Node executable. Server tests use UTC for Node and PostgreSQL connections, consistent with the existing acceptance setup, and only the explicitly restricted local PostgreSQL 16 test database.

| 检查 / Check | 结果 / Result |
| --- | --- |
| 修改前 app / Frontend baseline | 57/57 PASS，0 skipped |
| 修改前 server / Server baseline | 177/177 PASS，17 suites，0 skipped |
| 最终 app 全量 / Full frontend tests | 57/57 PASS，0 skipped |
| 最终 server 全量 / Full server tests | 177/177 PASS，17 suites，0 skipped |
| app typecheck / build | PASS / PASS，exit 0 / 0 |
| server typecheck / build | PASS / PASS，exit 0 / 0 |
| 独立 lint / Standalone lint | 两个项目均未配置 / Neither project defines this script |
| 真实 React DOM + HTTP + PostgreSQL 组件验收 / Component acceptance | PASS，15 项检查 / checks |
| 服务器本机 HTTPS `--resolve` / Server-local resolved HTTPS | 11/11 文件 SHA-256 匹配 / file hashes match |
| 工作机 SSH 隧道 HTTPS `--resolve` / Workspace resolved HTTPS over SSH tunnel | 11/11 文件 SHA-256 匹配，TLS 校验开启 / file hashes match, TLS verified |

新增 DOM 验收脚本先在原代码运行，因缺少 grid 高度过渡失败；实现后通过。它加载真实页面、Provider 和 CSS，使用真实 HTTP/Fastify/PostgreSQL，jsdom 仅提供 DOM/事件环境；没有模拟 API、登录或数据库。复用工作区已有的隔离 jsdom，不安装任何依赖。
The new DOM runner first failed against the original code because grid transitions were absent, then passed after implementation. It loads the actual page, providers, and CSS against real HTTP/Fastify/PostgreSQL. jsdom supplies DOM/events only. Existing isolated tooling was reused without installing dependencies.

验收覆盖默认 `1/3` 胶囊、收起/展开的计算样式 `0fr/1fr` 和 `opacity 0/1`、裁剪、三角旋转、260ms 过渡及 reduced-motion 规则；子行 DOM 不卸载、inert/aria-hidden、连续 8 次反向切换、sessionStorage 重挂载、叶子任务、父行进度、无序号；以及拖拽乐观顺序、持久化、真实 409 回滚、跨父拒绝、键盘调序、筛选隐藏兄弟的完整排序与真实断网回滚。
Coverage includes computed collapsed/expanded styles, clipping, triangle rotation, transition/reduced-motion rules, retained DOM, accessibility state, eight rapid reversals, session persistence, leaf behavior, parent progress, and ordering/persistence/conflict/network regressions.

验收脚本两次适配：重挂载等待条件排除收起后有意禁用的手柄；拖拽回归检查发现包装层会改变事件目标，因此最终实现把 drag/drop handlers 保留在原 `li` 上，原有事件目标测试通过。未放宽业务断言。
The runner's remount wait was adapted to intentionally disabled collapsed handles. Drag regression checks also exposed the wrapper's effect on event targeting; the final implementation retains handlers on the original list item and passes the existing target-based checks. Business assertions were not relaxed.

## 部署与备份 / Deployment and backup

- 远端备份：**`/home/ubuntu/jeayon-work/backups/task-collapse-anim-20261027T121145Z`**。目录 0700、备份文件 0600；包含完整旧 dist、相关前端源码和 Caddy/compose 配置。旧 dist 与备份逐文件 SHA-256 一致。此次只更新静态文件，不执行数据库写入、dump/migration 或镜像构建。
  The restricted remote backup contains the complete previous dist, relevant frontend source, and deployment configuration, with matching per-file hashes. This static-only deployment performs no database writes, dumps, migrations, or image builds.
- 上传包 SHA-256：`17adf45da59b2d231eb5713055ba979a0d56fd7af213677f2a0d1eea2b74e089`；**11** 个文件均属于 `app/dist/` 并逐个校验。仅热更原 dist，逐文件原子替换，`index.html` 最后更新；保留目录 inode **658192** 及所有历史资源，不删除文件。远端 `app/src` 未同步，运行版本以本次 dist 为准。
  All 11 verified release files are under app/dist. Atomic replacement updates index.html last, retains the bind-mounted directory inode and every historical asset, and deletes nothing. Remote app/src is unchanged; the deployed version is the supplied dist.
- 生效资源：`assets/index-BxsHQovF.js`、`assets/index-BjB7sXrz.css`。服务器本机使用 `--resolve jeayon.com:443:127.0.0.1`；工作机通过 SSH 隧道 `127.0.0.1:19443 → 服务器 127.0.0.1:443`，使用 `--resolve jeayon.com:19443:127.0.0.1`。两个路径均保持证书校验，全部 11 个文件与本机构建 SHA-256 一致；生效 JS/CSS 包含新动画、品牌和导航。
  Both server-local and workspace-tunneled HTTPS paths verified all 11 build hashes with certificate validation enabled, including the active animation, branding, and navigation bundles.
- `/api/health/live`、`/api/health/ready` 均 **200 / ok**；匿名 `/api/auth/me` 为预期 **401 / unauthenticated**。API、Postgres、Caddy 均 healthy，容器 ID、镜像、启动时间、重启次数与备份时完全一致；服务端源码/编译产物及全部部署配置摘要一致。
  Health endpoints return 200; anonymous auth returns the expected 401. All three containers remain healthy with unchanged identities, images, start times, and restart counts. Server source/build and deployment configuration digests are unchanged.

如需回滚，可从上述备份 `dist/` 逐文件原子复制回原 `app/dist/`，仍最后更新 `index.html` 并保留所有其他哈希资源；不替换挂载目录，不需要重启服务。此处仅记录操作方法，未执行回滚。
Rollback can atomically copy backed-up files into the existing dist, with index.html last and all other hashed resources retained. Keep the mounted directory and running services in place. Rollback was not executed.

未 git commit/push，未删除远端项目、备份、文件或数据卷，未切换 production。
No commit/push, remote project/backup/file/volume deletion, or production activation occurred.

## 证据与边界 / Evidence and limits

- 主证据 / Main evidence：**`logs/task-collapse-anim-20261027.jsonl`**，包含快照、失败复现、全量测试、组件验收、备份、发布与两个 HTTPS 验证路径。仅记录状态、哈希和脱敏结果，不含密钥、密码、OTP、Cookie 或 token 值。
  Contains snapshots, reproduction, full checks, component acceptance, backup/release, and both HTTPS verification paths without credentials.
- 复现脚本 / Runners：`logs/task-collapse-anim-checks.py`、`logs/task-collapse-anim-dom.mjs`、`logs/task-collapse-anim-deploy.py`、`logs/task-collapse-anim-verify.py`；同前缀 `.txt` 保留真实检查输出，`task-collapse-anim-before-20261027T120512Z/` 保留修改前文件。
  Matching text logs contain actual command output; the before snapshot preserves the original files.
- **视觉验收限制：CUA inventory 无浏览器，创建 IAB 也返回 unavailable。** 未执行真实浏览器布局/动画插值、帧率、鼠标或触屏验收。jsdom 计算样式和 DOM 断言不等于实际渲染验证；不能据此声称完成无闪烁或主观丝滑度的视觉验收。
  **Visual verification limit: CUA has no browser and IAB creation is unavailable.** Browser layout/interpolation, frame rate, physical mouse, and touch checks were not run. Computed-style/DOM assertions do not establish rendered smoothness or absence of visual flicker.
- 更深的 FLIP、共享布局、弹簧、错落入场、拖拽暂停和跨筛选动画记忆均不在本轮范围。
  FLIP, shared layout, springs, staggered entry, drag-time animation pausing, and cross-filter animation memory remain outside scope.
