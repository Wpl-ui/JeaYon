# JeaYon 任务折叠与排序 / Task collapse and ordering

验收日期 / Verified: **2026-10-27 UTC**。已部署至现有 **staging + edge Caddy**；未切换 production。
Deployed to the existing **staging + edge Caddy** deployment. Production was not activated.

## 交互与范围 / Behavior and scope

- 有活跃子任务的父行显示轻量圆角数量胶囊 `done/total`。胶囊本身是按钮，包含 `aria-expanded` 和展开/收起标签；默认全部展开。按团队、父任务把收起状态保存至 `sessionStorage`，存储不可用时仍支持页面内操作。
  Parents with active children show a lightweight `done/total` capsule. The capsule is the disclosure button, with `aria-expanded` and an accessible action label. Tasks default to expanded; collapsed state is stored per team/parent in `sessionStorage`, with an in-page fallback if storage is unavailable.
- 收起隐藏子行，保留父行进度条和服务端推导的状态/进度。筛选命中子任务时保留父行上下文，仍能操作胶囊；数量始终依据完整活跃子任务集合。
  Collapsing hides child rows while retaining the parent progress bar and server-derived state. Matching children retain parent context in filtered views; counts use the complete active child set.
- 子行无组内序号，列表详情不再展示 `#database id`。抽屉原有排障信息未扩展为序号交互。
  Child rows have no group numbering, and list details no longer show database IDs. Existing drawer diagnostics are not used as ordering controls.
- 子任务通过原生拖拽手柄在同父兄弟间调序；手柄同时支持上下方向键。界面乐观更新，真实冲突或网络故障时回滚并显示错误，重新读取服务端状态。筛选状态下仍提交完整兄弟列表，包含隐藏的兄弟。
  Native drag handles reorder siblings under the same parent; Up/Down keys provide keyboard access. The UI updates optimistically, rolls back with a message on conflicts/network failures, and reloads server state. Filtered reordering includes hidden siblings.

JeaYon 品牌和「导航 / 看板 / 待办 / 计划 / 日记 / 组织」保持不变。没有微信、ICP、密码/认证实现或新业务功能改动；没有新增运行时依赖。现有开发预览 fixture 仅补齐必填的 `sort_order` 类型字段，未新增模拟服务。
JeaYon branding and the established navigation labels are preserved. WeChat, ICP and authentication implementations were unchanged; no business feature or runtime dependency was added. An existing development fixture only received the required `sort_order` field; no simulated service was added.

## 数据库与 API / Database and API

新增 migration **`006_task_sort_order`**：`tasks.sort_order integer NOT NULL DEFAULT 0`、非负约束、`(team_id,parent_id,sort_order,id)` 索引。旧子任务按各父任务下的 `id` 回填，保留原顺序；父任务既有排序保持截止日期/id，归档父任务保持归档时间/id。兄弟查询与前端层级排列统一使用 `sort_order,id`。
Migration **`006_task_sort_order`** adds a nonnegative integer column and a sibling ordering index. Existing children are backfilled by ID within each parent, preserving legacy order. Existing root ordering is retained; sibling queries and frontend hierarchy ordering use `sort_order,id`.

新建子任务在团队事务锁下写入 `max(sort_order)+1`，追加末尾（计算包含归档兄弟）。排序本身不改变父任务推导状态、进度或版本；每个参与排序的活跃子任务版本加一。
New children append at `max(sort_order)+1` under the existing team transaction lock, including archived siblings when computing the tail. Reordering leaves parent state/progress/version unchanged and increments every participating active child's version.

```http
PATCH /api/tasks/:parentId/children/reorder
Content-Type: application/json
x-dwa-csrf: 1
```

```json
{
  "children": [
    { "id": 23, "expected_version": 4 },
    { "id": 21, "expected_version": 2 }
  ]
}
```

数组顺序即目标顺序，必须是完整活跃兄弟集合。200 返回按新顺序排列、带最新版本的子任务。重复 ID、跨父/跨团队、归档子任务、多层目标均拒绝；缺失兄弟或版本过期返回 409。权限、Cookie、CSRF 和审计沿用现有实现，新增 `task.reorder` 审计动作。所有校验与批量更新在同一事务内完成。
Array order is the requested order and must contain the complete active sibling set. HTTP 200 returns ordered children with updated versions. Duplicate IDs, foreign/archived children and nested targets are rejected; incomplete sets or stale versions return 409. Existing membership, cookie, CSRF and audit mechanisms apply, with a `task.reorder` audit action. Validation and the bulk update share one transaction.

## 改动文件 / Changed files

