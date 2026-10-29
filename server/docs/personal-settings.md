# 个人设置第一期 / Personal Settings Phase 1

验收日期：2026-10-27。实现、本地测试与 staging HTTPS 验收通过。未切换 production，未执行 git commit/push，未删除远程项目、文件或备份。

Accepted on 2026-10-27: implementation, local tests and staging HTTPS checks passed. Production was not switched; no git commit/push or remote project, file or backup deletion was performed.

## 功能 / Behavior

- HashRouter 路由 `/#/settings`，标题「设置」，窄页分组卡片：资料 / 安全 / 外观。用户区头像、姓名和「设置」文字为同一入口；移动端显示「设置」。主导航保持看板 / 待办 / 计划 / 日记 / 组织，侧栏分组保持「导航」。
- `/#/settings` opens Settings with Profile, Security and Appearance cards. The user-area avatar/name/settings link provides access, including a visible mobile Settings label. The five navigation items and sidebar label remain unchanged.
- 资料保存真实账号 `users.name`；手机号、邮箱只读展示 `/api/auth/me` 返回的绑定身份，缺失显示「未绑定」。账号名更新后用户区同步回显。组织成员 `display_name` 不变，并展示「各组织内的显示名在组织页成员处管理」。
- Profile saves the real account name and displays bound phone/email identities read-only, with an unbound fallback. Saving updates the user entry. Organization member display names remain unchanged, with the requested explanatory note.
- 原 `PasswordSettings`、`ThemeControl` 组件原样复用。密码逻辑没有重写；外观继续使用已有的自动 / 浅色 / 深色偏好。组织页去掉密码和外观，侧栏也不再重复放置外观控件。
- The existing password and theme components are reused unchanged. Password behavior is preserved; the existing system/light/dark preferences move to Settings. Organization and sidebar no longer contain those controls.
- 未登录仍显示现有登录门。已登录但尚无组织时，也可直接访问设置 URL。
- The existing login gate protects Settings. Signed-in users without an organization can also open the Settings URL directly.

本轮没有新增微信、真实短信、ICP、注销账号或会话列表，也没有新增数据库 migration。

No WeChat, real SMS, ICP, account deletion, session-list feature or database migration was added.

## API / 接口

`PATCH /api/auth/me`，仅接受 JSON `{"name":"Account name"}`，返回与 `GET /api/auth/me` 相同的会话结构。

`PATCH /api/auth/me` accepts only a JSON name field and returns the updated existing `me` session payload.

| 检查 / Check | 行为 / Result |
| --- | --- |
| 登录 / Authentication | 现有 cookie 会话校验；未登录 401 / Existing cookie session; unauthenticated requests return 401 |
| CSRF | 沿用准确 Origin、JSON、`X-DWA-CSRF: 1`；缺失返回 403 / Existing protections; missing CSRF returns 403 |
| 账号名 / Name | 去除首尾普通空格，按 Unicode code point 计数 1–40，与 PostgreSQL `char_length(btrim(name))` 长度规则一致 / Trims ordinary edge spaces and counts 1–40 Unicode code points, matching the DB length rule |
| 非法输入 / Invalid input | 拒绝空值、纯空白、超长、非字符串、NUL；400 / Rejects null, whitespace-only, overlength, non-string and NUL input; 400 |
| 字段白名单 / Allowlist | 只允许 name，多余字段 400 / Only name; extra fields return 400 |
| 更新范围 / Write scope | 仅当前用户 name、updated_at；不改身份、密码、成员显示名或会话有效期 / Only caller name and updated_at; identities, password, membership names and session expiry are preserved |

## 测试与验收 / Tests and Acceptance

使用 `/opt/node24/bin/node`（实际版本 v24.22.1）。后端测试使用真实 PostgreSQL 16 的专用 `dwa_test`；测试按仓库要求串行，Node 与测试数据库时区设为 UTC。

Used `/opt/node24/bin/node` v24.22.1 and real PostgreSQL 16 in the dedicated `dwa_test` database. Backend suites ran serially with UTC Node/database timezones.

