# Password/session acceptance report / 密码凭证与会话验收报告

Historical first-round report. Current signup/step-up behavior and acceptance are in `password-signup-reauth.md`. Superseded by `auth-password-fix-r2.md` for current state. Live checks below ran in **staging / NODE_ENV=development with console OTP**, not production Compose or real providers.

Result: password scope deployed and accepted on https://jeayon.com. Authentication tests and production differential checks pass. The complete server suite is **not green**: three unrelated pre-existing failures remain, reproduced against the original OTP implementation. No git commit/push, remote file/project/branch deletion, provider change, or production data reset was performed.

验收时间 / Evidence window: 2026-10-27 01:08–01:14 UTC (2026-10-26 evening America/New_York).

## Contract / 契约

Canonical state machine/API contract: [auth-password-contract.md](auth-password-contract.md). Authenticated initial setup needs a valid session; subsequent changes require the current password. Both setup and change preserve the caller and revoke all other sessions, so their access JWT and refresh credentials fail. Password login never creates identities. Unset, absent, disabled and wrong-password cases return the same `401 invalid_credentials`; UI text is `账号或密码不正确`.

Argon2id v19 uses 19456 KiB, two passes, one lane, a random 16-byte salt and a 32-byte tag. The DB permits only NULL or that PHC format. Passwords are exact strings, 8–128 UTF-16 code units, without C0/DEL controls; no trimming/Unicode normalization. Runtime requirement is Node >=24.7 <25; deployed Node is v24.22.1. No extra hash dependency is required.

Password login quotas: IP 20/minute, 100/hour, 300/day; normalized channel+target 5/minute, 20/hour, 40/day. Authenticated setup/change: user 5/minute, 20/hour. PostgreSQL persists quotas; attempts count even on success, independent of account existence. Exceeded quotas return 429 with Retry-After; correct passwords are blocked during the same interval. OTP keeps its own existing limits and provider.

Both login paths share session creation and signing. Cookies remain host-only, HttpOnly, Secure, SameSite=Lax: `__Secure-dwa_access` at `/api`, up to 15 minutes; `__Secure-dwa_refresh` at `/api/auth`, seven-day idle / 30-day absolute session lifetime. All mutations require exact Origin + `x-dwa-csrf: 1` + JSON. Refresh rotation/replay/logout semantics are unchanged. `/me` adds only `has_password`.

## Changed files / 改动文件

Paths are relative to /workspace/selfhost. The workspace already contained a local scrypt password draft; it was not deployed. This work replaces that draft and deploys the reviewed password path over the original live OTP implementation.

| Files | Change |
| --- | --- |
| server/docs/auth-password-contract.md; server/src/auth/password-contract.ts | Independent state machine/API contract; source points to canonical document |
| server/src/auth/password.ts | Async native Argon2id, exact password handling, strict PHC parsing, same-cost dummy verification |
| server/src/auth/service.ts | Shared OTP/password session creation, generic credential errors, persistent quotas, optional credential setup/change, transactional caller-session recheck, other-session revocation, safe has_password projection |
| server/src/app.ts | Public password login and authenticated setup/change routes; existing CSRF hook applies |
| server/src/db/migrations/005_user_password.ts; server/src/db/migrator.ts | Nullable hash/timestamp, Argon2id-only DB CHECK, migration registration/readiness |
| server/package.json; server/package-lock.json | Runtime floor matches native Argon2 availability; dependency versions unchanged |
| app/src/auth/api.ts; app/src/auth/LoginPage.tsx | Existing password login draft activated; setup policy validation and accurate entry-point hint |
| app/src/auth/PasswordSettings.tsx; app/src/teams/TeamSettingsPage.tsx; app/src/teams/TeamGate.tsx | Shared setup/change form; accessible with or without team membership; current password, confirmation, session update and revocation notice |
| server/tests/password.test.ts; server/tests/password-session.test.ts | Hash/policy tests and real PostgreSQL credential/session integration coverage |
| server/scripts/frontend-auth-check.mjs; server/scripts/password-curl-acceptance.py | Actual frontend API over real HTTP/PG; production HTTPS curl differential checks with redacted evidence |
| server/README.md; server/docs/auth-password-deployment.md; this report | Contract links, reproducible verification/deployment, results and limitations |

AuthProvider, apiClient, OTP providers, Compose/Caddy and unrelated business source were inspected and left unchanged. app/dist and server/dist are build outputs.

## Test results / 测试结果

