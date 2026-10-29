# Password repair round two / 密码认证第二轮修复

Result / 结果: the requested repairs, deployment and listed acceptance checks passed on **2026-10-27 02:19 UTC** (2026-10-26 evening America/New_York). Live deployment remains **staging / NODE_ENV=development, console OTP**. This does not certify production Compose or real provider delivery. No git commit/push, remote project deletion, WeChat, real SMS, ICP or password-recovery feature work occurred.

## Repairs / 修复内容

| Review item | Repair and verification |
| --- | --- |
| IP quotas collapse onto Caddy | Dedicated edge network `172.30.240.0/24`; Caddy fixed `.2`, API fixed `.3`; API trusts only `172.30.240.2/32`. Removed host port 8787. Caddy retains secure default XFF behavior. Pre-change persisted quota HMAC matched Caddy `.3` on the old network; post-change matched the real connecting client, not Caddy or forged XFF. Trusted/untrusted proxy integration tests cover independent IP buckets and 20/min boundary. |
| Known acceptance password | Cleared both password columns for `649dce00-3867-4d28-a30d-c05001ad65eb`, revoked every session, verified prior known password → 401 and OTP → 200, revoked that OTP session. Deleted six authorized private state/cookie files; exact old-password byte scan across workspace found no matches. New acceptance passwords/cookies stay in process memory and final cleanup clears both columns and all sessions. Historical persistent-state runner now refuses execution. |
| Email-only UI blocked | OTP form now switches phone/email, calls existing requestEmailCode (which normalizes email), reuses challenge/verify/session flow. Actual frontend API integration over HTTP + PostgreSQL logs in an email-only user, sets password, then logs in with it. |
| Recovery and timing contract | Explicitly documents no OTP reauthentication/self-service recovery, transactional operator clearing of both password columns plus all-session revocation, and accepted residual timing differences caused by existing-account row locks. |
| Missing evidence events | New runner emits missing-CSRF, unauthenticated setup, wrong current password, absent/unset generic errors, changed-password/session revocation, correct-password lockout, cleanup, independent IP/target locks and untrusted XFF evidence. |
| Staging vs production ambiguity | Current deployment and acceptance documents explicitly label staging/development + console OTP; historical first-round report marked superseded. |
| Oversized current password | Kept existing server limit. Contract explicitly specifies >256 code units → 400; missing/wrong values within limit → 401. Current-password input now has maxLength=256. Integration test covers both boundaries. |
| Frontend validation drift | Phone/email normalization matches server; removed login's minimum-eight restriction while retaining ≤256 login limit and 8–128 setup policy. A short incorrect password reaches the real API and returns generic 401. Control characters have a separate error message. |
| Preview missing exports | Added rejection-only password stubs. Unit checks and a Vite dev module-loading smoke verify imports resolve. |
| Three existing failures | Tests now expect todo progress clamp (201 + 0), use PATCH /tasks/:id/complete, and match apex-only Caddyfile with comment explaining missing www DNS. Business source unchanged. |

## Verification / 检查结果

| Check | Actual result / Evidence |
| --- | --- |
| Node 24 baseline | 164 total, 161 pass, same 3 failures — logs/password-fix-r2-server-before.txt |
| Full server tests after final IP reservation fix | **167/167 pass**, no skips — logs/password-fix-r2-server-tests.txt |
| Frontend tests | **53/53 pass** — logs/password-fix-r2-app-tests.txt |
| Server and frontend typecheck/build | All pass — logs/password-fix-r2-{server,app}-{typecheck,build}.txt |
| Actual frontend API + HTTP + PostgreSQL | PASS, 17 requests; email-only OTP → set → password login; short wrong password → 401 — logs/password-fix-r2-frontend-api.json |
| Preview | PASS: dev module loading and exports — logs/password-fix-r2-preview.jsonl. No browser rendering claim: CUA inventory had no browsers. |
| Live target quota | Five wrong attempts → 401; correct sixth → 429, Retry-After=56; real windows were awaited without resetting quotas — logs/password-fix-r2-acceptance.jsonl |
| Live IP/target independence | Target lock shared across two real source IPs; other target remained eligible. Each source independently reached 20 IP attempts then 429; second source still returned 401 after first source locked. Persisted IP counts `[20,20,0]` for public, loopback and forged XFF — logs/password-fix-r2-limits.jsonl |
| Untrusted direct request | Inside API container, direct loopback requests with two forged XFF values returned 401; persisted counts `[2,0,0]` for actual peer and forged peers — logs/password-fix-r2-limits.jsonl |
| Credential/session hygiene | Original and temporary acceptance passwords removed; final OTP=200 with has_password=false, then all sessions revoked — logs/password-fix-r2-credentials.jsonl and logs/password-fix-r2-acceptance.jsonl |
| Runtime and frontend | API/Caddy/Postgres healthy; HTTPS readiness succeeds; no API published port; host 127.0.0.1:8787 refuses connection; served index and JS bytes equal local build — logs/password-fix-r2-runtime.jsonl |
| Lint | Neither package defines a lint script; not claimed as run. |

