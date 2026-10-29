# Daily Work API / 每日工作后端

Node 24, strict TypeScript ESM, Fastify 5 + matching cookie plugin, Kysely SQL migrations and PostgreSQL 16. All auth/session/quota/business state is stored in PostgreSQL. Password credential/session contract: [auth-password-contract.md](docs/auth-password-contract.md). Deployment and verification: [auth-password-deployment.md](docs/auth-password-deployment.md).
使用 Node 24、严格 TypeScript ESM、Fastify 5、Kysely SQL 迁移和真实 PG16；认证、会话、配额和业务状态均落库。本批没有修改前端。

## Local run / 本地运行

From `server/`, use the existing private `.env` or copy `.env.example` and replace placeholders. Database credentials belong only in the ignored `.env` or protected process environment. No database creation or cluster startup is automated. HTTP is allowed only for loopback development origins. `NODE_ENV` and both providers are mandatory; console is allowed **only** for `NODE_ENV=development`, including in integration tests.
在 server/ 内使用已有私密 `.env`，或复制示例并替换占位符。凭据只放忽略文件或受保护环境。脚本不建库、不启动集群。仅开发 loopback 允许 HTTP；console 在 test/production 均拒绝启动。

```sh
export PATH=/opt/node24/bin:$PATH
npm ci
npm run migrate
npm run dev
```

`APP_ORIGIN=http://127.0.0.1:5183`, API default `127.0.0.1:8787`. The later frontend step must proxy `/api` without removing the prefix. Direct API clients must send the exact Origin, JSON Content-Type and `X-DWA-CSRF: 1` on **every POST/PUT/PATCH/DELETE**, including OTP/refresh/logout. No CORS wildcard or credentials exception exists.
默认前端 origin 如上，API 端口 8787。后续前端需添加保留前缀的代理。全部变更请求必须同时有准确 Origin、JSON 和 CSRF 头。

```sh
export PATH=/opt/node24/bin:$PATH
curl --fail http://127.0.0.1:8787/api/health/ready
curl --fail -X POST http://127.0.0.1:8787/api/auth/otp/request \
  -H 'Origin: http://127.0.0.1:5183' -H 'Content-Type: application/json' -H 'X-DWA-CSRF: 1' \
  -d '{"channel":"email","target":"local@example.test","purpose":"login"}'
```

The DEV ONLY console prints a freshly generated six-digit code and challenge ID, without sending anything. Submit `{challenge_id,code}` to `/api/auth/otp/verify`; use a curl cookie jar if testing the session manually. Console logging is the sole intentional development-only plaintext OTP output. Request bodies, headers containing credentials, query strings and driver errors are not logged.
开发 console 只在本机输出新生成验证码与 challenge，不发送邮件/短信。提交验证码后使用 cookie jar 保存会话。此输出是唯一明确允许的开发验证码明文；日志不会记录正文、凭据头、query string 或数据库错误参数。

```sh
export PATH=/opt/node24/bin:$PATH
npm run typecheck
npm test
npm run build
NODE_ENV=development npm start
# Optional, only when explicitly desired: creates demo@example.test and Demo team.
npm run seed
```

Seed refuses non-development mode. It does not run during startup/migration and does not create a fake login. `demo@example.test` still requires a real console OTP verification and database session.
seed 仅显式运行且仅限 development；演示账号仍须通过真实验证码与数据库会话登录。

## Tests / 测试

`TEST_DATABASE_URL` is mandatory. Tests refuse any URL whose database name is not exactly `dwa_test`, refuse a dev URL targeting the same database, and verify `current_database()` plus PostgreSQL major 16 before resetting `public` between integration suites. Never point test configuration at real data. Tests use real SQL migrations and `fastify.inject`; console capture hooks expose generated codes only to the test instance. No bypass endpoint, fake auth, memory DB or SQLite is used.
测试强制要求 TEST_DATABASE_URL，URL/实际库名必须是 dwa_test、PG 必须是 16，并拒绝开发连接也指向该库。每个集成套件重建 public schema；不要放真实数据。会话通过真实 verify 路由获得。