| 文件 / File | 用途 / Purpose |
| --- | --- |
| `app/src/tasks/TasksPage.tsx` | 数量胶囊、可见行、拖拽/键盘、乐观保存/回滚、移除列表 ID / Capsule, visibility, drag/keyboard ordering, optimistic save/rollback, remove list IDs |
| `app/src/tasks/collapse.ts` | 会话折叠状态读写 / Session collapse preferences |
| `app/src/tasks/hierarchy.ts` | 持久顺序与同父移动 / Persisted hierarchy order and sibling moves |
| `app/src/tasks/api.ts` | 排序接口 / Reorder transport |
| `app/src/types/db.ts` | `sort_order` 字段 / Column type |
| `app/src/styles/global.css` | 胶囊、手柄、放置提示与响应式样式 / Capsule, handle, drop indication and responsive styles |
| `app/src/dev-preview/fixtures.ts` | 现有 fixture 类型兼容 / Existing fixture type compatibility |
| `app/tests/unit/task-hierarchy.test.ts`, `stats.test.ts` | 层级/移动/存储测试、既有 fixture 字段 / Hierarchy/move/storage tests and existing fixture field |
| `server/src/db/migrations/006_task_sort_order.ts`, `db/migrator.ts` | 新增并注册 migration / Add and register migration |
| `server/src/business.ts`, `tasks/hierarchy-contract.ts` | 事务排序、追加末尾、查询顺序与契约 / Transactional ordering, append behavior, query order and contract |
| `server/tests/task-order.test.ts` | 真实数据库持久化、并发、边界、旧结构迁移测试 / Real database persistence, concurrency, boundary and legacy migration tests |

## 验证 / Validation

使用 **`/opt/node24/bin/node` v24.22.1**，最终结果：
Final results using the requested Node executable:

| 检查 / Check | 结果 / Result |
| --- | --- |
| 服务端全量 / Full server tests | **174/174 PASS**, 16 suites, 0 skipped |
| 前端全量 / Full frontend tests | **56/56 PASS**, 0 skipped |
| Server typecheck / build | **PASS**, exit 0 / 0 |
| Frontend typecheck / build | **PASS**, exit 0 / 0 |
| 独立 lint / Standalone lint | 两个项目均未配置该脚本 / Neither project configures this script |
| 真实组件联调 / Real component integration | **PASS**, 11 behavior checks; actual React DOM events + HTTP/Fastify/PostgreSQL 16 |
| 远端 HTTPS API / Remote HTTPS API acceptance | **PASS**, persistent ordering, append, 409 conflicts, concurrent writers, boundary rejection |
| 静态文件 / Static files | **11/11** HTTPS hashes equal local build, verified both server-locally and from workspace via tunnel |
| 健康 / Health | liveness/readiness **200**, anonymous `/api/auth/me` **401**; API/Postgres/Caddy healthy |

服务端测试环境为 `TZ=UTC PGOPTIONS='-c timezone=UTC'`。修改前基线为前端 53/53、服务端 169/170；既有密码会话测试在数据库默认时区跨 11 月夏令时边界时，刷新 Cookie 期限为 608399 秒，超过该测试的 604800 秒断言。仅设置 Node 的 UTC 不足，明确测试数据库连接时区后全量通过。未修改认证代码或放宽断言；默认时区下的既有问题保留在证据中，未在本任务内修复。
Server tests use UTC for Node and PostgreSQL connections. Before changes, frontend passed 53/53 and server passed 169/170: an existing password session test crossed the November DST boundary in the database's default timezone, producing a 608399-second refresh cookie against its 604800-second assertion. Node UTC alone did not resolve it; explicit database connection UTC did. Authentication code and assertions were unchanged. This existing default-timezone issue remains outside this task and is documented in the evidence.

先添加排序测试再实现，首次因新路由不存在返回 404 而失败；实现后通过。新增 migration 测试在一次性 `dwa_test` 中恢复 pre-006 表结构，再验证回填不会修改任务版本/进度。
Ordering tests were added before implementation and initially failed with 404 for the missing route. They pass after implementation. A disposable `dwa_test` migration test recreates the pre-006 table shape and verifies backfilling preserves versions and progress.

组件联调覆盖默认 `1/3` 胶囊、折叠后进度保留、sessionStorage 重挂载恢复、无序号、拖拽请求返回前的乐观顺序、重挂载后的服务端顺序、真实并发编辑导致的 409 回滚、跨父拖拽不发请求、键盘排序、筛选隐藏兄弟的完整排序，以及关闭真实 HTTP 监听器后的网络故障回滚。测试使用真实 Provider、真实 API 和数据库；jsdom 仅提供 DOM/事件环境，安装在 `logs/task-collapse-reorder-tools/`，未加入产品依赖。
Component integration covers the default capsule, retained progress when collapsed, session persistence across remounts, no numbering, optimistic order before HTTP completion, persisted order after remount, rollback on a real stale-edit 409, rejection of cross-parent drops before requests, keyboard access, complete filtered ordering, and rollback after stopping the real HTTP listener. Providers, API and database are real; jsdom supplies DOM/events only and is isolated under logs.

## 部署与数据保护 / Deployment and data protection

1. 远端备份：`/home/ubuntu/jeayon-work/backups/task-collapse-reorder-20261027T072535Z`，目录权限 **700**、文件 **600**。包含原 `server/src`、`server/docs`、dist、部署配置和 **64,035 字节** custom-format PostgreSQL dump，`pg_restore --list` 检查通过。dist 文件哈希与原目录一致；旧 API 镜像另加保留标签 `jeayon-work-api:before-task-collapse-reorder-20261027T072535Z`。
   Verified remote source/docs/assets/config backup and a readable custom-format database dump, with restricted permissions and a retained previous API image tag.
