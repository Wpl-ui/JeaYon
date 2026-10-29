# Password auth deployment / 密码认证部署

Target: ubuntu@43.136.106.96, `/home/ubuntu/jeayon-work/`, existing `jeayon-work-staging` Compose project plus edge Caddy; origin https://jeayon.com. **This live acceptance runs in staging / NODE_ENV=development with console OTP. It does not certify production Compose or real SMS/email delivery.** No WeChat, provider, ICP or password recovery changes.

## Verification / 本地检查

Use Node 24 (the default Node 20 cannot import native Argon2), PostgreSQL 16 and the isolated `dwa_test` database:

```sh
PATH=/opt/node24/bin:$PATH npm --prefix server run typecheck
PATH=/opt/node24/bin:$PATH npm --prefix server run build
PGOPTIONS='-c timezone=UTC' PATH=/opt/node24/bin:$PATH npm --prefix server test
PATH=/opt/node24/bin:$PATH npm --prefix app test
PATH=/opt/node24/bin:$PATH npm --prefix app run typecheck
PATH=/opt/node24/bin:$PATH npm --prefix app run build
cd server
PGOPTIONS='-c timezone=UTC' /opt/node24/bin/node --env-file=.env --import tsx scripts/frontend-auth-check.mjs
```

UTC matches the live database and avoids DST affecting existing SQL calendar-day session intervals. Neither package defines a lint script. The three prior failing assertions now match existing task clamp/completion behavior and the apex-only Caddyfile (www has no DNS record); business code is unchanged.

## Release procedure / 发布流程

1. Record pre-change Docker networks/port bindings and the API's persisted IP quota key. Compare its HMAC with the actual connecting IP from Caddy access logs; never print keys, cookies, passwords or OTP values. Save redacted evidence under `logs/password-fix-r2-*.jsonl`.
2. Clear any previous acceptance password and revoke **all** sessions for acceptance user `649dce00-3867-4d28-a30d-c05001ad65eb`. Verify NULL hash/timestamp, uniform password 401 and successful console OTP login. Revoke the verification session too. Delete the authorized plaintext state files/cookie jars under `server/acceptance-private/`; scan the workspace for their exact password bytes without printing those bytes.
3. Before deployment, back up remote `server/src`, `server/docs`, `deploy` configuration and `app/dist`, plus a custom-format `pg_dump`. Exclude backup directories and acceptance-private files from archives. Use a mode-700 backup directory and mode-600 files; tag the previous API image. Never restore acceptance credentials from historical backups.
4. Upload the changed source/docs, staging/edge Compose, Caddyfile and built frontend. Overlay assets without deleting old assets. Preserve `.env`, providers and database volumes. No schema migration is required for round two.
5. From the remote deploy directory, build and recreate API with staging Compose. It creates `jeayon-work-staging_edge` (`172.30.240.0/24`), connects API at `172.30.240.3` to edge+database (so API-first startup cannot allocate Caddy's `.2`), removes published port 8787 and sets `TRUST_PROXY_CIDR=172.30.240.2/32`. Then recreate Caddy with edge Compose: it joins that existing edge network at `172.30.240.2`. Caddy's default X-Forwarded-For handling supplies the connecting client and ignores untrusted incoming XFF. These are two separate Compose invocations; the edge network is external only in the edge file.
6. Verify API/Caddy health, HTTPS readiness, static asset hashes, fixed Caddy IP and absence of host port 8787. Compare post-change persisted IP quota HMAC against Caddy's real client IP. Exercise independent IP and target quota locks, untrusted XFF, missing CSRF, wrong current password and generic absent/unset credential failures. Do not reset live quotas; wait for real windows when needed. Source paths and limitations must be recorded explicitly.
7. Every acceptance run generates random temporary passwords **in memory**, with no state files/cookie jars. Run live OTP → set → password login → change/session revocation checks. In a `finally` cleanup, set both password columns NULL and revoke all sessions. Verify password login is again `401 invalid_credentials`, OTP still works, then revoke that verification session. Assert zero active sessions and NULL hash/timestamp before reporting completion. Cleanup is required even after a failed acceptance run; rerun the cleanup mode if the process is interrupted.
8. Save actual test/build/acceptance results and remaining limitations. Never claim production-provider or browser coverage from staging API checks.

Round-two acceptance helper: `server/scripts/password-fix-r2-acceptance.py` (`before`, `after-ip`, `cleanup`, `acceptance`, `limits`). In `request()`, all request headers (including Cookie) and the JSON password body share an escaped `curl --config -` stream over SSH stdin; neither local nor remote argv contains these values, and no temporary credential files are created. Evidence excludes credentials. No TLS verification bypass. / `request()` 将所有请求头（含 Cookie）与 JSON 密码 body 转义后通过 SSH stdin 传入 `curl --config -`；本地和远端 argv 均不含这些值，不创建临时凭据文件，证据不含凭据。The original `password-curl-acceptance.py` is a historical runner; it refuses execution and directs operators to this runner so it cannot recreate persistent credential files.

Before deployment, verify `deploy/.env` explicitly sets `APP_ORIGIN=https://jeayon.com`: it must use HTTPS and match the public frontend origin exactly. Record only presence and equality, never dump `.env`. Staging requires `${APP_ORIGIN:?Set APP_ORIGIN}` and fails configuration when absent or empty; this substitution does not validate HTTPS itself. Stop deployment if the check fails. / 部署前确认 `deploy/.env` 显式设置 `APP_ORIGIN=https://jeayon.com`，必须使用 HTTPS 并与前端同源；只记录存在性和相等性，不输出 `.env`。staging 缺失或空值时配置失败；该变量替换本身不验证 HTTPS，检查不通过须停止部署。

Round three updates only the two Compose files and this deployment document on the server. Back up those three files into a new mode-700 directory before overwriting. Compare the effective staging API and edge Caddy APP_ORIGIN, networks/IPs, TRUST_PROXY_CIDR and ports before/after upload. If identical, do not recreate containers; if unexpectedly different, stop and report. Production is not started. Run only the helper's `cleanup` mode, not `limits`. Offline credential transport check: `python3 server/scripts/password-fix-r3-offline-check.py`. / 第三轮线上只更新两份 Compose 和本部署文档，先将三文件备份到新建的 700 权限目录；比对上述有效配置，相同则不重建，意外变化则停止报告，不启动 production；线上只执行 `cleanup`，离线检查命令如上。

## Operational reset / 运维重置

There is currently **no OTP reauthentication or self-service password recovery**. If an untrusted session set a password, an authorized operator must run the following in one transaction, then verify both credential state and session revocation:

```sql
BEGIN;
UPDATE users SET password_hash = NULL, password_updated_at = NULL WHERE id = '<affected-user-uuid>';
UPDATE sessions SET revoked_at = now() WHERE user_id = '<affected-user-uuid>' AND revoked_at IS NULL;
COMMIT;
```

OTP login remains available afterward. Successful normal set/change retains the calling session; this operational reset intentionally revokes every session, including the caller. Keep backups for deliberate recovery; no rollback/database restore is part of this release.
