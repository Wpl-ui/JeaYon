# JeaYon 注册设密与改密 OTP 升权 / Password signup and OTP step-up

日期 / Date: 2026-10-27. 完成 / Complete: local gates and final staging acceptance passed; no production cutover.

## 结果与边界 / Result and scope

注册必须一次提交身份 OTP 与合规密码；普通 OTP 仅登录已有密码账号。历史无密码账号通过登录页「注册 / 完成设密」重新验身份后补齐，保留用户 ID、撤销旧会话并签发新会话。已有密码账号不能经注册覆盖密码。设置页不再有首次设密表单。

Signup requires identity OTP plus a valid password in one transaction. OTP-only login cannot create accounts. Legacy passwordless accounts complete through the registration endpoint after fresh identity OTP. Existing passwords cannot be overwritten through registration; settings have no initial-setup shortcut.

改密依次为：发码至已绑手机（无手机回退邮箱）→ 验码 → 五分钟、一次性、绑定 user_id + session_id 的 reauth → 提交 `reauth_token,password,current_password`。服务端只存令牌 SHA-256；成功改密原子消费用户全部未用升权、更新哈希、撤销其他会话，当前会话保留。旧 `/password/set` 是同样严格的别名，不能绕过。

Password changes require bound-phone OTP (email fallback), a five-minute single-use session-bound reauth, the current password, and a policy-compliant new password. The server stores token hashes only. Changes revoke other sessions while keeping the caller; the legacy endpoint enforces the same requirements.

密码沿用现有 8–128 位策略及异步 Argon2id 参数。品牌 JeaYon 和侧栏「导航 / 看板、待办、计划、日记、组织」已保留。未实现忘记密码重置、微信、供应商切换、注销、ICP、异地通知、泄露库查询、WebAuthn 或定期轮换。

Existing password policy/Argon2id settings and JeaYon branding/navigation are preserved. Recovery, WeChat, provider changes, account deletion, ICP, change-location notifications, breach lookup, WebAuthn, and periodic rotation remain out of scope.

## 实现 / Implementation

- `server/src/auth/service.ts`, `server/src/app.ts`: register, restricted OTP login, bound reauth request/verify, strict change/set alias; transactional session rechecks and revocation.
- `server/src/db/migrations/007_password_signup_reauth.ts`, migrator, `deploy/grant-runtime.sql`: extend OTP purpose/binding constraints; create indexed reauth hash records; runtime SELECT/INSERT/UPDATE only. No historical password resets or business data deletion.
- `server/src/db/maintenance.ts`: owner-only retention of reauth expired over 24 hours; session FK cascades. API receives no DELETE permission on reauth.
- `app/src/auth/{LoginPage,PasswordSettings,api}` and error mappings: explicit registration completion and multistep password change; no browser token persistence or mock backend.
- Tests/helpers and actual frontend HTTP/DOM scripts updated for the new contract. `jsdom` is a development-only dependency for real React component DOM tests; production bundle does not include it. Preview exports only reject operations.

用途隔离：register/password_change 的发送冷却、目标/IP 配额与验证配额均与 login 隔离；供应商总日预算保留共享。完整 API、错误码、配额及 Cookie 契约见 [auth-password-contract.md](auth-password-contract.md)。

Purpose-specific OTP limits isolate register/password_change from login; aggregate provider budgets remain shared. See the canonical contract for API schemas, errors, quotas, and cookie/session rules.

## 验证 / Verification

运行时 / Runtime: `/opt/node24/bin/node`, v24.22.1; real PostgreSQL 16 `dwa_test`. No memory DB, fake login, or production test reset.

| Check / 检查 | Actual result / 实际结果 |
| --- | --- |
| Full server tests / 后端全量 | 188/188 PASS, 19 suites, zero skipped |
| Full app unit tests / 前端全量单测 | 57/57 PASS, zero skipped |
| Server + app typecheck / 双方类型检查 | PASS |
| Server + app build / 双方构建 | PASS |
| Frontend API / 前端接口 | PASS, actual frontend module → real HTTP → PostgreSQL |
| React DOM flows / 组件交互 | PASS, actual components → real HTTP → PostgreSQL; signup mismatch, mandatory current password, OTP steps, no initial setup shortcut |
| Isolated preview module smoke / 隔离预览模块 | PASS; new exports reject mutations |
| Lint / 静态检查 | Neither project defines a separate lint command; strict typecheck passed |
| Browser E2E / 浏览器实测 | Not run: CUA inventory contained no browsers; DOM integration is not browser/visual acceptance |

