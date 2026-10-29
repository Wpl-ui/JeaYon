# JeaYon credentials and sessions / 凭证与会话契约

Current implementation contract, 2026-10-27. Supersedes the optional-password contract. 本契约取代「可选密码 / 登录后首次设密」。

## State machine / 状态机

- Signup: request OTP with `purpose=register`, then submit `challenge_id,code,password` to `/api/auth/register`. Policy: existing `assertPasswordPolicy`, 8–128 UTF-16 code units, no C0/DEL controls, exact strings without normalization. One transaction verifies/consumes OTP, creates user/identity with Argon2id hash, and issues the session/refresh record. Failure rolls everything back. 注册必须验证码与合规密码一并提交；用户、身份、密码、OTP 消费和会话原子提交。
- Existing identity with a password: registration returns `409 password_exists` after valid identity OTP; it never overwrites the password. 已有密码不可经注册覆盖，引导密码登录。
- Legacy passwordless identity: only `purpose=register` OTP plus password completes it. The same user ID is retained, old sessions are revoked, and a new session is issued. 历史账号经专用注册完成流补设密，不提供设置页捷径。
- Password login is unchanged: existing active identity and matching password only; failures uniformly `401 invalid_credentials`. OTP login (`purpose=login`) is only a backup for active identities with passwords. Missing/passwordless identities return `409 registration_required` after valid OTP, without creating a user or session. 日常 OTP 不再建裸账号。
- Password change: authenticated caller requests OTP to the bound phone, falling back to bound email. No client-selected destination. Neither bound → `409 identity_required`. Verify a `password_change` challenge bound to this user AND session; consume it and issue a random 32-byte reauth token. Only SHA-256 is stored, with five-minute expiry and one-use consumption. 改密必须先验证已绑身份，手机优先；升权令牌绑定用户和会话，服务端只存哈希。
- Change requires `password,current_password,reauth_token`. Missing required fields → `400 invalid`; invalid/expired/consumed/foreign reauth → `403 reauth_required`; wrong current password or passwordless user → `401 invalid_credentials`. No hash/session changes on denial. Both `/password/change` and legacy `/password/set` enforce this exact contract. 新旧端点均无首次设密绕过。
- Successful change atomically writes the hash, consumes all outstanding user reauth tokens, and revokes every other session. Current session/cookies remain valid. User → caller session → reauth row locks serialize changes, preventing a revoked concurrent caller from changing credentials. 成功后踢其他设备，保留当前会话；事务内重验调用会话。

## API / 接口

Strict JSON; success `{ok:true,code:"ok",message:"ok",data}`; failure `{ok:false,code,message}`. Every mutation requires exact APP_ORIGIN Origin, `x-dwa-csrf: 1` and JSON Content-Type. Cookies only; no bearer/localStorage credentials. 所有写请求沿用 Origin / CSRF 校验。

| Endpoint | Body | Result |
| --- | --- | --- |
| POST /api/auth/otp/request | `{channel:"phone"\|"email",target,purpose:"login"\|"register"}` | 202 `{challenge_id,expires_in,retry_after}` |
| POST /api/auth/register | `{challenge_id,code,password}` | 200 session/me, `has_password=true` |
| POST /api/auth/otp/verify | `{challenge_id,code}` | 200 session only for password-enabled account |
| POST /api/auth/password/login | `{channel,target,password}` | 200 same session/cookies |
| POST /api/auth/reauth/request | `{}` + session | 202 challenge sent to bound phone/email |
| POST /api/auth/reauth/verify | `{challenge_id,code}` + same session | 200 `{reauth_token,expires_in:300}` |
| POST /api/auth/password/change | `{password,current_password,reauth_token}` + same session | 200 me; current session retained |
| POST /api/auth/password/set | identical to `/password/change` | strict compatibility alias, no setup bypass |
| GET /api/auth/me | none | safe user/name/identities/has_password/expiresAt projection |
| POST /api/auth/refresh, /api/auth/logout | `{}` | existing rotation/logout contract |

Phone normalization remains mainland China E.164; email remains trimmed lowercase. Phone/email are separate accounts unless already attached to the same user; no automatic identity linking. 绑定行为未扩展。

## Storage, expiry and abuse controls / 存储、期限与限流

`users.password_hash` remains nullable solely for legacy rows. New registrations always write the hash. Argon2id v19: memory 19456 KiB, passes 2, parallelism 1, random 16-byte salt, 32-byte tag; strict PHC application/DB checks. Node >=24.7 <25, native async Argon2. Password login accepts up to 256 code units and uses dummy Argon2 work for nonexistent/unset/disabled identities. 密码策略及哈希参数不变。

Migration `007_password_signup_reauth` extends OTP purpose/binding CHECKs and creates `password_reauth` with user/session FKs, unique 32-byte token hash, timestamps, and indexes. Only migrator owns DDL; runtime receives SELECT/INSERT/UPDATE, never DELETE or DDL. Owner maintenance removes reauth records expired over 24 hours; session retention cascades associated tokens. 迁移不填充或重置历史密码，不删除业务数据。

OTP: five-minute expiry, six digits, five bad attempts, one-use state and purpose/HMAC binding. Register and password_change have distinct send cooldown/target/IP and verify IP/target scopes from login, with the same limits: target cooldown 60s, target sends 5/hour and 20/day, IP sends 10/min, 30/hour, 100/day; verify IP 30/min, 300/hour, 1000/day, target failures 20/hour. Aggregate email/SMS daily delivery budgets intentionally remain shared. 用途限流隔离，总供应商日预算共享。

Persistent quotas reserve attempts before expensive hashing. Password login: IP 20/min,100/hour,300/day; channel+normalized target 5/min,20/hour,40/day. Password change: user 5/min,20/hour across sessions, successes included. All existing global API quotas remain. `429 rate-limited` carries Retry-After; successful credentials do not bypass quotas. Fixed UTC minute/hour and UTC+8 daily buckets; no permanent account lock.

No password/current password/hash/OTP/Cookie/reauth token enters API errors, audit or evidence. Staging console provider is the deliberate existing delivery exception; OTP may appear only in its development delivery log. 证据仅记录状态及断言，不复制验证码、密码或会话。

## Session equivalence / 会话等价

Both login and registration share issuance. Host-only HttpOnly Secure SameSite=Lax cookies: `__Secure-dwa_access` path `/api`, max 15 minutes; `__Secure-dwa_refresh` path `/api/auth`, max seven-day idle, bounded by 30-day absolute expiry. Loopback HTTP retains development cookie names. New sessions use exact 168/720-hour intervals to avoid DST extending seven/thirty days. Access JWT remains HS256, issuer APP_ORIGIN, audience daily-work-api, subject user ID, sid session ID; protected requests recheck DB session status.

Refresh remains single-use rotation: reuse within five seconds → 409 refresh_conflict; later replay revokes its session. Logout revokes recognized presented sessions and clears cookies at their original paths. 改密不轮换当前 Cookie，但立即吊销其他会话的 access/refresh。

## Scope and references / 范围与参考

No password recovery/reset, WeChat, provider switch, account deletion, location-change notification, leaked-password lookup, WebAuthn/passkeys, forced periodic rotation, ICP or production cutover. 忘记密码仅展示未开放文案，不伪造成功。

[OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) supports current-password checks and reauthentication for sensitive changes. [Node 24 crypto.argon2](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoargon2algorithm-parameters-callback) documents the existing hash API.