Machine-readable test summary: `logs/password-fix-r2-tests.jsonl`. Pre/post IP evidence: `logs/password-fix-r2-before.jsonl`, `logs/password-fix-r2-after.jsonl`. All evidence excludes passwords, OTPs, cookies, credential hashes and secret values. Public client addresses are masked; fingerprints allow equality comparison.

## Deployment / 部署

1. Captured Docker network/port state and actual persisted API IP quota HMAC before changes.
2. Cleared known acceptance credentials, revoked all sessions and removed authorized local private files.
3. Backed up before deployment: `/home/ubuntu/jeayon-work/deploy/backups/password-fix-r2-20261027T0215/`, containing custom-format `database.dump`, verified `pg_restore --list`, source/frontend archive. Directory mode 700, original backup files mode 600. Prior image tagged `jeayon-work-api:before-password-fix-r2-20261027T0215`. Evidence: logs/password-fix-r2-backup.jsonl.
4. Uploaded changed configs/docs/frontend and built API via staging Compose. No migration needed. Recreated API, then Caddy using its separate edge Compose file; preserved database/certificate volumes, old assets and migration container.
5. First cutover exposed an address collision: API-first startup dynamically allocated Caddy's `.2`. Caddy failed to start. Pinned API to `.3`, added a static regression assertion, reran all 167 server tests/typecheck/build, then recreated API and started Caddy successfully. Failed/successful start timestamps were approximately 02:13:17/02:14:59 UTC; exact external outage duration was not measured. Full record: logs/password-fix-r2-deploy.txt.
6. Caddy validation passed; runtime health, byte-for-byte frontend comparison and live auth/limits matrix passed. Final report/scripts/config are overlaid without deleting remote projects/files.

## Changed files / 改动文件

- deploy/docker-compose.staging.yml; deploy/docker-compose.edge.yml; deploy/Caddyfile
- app/src/auth/LoginPage.tsx; app/src/auth/api.ts; app/src/auth/PasswordSettings.tsx; app/src/dev-preview/auth-api.ts
- app/tests/unit/auth-api.test.ts; app/tests/preview-smoke.mjs
- server/tests/password-session.test.ts; server/tests/business.test.ts; server/tests/deployment.test.ts
- server/scripts/frontend-auth-check.mjs; server/scripts/password-fix-r2-acceptance.py; server/scripts/password-curl-acceptance.py
- server/docs/auth-password-contract.md; server/docs/auth-password-deployment.md; server/docs/auth-password-acceptance.md; this report
- Built app/dist and redacted logs/password-fix-r2-* artifacts. Deleted only the six authorized files under server/acceptance-private/.

No server business/auth source implementation or production Compose was changed in this round; trustProxy already correctly supported one configured CIDR.

## Accepted risks and coverage limits / 遗留风险与覆盖边界

- Existing-account row locking retains the accepted residual timing difference under concurrency. Existing target quotas constrain attempts.
- No OTP reauthentication or self-service recovery. An untrusted caller session can persist through normal first-time setup; the documented operator reset must clear credentials and revoke every session.
- Live checks use staging/development + console OTP, not production-provider operation. No real SMS/email delivery claim.
- The two real source IPs came from Lighthouse's public hairpin and loopback paths. Both passed independent boundary checks; two independent Internet clients were not available. Workspace direct HTTPS POST encountered TLS EOF. No synthetic XFF was used to represent the two actual peers; forged XFF was separately verified ineffective.
- Browser rendering/interactions were unavailable. Frontend coverage is real HTTP/API/database plus Vite module loading and typecheck/build.
- Historical first-round backups may still contain the old credential hash. They were retained under the no-deletion instruction and must never be used to restore acceptance credentials. No original plaintext password bytes remain in the workspace; both workspace release archives exclude private state/cookie files.