后端覆盖：注册必密与密码策略、OTP-only 不建号、已有密码不可覆盖、历史补齐一次及旧会话撤销、事务失败全部回滚、并发注册一次消费、purpose 隔离、手机优先/邮箱回退、无绑定拒绝、OTP 五次错误与过期、用户/会话绑定、缺失/无效/过期/重放 reauth、当前密码必填与错误拒绝、并发改密、其他 access/refresh 失效、当前会话保留、密码登录及配额回归。

Backend coverage includes mandatory-password signup, atomic rollback, legacy completion, no overwrites, concurrent consumption/changes, purpose separation, destination priority/fallback, OTP expiry/attempts, reauth expiry/replay/session binding, current-password checks, and session/password-login regressions.

基线 server 为 176/177。失败来自 SQL 日历天跨本次 DST 结束多出一小时；新会话改为精确 168/720 小时后，全量通过。该修复保持原定七/三十天安全上限，不修改历史会话。

Baseline server result was 176/177: calendar-day intervals crossed the DST transition and added an hour. Exact 168/720-hour intervals fix new-session lifetimes; the final full suite passes. Existing sessions were not rewritten.

复现 / Reproduce:

```bash
cd /workspace/selfhost/server
PATH=/opt/node24/bin:$PATH TZ=UTC npm test
PATH=/opt/node24/bin:$PATH npm run typecheck
PATH=/opt/node24/bin:$PATH npm run build
TZ=UTC /opt/node24/bin/node --env-file-if-exists=.env --import tsx scripts/frontend-auth-check.mjs
cd ../app
PATH=/opt/node24/bin:$PATH npm test
PATH=/opt/node24/bin:$PATH npm run typecheck
PATH=/opt/node24/bin:$PATH npm run build
TZ=UTC /opt/node24/bin/node --env-file-if-exists=../server/.env --import tsx tests/auth-flows.mjs
PATH=/opt/node24/bin:$PATH node tests/preview-smoke.mjs
```

测试脚本只允许专用 `dwa_test`，会重建其 public schema；不得指向线上库。The guarded integration harness resets only its dedicated test database. Run database-backed scripts sequentially.

## Staging HTTPS 验收 / Live acceptance

最终批次 2026-10-27 14:57:35–14:58:37 UTC 通过：无密码 OTP 不建号；注册缺密/策略错误拒绝；成功注册 has_password=true；已有密码注册返回 409 且原密码保留；旧设密捷径拒绝；无效 reauth 403；跨会话 OTP/token、OTP/token 重放拒绝；当前密码缺失/错误拒绝；成功改密后其他 access/refresh 401、当前 access/refresh 200；新密码登录与备用 OTP 登录成功。

The final HTTPS run passed signup, no-overwrite and no-bypass checks, reauth/session binding/replay rejection, mandatory-current-password checks, other-session revocation, caller preservation, and password/backup-OTP login. Expired reauth and phone-over-email priority were exercised in the real PostgreSQL suite; no live clock/credential/expiry manipulation was used.

最终 API、Postgres、Caddy 均 healthy；容器内 5 个关键编译文件 SHA-256 与本地构建相同。所有本轮验收测试遗留会话已按合成身份及时间窗撤销，测试账号保留；没有改动真实用户凭证。

All three containers are healthy; five critical compiled API files match the local build hashes. Remaining sessions from these synthetic acceptance identities were revoked with an exact identity/time scope; test accounts remain. No real user credential was changed.

## Staging 部署与备份 / Deployment and backup

Target: Lighthouse `43.136.106.96`, `/home/ubuntu/jeayon-work`, Compose project `jeayon-work-staging`, NODE_ENV development with the existing console OTP provider. No production cutover.