| 检查 / Check | 实际结果 / Actual result |
| --- | --- |
| 新接口实现前 / Before implementation | 新增 profile 测试失败，接口返回 404 / New profile tests failed with missing-route 404 |
| 后端全量 `npm test` / Full backend suite | 177 passed, 0 failed, 0 skipped |
| 后端资料与密码定向回归 / Targeted profile/password suites | 18 passed, 0 failed |
| 前端全量 `npm test` / Full frontend unit suite | 57 passed, 0 failed, 0 skipped |
| 双方 `npm run typecheck` / Both typechecks | Passed |
| 双方 `npm run build` / Both builds | Passed |
| Lint | 两侧无独立 lint 脚本；使用严格 typecheck；前端 `git diff --check` 通过 / No standalone lint scripts; strict typecheck used; frontend whitespace check passed |
| React DOM 完整流程 / React DOM full flow | Passed; real HTTP + Fastify + PostgreSQL, jsdom supplies DOM/events only |
| 远端 HTTPS 与运行 API / Remote HTTPS and running API | Passed; live/ready 200, unauthenticated me 401; compiled API hashes match local build |
| 本机 `--resolve` / Workspace resolve | Passed through loopback SSH tunnel; valid Host/SNI and certificate verification; 11 asset hashes match |

后端新增测试 `server/tests/profile.test.ts` 覆盖登录/CSRF、字段白名单、空值/长度边界、40 个 emoji、数据库持久化、身份与会话保持、他人账号隔离和组织显示名保持。前端新增账号名校验单元测试。

The new backend profile suite covers authentication/CSRF, strict fields, invalid values and length boundaries, 40 emoji, database persistence, identity/session preservation, caller isolation and organization display-name preservation. Frontend name validation has a new unit test.

`logs/personal-settings-dom.mjs` 验证真实组件的登录门、无组织账号访问、三区渲染、手机/邮箱与未绑定展示、用户入口、保存回显、组织页迁出、密码设密/改密/错误当前密码、主题三选项和真实 401。此流程使用真实 HTTP 和数据库，没有伪造登录或数据库。

The DOM acceptance script checks the real components across login, no-team access, all three groups, identity fallbacks, entry navigation, saved names, removal from Organization, password setup/change/errors, all theme options and real 401 expiry. Authentication and persistence are real, with no fake login or database.

环境没有可用浏览器（工具返回 apps/browsers 均为空），因此没有真实浏览器截图或桌面/手机视觉验收结论。DOM 事件测试不能证明像素布局。

No browser surface was available: the tool returned empty apps/browsers inventories. No real-browser screenshot or desktop/mobile visual verification is claimed; DOM event tests do not establish pixel layout.

附加源码比对发现远端原有前端源码快照不完整：备份中缺少 `ThemeControl.tsx`、`theme/theme.ts` 等工作区已有文件。密码组件与远端备份完全一致。前端构建以本工作区为准，线上运行的是通过哈希核验的 dist；本轮未验证从远端前端源码直接重新构建，也未扩大范围同步历史源码。

An additional comparison found the pre-existing remote frontend source snapshot incomplete: its backup lacks workspace files including ThemeControl and the theme module. The password component matches the remote backup exactly. Frontend builds use this workspace, and the deployment serves hash-verified dist files. A rebuild from remote frontend source was not verified, and historical source synchronization was not added to scope.

## 部署 / Deployment

仅部署 Lighthouse staging + edge，路径 `/home/ubuntu/jeayon-work/`。先备份源码、测试、文档、前端 dist 和部署配置，并为旧 API 镜像保留标签。

Deployed only to the existing Lighthouse staging + edge installation. Source, tests, docs, dist and deployment configuration were backed up, and the previous API image was retained under a dedicated tag.