Tencent HTTP is stubbed only at the delivery boundary. `tests/tc3-vector.py` independently computes the signing vector with Python hashlib/hmac and a public synthetic key. Concurrency tests hold a real team row lock and observe two distinct API PostgreSQL backends waiting before releasing it; optimistic updates cannot both win. Tests also exercise permission roles, inactive membership, quotas surviving app recreation, OTP expiry/attempts/supersession, refresh replay, CSRF and strict body allowlists.
仅腾讯发送边界使用 stub；Python 独立签名向量不含真实凭据。并发测试确认两个独立 API DB 连接等锁后再释放，覆盖版本冲突及事务规则。

There is no separate lint configuration; strict `npm run typecheck` is the static check. Use `npm test` for actual current counts; do not treat old documentation counts as a new run.
没有单独 lint 配置；静态检查使用严格 typecheck。测试数量以本次实际 npm test 输出为准。

## API / 接口

All routes below start with `/api`. Success: `{ok:true,code:'ok',message:'ok',data}`. Failures: `{ok:false,code,message,data?}` with meaningful HTTP status. OTP request data is `{challenge_id,expires_in,retry_after}` (202). Version conflict is `409 conflict` with `data.current_version`; unique daily log conflict is `409 already_exists`. Unauthorized collection reads return `[]`, single-task reads return `null`; explicit unauthorized writes return 403. Dates remain `YYYY-MM-DD`, timestamps ISO UTC, hours decimal strings/null, bigint IDs checked for safe integer DTO conversion.
所有接口使用统一信封和真实 HTTP 状态。无权限集合为空、单任务为 null，明确写操作为 403。日期/时间/工时和安全整数转换遵守批准契约。

| Routes | Purpose / 用途 |
| --- | --- |
| `POST /auth/otp/request`, `POST /auth/otp/verify` | Email/phone login only / 邮箱或手机登录 |
| `POST /auth/password/login`, `POST /auth/password/set` | Optional Argon2id password login and authenticated set/change / 可选密码登录与设密、改密 |
| `GET /auth/me`, `POST /auth/refresh`, `POST /auth/logout` | Session/rotation/revocation / 会话、轮换、撤销 |
| `GET /teams`, `POST /teams`, `POST /teams/join` | Current active teams/create/join / 当前团队、创建、加入 |
| `GET /teams/:teamId/members` | Active + historical membership / 成员及停用历史 |
| `GET /teams/:teamId/invite-code`, `POST /teams/:teamId/invite-code/reset` | Owner/admin only / 仅 owner/admin |
| `PATCH /teams/:teamId/members/:userId/role` | Owner changes admin/member / owner 改角色 |
| `POST /teams/:teamId/members/:userId/remove` | Deactivate, unassign unfinished tasks, rotate invite atomically / 原子停用、解绑、换码 |
| `GET /teams/:teamId/tasks?scope=active\|archived`, `POST /teams/:teamId/tasks` | List/create collaborative tasks / 团队任务查询/创建 |
| `GET /tasks/:taskId`, `PUT /tasks/:taskId`, `PATCH /tasks/:taskId/archive` | Read/update/archive/restore / 读写、归档恢复 |
| `GET /teams/:teamId/tasks/:taskId/logs` | Related log projection / 关联日报投影 |
| `GET /teams/:teamId/work-logs`, `POST /teams/:teamId/work-logs` | Latest 300 by default; query `owner_id=me&work_date=YYYY-MM-DD` for single / 日报查询、创建 |
| `PUT /work-logs/:logId`, `DELETE /work-logs/:logId` | Active author only / 仅有效成员且为作者 |
| `GET /health/live`, `GET /health/ready` | Process / DB + migration readiness / 存活、数据库迁移就绪 |

Task/log writes require positive integer `expected_version` except creation. No physical task/team deletion is exposed. Updates use full drafts with strict field allowlists; see PLAN.md §6 for exact bodies. Work-log update excludes `owner_name`; delete takes JSON `{expected_version}`. The custom header is `X-DWA-CSRF`, providers use `tencent-ses` / `tencent-sms`, and secrets are named `JWT_SECRET` / `OTP_PEPPER` / `RATE_LIMIT_HMAC_SECRET` for this implementation.
任务/日报更新和归档/删除需正整数 expected_version。请求字段详见 PLAN §6；日报更新不接受 owner_name。当前实际环境变量和头名以上述为准。

## Auth and production / 认证与生产