远端备份 / Remote backup: `/home/ubuntu/jeayon-work/backups/password-signup-reauth-20261027T142010Z/` (private permissions).

- `before.tar.gz`: source, compiled API, frontend assets, deployment configuration; 1,674,077 bytes, SHA-256 `775649c37cccd713c5e94f83d6310e60d4d8679a211aa30d3ff3187728a4150e`.
- `database.dump`: 62,706 bytes, SHA-256 `c47d67af9c303f7331d729a659e43f3d930aaf89a65075178e7093699dcd0f92`; custom archive verified using PostgreSQL 16 `pg_restore --list`.
- Previous image retained as `jeayon-work-api:before-signup-reauth-20261027T142010Z`.

已先构建镜像，再执行迁移、授权和仅 API 重建；Postgres 与 Caddy 容器 ID、启动时间、镜像保持不变。前端按资源先、index 最后原子替换，保留挂载目录 inode 和旧资源；11 个发布静态文件经 HTTPS 校验 SHA-256。远端登录页源码仅残留旧品牌 alt/title，已按本轮要求保留 JeaYon；其他已存在核心源码与读取基线匹配。

Built before migration; recreated only API. Postgres/Caddy container identities, images and start times are unchanged. Frontend files were replaced with index last, preserving the bind-mount directory inode and old assets. Eleven published static files passed HTTPS SHA-256 verification.

线上验收曾发现 Postgres 单文件绑定挂载仍读旧授权脚本，导致新表权限不足而 500；已通过 stdin 执行当前脚本修复，验证 API 有 SELECT/INSERT/UPDATE 且无 DELETE。失败批次测试会话已撤销，测试账号和备份均保留；随后重跑完整验收。部署脚本也已改用 stdin，避免同类挂载旧 inode 问题。

Live acceptance caught stale bind-mounted grants. The current script was applied through stdin, runtime permissions checked, and acceptance restarted. Failed-run test sessions were revoked; accounts/backups were retained. The deployment helper now uses stdin for grants.

TLS/网络边界 / TLS/network limits: 服务器 `--resolve jeayon.com:443:127.0.0.1` 与 SSH 隧道 `jeayon.com:19443:127.0.0.1` 健康检查均通过且未关闭 TLS 校验；当前执行环境直接 `--resolve` 到公网 IP 遇到 curl 35 / TLS EOF（含 noproxy 重试）。未声称当前环境公网直连通过。

Server-local HTTPS and a verified-TLS SSH tunnel pass. Direct public-IP TLS from this execution environment fails with EOF, including a noproxy retry; no claim of direct external success is made.

回退边界 / Rollback: 保留镜像及源/数据库备份；不要直接回退到旧宽松设密 API，因为会重新引入本轮修复的缺口。若需回退，先关闭认证写入，再由授权运维选择协调恢复；本轮未执行恢复、数据库降级或删除任何远端项目/备份。

The old image and source/database backups are retained. Do not blindly re-enable the old permissive authentication API. Any rollback requires coordinated auth-write suspension and an authorized operator decision; no restore, downgrade, or remote project/backup deletion was performed.

## 证据 / Evidence

Paths relative to `/workspace/selfhost`:

- `logs/password-signup-reauth-checks.jsonl`: local counts, frontend API/DOM traffic, TLS/tunnel limitations.
- `logs/password-signup-reauth-deploy.jsonl`: remote backup hashes, image retention, migration/API/frontend verification and grants correction.
- `logs/password-signup-reauth-live.jsonl`: final staging HTTPS assertions; attempts 1/2 retained separately for traceability.
- `logs/password-signup-reauth-{server,app}-{tests,typecheck,build}.txt`: actual full command output.
- `server/scripts/password-signup-reauth-acceptance.py`: staging curl acceptance; credentials/OTP stay in memory and curl config stdin, never evidence or argv.

证据仅保留状态、计数、路径、散列与断言；无验证码、密码、Cookie 或 reauth 原值。No OTP, password, cookie or raw reauth token is copied into JSONL evidence. No git commit/push, package publication or production cutover.