2. 上传包与 **21** 个文件 SHA-256 核对通过；只安装本任务相关源码。通过 `docker-compose.staging.yml build api` 构建 API；没有使用 production compose。
   Verified the archive and all 21 file hashes; installed only task-related source and built the staging API image.
3. staging tools 容器执行 migration：**`006_task_sort_order: Success`**，随后仅重建 API 容器（`up -d --no-deps api`）。迁移前后 users **9**、teams **5**、tasks **14**、work_logs **1**，排除新增列的既有任务内容摘要完全一致；旧兄弟 ID 顺序回填校验通过。
   Ran the migration using staging's tools service and recreated only the API container. Record counts and existing task content digests were unchanged; legacy sibling order was verified.
4. 前端在原 dist 目录逐文件原子替换，`index.html` 最后更新，保留挂载目录 inode 与历史哈希资源。staging/edge compose 和 Caddyfile 哈希不变；Postgres、Caddy 容器 ID、镜像、启动时间和重启次数不变。
   Hot-updated assets atomically with index.html last, retaining the bind-mounted directory inode and historical assets. Staging/edge configuration and Postgres/Caddy container identities were unchanged.
5. 使用既有验收账号和原有 staging console OTP 走真实 HTTPS，创建隔离验收团队与七个任务，测试持久化、边界和两个独立并发排序请求（**200 + 409**），直接读取数据库核实顺序。结束后七个测试任务全部归档、活跃测试任务为 0；验收团队保留，会话正常登出；没有物理删除数据或修改密码。最终再次核对原有 14 个任务内容摘要不变。
   Used the existing acceptance account through unchanged OTP authentication, created an isolated test team and seven tasks, verified API/database ordering and independent concurrent HTTPS writers, then archived all seven tasks and logged out. The team remains recoverable, no rows were deleted, and the original 14 tasks remained unchanged.
6. 远端本机 `--resolve jeayon.com:443:127.0.0.1` 保持证书校验，检查 11 个静态资源、品牌/导航、健康及匿名认证响应；运行中的四个相关编译 JS 哈希与本地构建一致。
   Server-local resolved HTTPS verified all 11 assets, branding/navigation, health and anonymous auth behavior, plus hashes of the four relevant compiled files inside the running API.

没有 git commit/push，没有删除远程项目、备份、Postgres 数据卷或历史静态资源，没有切换 production。
No git commit/push, deletion of remote projects/backups/database volumes/historical assets, or production activation occurred.

## 证据与验证边界 / Evidence and verification limits

- 主证据 / Main evidence: **`logs/task-collapse-reorder-20261027.jsonl`**。包含基线/失败复现、最终测试、真实组件事件、备份、上传、migration、线上 API、容器与 HTTPS 哈希记录；不含密钥、OTP、Cookie、token 或密码值。
  Contains baseline/reproduction, final checks, component events, backup/upload/migration, live API, container and HTTPS hash records without credentials.
- 任务前快照 / Before snapshots: `logs/task-collapse-reorder-before/`。可复现脚本 / Reproducible runners: `logs/task-collapse-reorder-dom.mjs`, `task-collapse-reorder-deploy.py`, `task-collapse-reorder-live.py`, `task-collapse-reorder-final-verify.py`。原始测试输出与上传包保留于同前缀文件。
  Source snapshots, test output, runners and release archive are retained under the requested prefix.
- 当前 CUA inventory 无浏览器，因此**没有声称完成浏览器视觉、真实鼠标拖动或触屏手势验收**。已验证实际 React 组件的原生 drag 事件和键盘事件；触屏拖拽取决于浏览器对原生 HTML 拖拽的支持。
  No browser is available in CUA, so visual, physical mouse-drag and touchscreen acceptance are not claimed. Actual React native drag/keyboard event handling is verified; touchscreen dragging depends on browser support for native HTML drag and drop.
- 工作机直连源站 `--resolve jeayon.com:443:43.136.106.96` 返回 curl **35 / TLS EOF**。改用 SSH 隧道映射 `127.0.0.1:19443 → 服务器 127.0.0.1:443`，本机执行 `--resolve jeayon.com:19443:127.0.0.1`，不关闭 TLS 校验，首页与全部 11 个资源哈希均匹配；服务器本机标准 443 端口验证亦通过。未更改网络或证书配置。
  Direct workspace-to-origin HTTPS fails with TLS EOF. Workspace-local resolved HTTPS through an SSH tunnel succeeds with certificate validation and matching hashes; normal server-local port-443 verification also passes. Network and certificate configuration were not changed.
- 验收脚本初次使用的团队名超过既有 40 字符限制，被真实 API 正确拒绝；缩短脚本中的测试名后通过。扩展筛选 DOM 测试的首次断言遗漏仍可见的另一父任务子行，修正测试期望后通过。两处均为验收脚本修正，没有为此放宽产品约束。
  Initial acceptance-runner issues were an overlong test team name, correctly rejected by the API, and a filtered-DOM expectation that omitted another parent's still-visible child. The runners were corrected without relaxing product constraints.