| Check | Actual result |
| --- | --- |
| Targeted auth / password / CSRF / quota tests, Node 24.22.1 + real PostgreSQL 16 | **51/51 PASS** — logs/auth-targeted-tests.txt |
| Actual frontend API module with real HTTP listener + PostgreSQL, Node 24.22.1 | **PASS**, 10 requests; credentials=include for all, CSRF=1 on every mutation — logs/frontend-auth-http-node24.json |
| Frontend unit tests | **50/50 PASS** — logs/app-tests.txt |
| Server typecheck and build | **PASS** |
| Frontend typecheck and build | **PASS** — logs/app-build-final.txt |
| Full server suite | **161/164 PASS, 3 FAIL** — logs/password-tests-utc.txt |
| Original OTP baseline reproduction of affected suites | **70/73 PASS, same 3 FAIL** — logs/auth-baseline-tests.txt |
| Lint | Neither project defines a lint script; no lint success is claimed |
| Browser interaction/rendering | Not run: no browser available; in-app tab creation returned `Browser is not available: iab` |

Existing failures: business.test.ts:215 accepts a validation case expected to fail; business.test.ts:326 parent progress remains 50 when test expects 100; deployment.test.ts:25 local Caddyfile lacks the expected www redirect. These files were not changed or deployed by this work. No tests were skipped or weakened to hide the failures.

Local PG defaults to America/New_York, while production PG reports Etc/UTC. Test runs use PGOPTIONS='-c timezone=UTC' to match production and avoid the upcoming DST transition changing the elapsed length of the original SQL `interval '7 days'`. OTP interval logic was preserved.

## Real existing phone account / 线上已有手机号账号

Sample: **+8613****8001**, existing user **649dce00-3867-4d28-a30d-c05001ad65eb**, selected before migration from an existing active phone identity without team membership. No user/identity was created for this production test. Phone ownership/SMS delivery is not newly verified: the existing console OTP provider was used exactly as deployed; no real SMS is claimed.

| Production check | Evidence |
| --- | --- |
| Before deployment, OTP → GET /api/auth/me | 200; existing user ID captured at 01:08:43 UTC |
| Before setup, password login | 401 invalid_credentials; same response as absent identity |
| Unauthenticated setup / missing CSRF | 401 unauthenticated / 403 csrf_rejected |
| After setup, OTP-session me vs password-session me | Both 200; full user objects equal, same user ID and has_password=true, at 01:11:39 UTC |
| Cookie equivalence | Same names, paths, HttpOnly/Secure/SameSite=Lax, no Domain; observed password access Max-Age=899, refresh Max-Age=604799 |
| Wrong current password | 401 invalid_credentials; other valid session remains usable |
| Successful change | Caller me=200; other session me=401 and refresh=401, at 01:11:48 UTC |
| Wrong password vs missing/no-password identity | Identical 401 envelope; no cookies issued |
| Real target lock | Correct password=429 rate-limited; Retry-After=12 seconds; no production quota changes |
| Recovery | After waiting the real interval, password login=200 at 01:12:02 UTC |
| OTP regression after change | Verify=200, me=200, same user as password path; invalid OTP=400 |
| Logout | Old me=401 and refresh=401 |
| DB aggregate | One non-null password record, zero records outside the Argon2id PHC format; no plaintext credential column introduced |
| Final runtime restart smoke | Login/me/refresh=200; after logout me=401, at 01:14:05 UTC |

Machine-readable redacted evidence: logs/password-curl-baseline.jsonl, logs/password-curl-after.jsonl, logs/password-curl-final-smoke.jsonl. Cookie values, OTP codes, password and hash values are absent from these files.

Historical first-round state retained a known acceptance password. Round two requires clearing both password columns, revoking all sessions and deleting the authorized private state/cookie files. See the round-two report for actual cleanup evidence. Future acceptance passwords are temporary and cleared before completion.

## Deployment / 部署

[Reproducible commands and recovery caveat](auth-password-deployment.md).

1. Captured original OTP/cookie baseline. Backed up database with pg_dump, source and frontend; tagged old API image. Backup: `/home/ubuntu/jeayon-work/deploy/backups/password-auth-20261027/`, old image `jeayon-work-api:before-password-20261027`.
2. Uploaded only changed auth source/migration/contract plus compiled frontend, preserving old static assets. Existing Compose, Caddy, secrets, providers and business source were retained.
3. Built `jeayon-work-api:staging` through existing staging Compose; ran named migration container `jeayon-password-migrate-20261027` without auto-removal. Output: **005_user_password: Success**. The retained container and backups were not deleted.
4. Recreated API with `docker compose -f docker-compose.staging.yml up -d --no-deps api`. Rebuilt/restarted once more to include the accurate Node >=24.7 engine requirement. Final API/Caddy/Postgres all healthy; HTTPS and container readiness both 200.
5. Ran the real HTTPS curl matrix and final restart smoke. Direct HTTPS from the workspace failed with TLS EOF, so curl used an SSH tunnel to Lighthouse Caddy with the original jeayon.com SNI/Host and normal certificate validation; no `-k` or auth bypass.
6. Verified deployed source SHA-256 against local files and fetched the actual frontend entry/JS bytes. Served asset `/assets/index-CbXK_drG.js` equals the local build, SHA-256 **7b8752ad7f8c9c1a318df4045a129643cdcf2ef1dd7dcdf6cd298491311ea09b**.