- 备份 / Backup: `/home/ubuntu/jeayon-work/backups/personal-settings-20261027T102844Z`，目录权限 / directory mode `0700`。
- 旧镜像 / Previous image: `jeayon-work-api:before-personal-settings-20261027T102844Z`。
- 只构建并更新 staging `api`，使用 `up -d --no-deps api`。未运行 migration、数据库备份、PostgreSQL 重建或数据恢复。
- Built and updated staging API only, using `up -d --no-deps api`. No migration, DB backup, Postgres recreation or data restore was run.
- 前端逐文件热更，保留 dist 目录 inode 与旧资源，最后原子替换 `index.html`。
- Frontend files were hot-updated, preserving the dist directory inode and old assets, with index.html atomically replaced last.
- 容器快照证明 PostgreSQL 与 Caddy 的 ID、镜像、启动时间和重启次数不变；API 确实更新，三个容器均 healthy。Caddy/staging/edge 配置与全部 migration 文件哈希不变。
- Container snapshots confirm unchanged Postgres/Caddy identities, images, start times and restart counts. API was replaced, all three services are healthy, and deployment/migration hashes are unchanged.
- 保留 `NODE_ENV=development` 及 console 邮箱/短信 provider，没有切换 production。
- The existing development mode and console email/SMS providers are preserved; production was not switched.

本机直接 `--resolve jeayon.com:443:43.136.106.96` 返回 curl 35（TLS unexpected EOF）。替代路径为本机 SSH 隧道 `127.0.0.1:18443 → 远端 127.0.0.1:443`，curl 使用 `--resolve jeayon.com:443:127.0.0.1 --connect-to jeayon.com:443:127.0.0.1:18443`，未关闭证书校验，TLS 验证结果均为 0。

Direct workspace resolve to the public IP failed with curl 35 / TLS unexpected EOF. A loopback SSH tunnel provided the verified path shown above. Host/SNI remained jeayon.com, certificate verification stayed enabled, and all TLS verification results were zero.

线上使用独立的 `personal-settings-[timestamp]@example.test` 合成账号，经现有 console OTP 登录，再执行真实 HTTPS PATCH、GET、密码设改、登录和退出。确认名称边界、CSRF、会话保持及其他会话撤销；测试会话已退出或撤销。账号保留，无真实联系方式，也未删除任何账号或业务数据。

A separate synthetic example.test account used the existing console OTP flow for live HTTPS profile and password checks. Name limits, CSRF, persistence, caller-session preservation and other-session revocation passed. Test sessions were logged out or revoked. The synthetic account is retained; no real contact details or account/business-data deletion was involved.

## 证据与复现 / Evidence and Reproduction

主证据：`logs/personal-settings-20261027.jsonl`。仅记录状态、检查结果、资源/文件哈希与容器元数据；不记录 OTP、密码、cookie、token、手机号或用户响应正文。构建、测试的完整输出位于对应 `logs/personal-settings-*.txt`。

Primary evidence is the JSONL file above. It records statuses, checks, hashes and container metadata, excluding OTPs, passwords, cookies, tokens, phone numbers and user response payloads. Matching text files retain build/test output.

```bash
# From /workspace/selfhost; integration scripts reset the dedicated dwa_test schema.
cd server
PATH=/opt/node24/bin:$PATH TZ=UTC PGOPTIONS='-c timezone=UTC' npm test
PATH=/opt/node24/bin:$PATH npm run typecheck
PATH=/opt/node24/bin:$PATH npm run build
cd ../app
PATH=/opt/node24/bin:$PATH npm test
PATH=/opt/node24/bin:$PATH npm run typecheck
PATH=/opt/node24/bin:$PATH npm run build
cd ..
PATH=/opt/node24/bin:$PATH TZ=UTC PGOPTIONS='-c timezone=UTC' \
  node --env-file=server/.env --import ./server/node_modules/tsx/dist/loader.mjs \
  logs/personal-settings-dom.mjs
```

DOM 复现依赖工作区已有的 `logs/task-collapse-reorder-tools/node_modules/jsdom`。线上验收脚本 `logs/personal-settings-https.py` 需要上述 SSH 隧道；重跑会建立新的合成测试账号。

DOM reproduction uses the workspace's existing jsdom installation. The HTTPS script needs the tunnel described above; rerunning it creates a new synthetic test account.

如需回退，使用上述保留的 API 镜像与备份 dist，在现有目录内恢复旧 index/资源即可；本轮不需要数据库回滚。回退未执行，任何后续回退应单独授权。

Rollback can use the retained API image and backed-up frontend files within the existing dist directory; no database rollback is needed. Rollback was not performed and requires separate authorization.