Access JWT: jose HS256, 15 minutes, issuer=APP_ORIGIN, audience=daily-work-api, subject/user + session ID only (no team roles/targets). Each authenticated request checks the live database session and active user, then current team membership. Refresh: 32 random bytes, only SHA256 hash stored, single-use rotation; ≤5-second reused-token conflict returns 409 without issuing/clearing cookies, later replay revokes the session. Absolute lifetime 30 days; idle 7 days. HTTPS cookies use `__Secure-` names, httpOnly, Secure, SameSite=Lax, host-only; paths `/api` and `/api/auth`. Logout is idempotent and revokes any presented recognized session.
JWT 15 分钟；每次验证当前数据库会话/用户与团队角色。refresh 使用高熵随机值的 hash，轮换、重放撤销，绝对 30 天、闲置 7 天；Cookie 属性和路径如上。

OTP HMAC-SHA256 binds key version/challenge/purpose/channel/normalized target/bindings/code using unambiguous JSON tuple encoding. Codes expire in five minutes, close after five failed attempts and are superseded on resend. Durable PostgreSQL quotas implement PLAN §4.3 target, trusted-IP (IPv6 /64), general API, join and provider budgets; day windows use Asia/Shanghai midnight. Cooldown is a real 60-second expiration, not a minute-boundary bucket. No network delivery occurs under database locks.
OTP 使用带 pepper 的 HMAC，绑定 challenge/用途/目标等，五分钟有效、最多五次错误、重发废旧码。配额全部落 PG，日桶按上海自然日，发送冷却为完整 60 秒；外部发送不占 DB 锁。

We use native fetch + TC3-HMAC-SHA256 rather than an entire cloud SDK because only two fixed actions are needed; the exact fields and signature are independently tested. Timeout is 8 seconds, no automatic billable retries. SES approved template variables: `code`, `expiresMinutes`; SMS template parameters: code then minutes. HTTP 200 alone is insufficient: SES requires a message/request receipt; SMS requires matching-number Code=Ok and SerialNo. No real sends were made.
仅需两个固定 action，故选择 fetch + 可独立测试的签名，避免整套 SDK；8 秒超时、不自动重试。模板变量/顺序固定且须与审批模板一致。没有执行真实发送。

Production startup rejects console providers, HTTP origin, missing provider values, short/obviously weak or shared secrets. Actual Tencent account approval/credentials/delivery cannot be verified offline. Behind Caddy, trust only its fixed address; leave TRUST_PROXY_CIDR unset for direct native development. Use distinct migrator/runtime/backup roles in production; see [deployment and restore](../deploy/restore.md). Runtime has no DDL/migration-record write grant. Startup never auto-migrates or seeds.
生产拒绝 console、HTTP、缺配置、短/明显弱/复用密钥；真实腾讯账号审批与送达须另行验收。生产角色分离，启动不自动迁移或 seed。

Official API references: [TC3 signing](https://cloud.tencent.com/document/api/213/30654), [SES SendEmail](https://cloud.tencent.com/document/api/1288/51034), [SMS SendSms](https://cloud.tencent.com/document/api/382/55981), [Fastify cookie compatibility](https://github.com/fastify/fastify-cookie#compatibility).

Explicit retention maintenance is implemented in `src/db/maintenance.ts`: OTP expiry +24h, quota expiry +48h, session absolute expiry +30d and audit age 90d. Run `npm run maintenance` only with an explicit owner `MIGRATION_DATABASE_URL`; the API role cannot run these deletions. Schedule the compiled `dist/db/run-maintenance.js` once daily on the deployment host after release. No cleanup runs automatically from API startup or GET handlers.
已实现显式保留清理，需独立 owner 连接运行 maintenance；部署后由运维安排每天一次。API 账号无此删除权限，启动/GET 不隐式清理。

## TODO / 未实施

- Optional identity linking and reauthentication: `POST /auth/reauth/verify`, `POST /auth/identities/verify`, `GET /auth/identities`, OTP purposes `link`/`reauth`. They currently reject or are absent; email and phone remain separate accounts. No automatic merge.
  可选身份绑定和重新认证暂未实现，邮箱与手机保持独立账号、不自动合并。
- Frontend migration/page work, cloud-data import/identity reconciliation, public deployment, real Tencent delivery, Docker execution and restore drill are not part of this step.
  前端、旧云数据导入/身份映射、公开部署、真实腾讯发送、Docker 和恢复演练未在本步执行。
