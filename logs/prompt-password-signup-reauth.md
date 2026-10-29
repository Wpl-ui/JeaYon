对 JeaYon（https://jeayon.com）做**注册时设密 + 改密 OTP 升权**。未经允许不要 git commit / push，不要删除远程项目或备份。

工作区：/workspace/selfhost。线上：Lighthouse 43.136.106.96，SSH `ubuntu` + `~/.ssh/jeayon_deploy_ed25519`，`/home/ubuntu/jeayon-work/`；staging + edge Caddy。测试用 `/opt/node24/bin/node`。

**更深一层（本轮故意不做）：** 异地改密通知、密码泄露库比对、通行密钥/WebAuthn、强制定期轮换。本轮只要：注册闭环必须设密；之后改密必须 OTP 升权。

**生材料（先读原文）：** `server/src/auth/service.ts`（OTP login / passwordLogin / setPassword）、`server/src/auth/password.js`、OTP/crypto、migrations 里 `otp_codes`/`users`；`app/src/auth/LoginPage.tsx`、`PasswordSettings.tsx`、`api.ts`；`server/docs/auth-password-contract.md` 与 acceptance；`logs/proposal-password-at-signup-reauth.md`（已批准产品方案）。品牌：JeaYon；侧栏「导航 / 看板、待办、计划、日记、组织」勿回退。

**产品规则：**
1. **注册 = 验证码 + 设密一次完成。** 新手机/邮箱不能只靠 OTP 建成无密码账号。验码成功时必须带符合策略的新密码（8–128，沿用现有 assertPasswordPolicy）；同一事务：消费 OTP → 建用户/绑 identity → 写 `password_hash` → 发会话。
2. **身份已存在且已有密码：** 注册路径不得覆盖密码；返回可理解错误，引导密码登录。
3. **历史无密码账号：** 允许一次「完成设密」（已登录或专用完成流均可，但必须先验身份 OTP）；补齐后 `has_password=true`。设置页不再提供「无升权的首次设密」。
4. **日常登录：** 密码登录保持；验证码登录仅允许**已有密码**的账号（备用登录）。禁止再用纯 OTP 创建裸账号。
5. **改密：** 设置页「修改密码」= 向已绑**手机**发 OTP（无手机则已绑邮箱；都没有则拒绝并提示先绑定）→ 校验 OTP → 签发短时一次性 **reauth**（建议 5–10 分钟，绑定 user_id+session_id，服务端存哈希）→ 提交 `reauth_token` + `password` + **`current_password`（必填）** → 更新哈希、作废 reauth、撤销其他会话、保留当前会话。无有效 reauth 不得改密。
6. **本轮不做：** 忘记密码重置（可在登录页留文案/禁用入口，勿伪造成功）、微信、真实短信供应商切换、注销、ICP、commit/push。

**实现提示（可调整，但契约要对）：**
- OTP `purpose` 扩展：至少 `register`（或等价完成注册）、`password_change`；与 `login` 限流桶隔离。需要则写 migration。
- 新端点或严格扩展现有：`register`（或 verify+password）、`reauth/request`、`reauth/verify`、`password/change`；**收紧或废弃**旧 `POST /api/auth/password/set` 的「已登录且无 current_password 即可首次设密」路径，避免绕过。
- 前端：LoginPage 去掉「登录后设置密码」文案，改为注册完成设密 UI；PasswordSettings 改为多步改密（发码→验码→新密码+当前密码），无宽松首次设密块。
- staging console OTP 可保留；证据 JSONL 脱敏（勿写 OTP/密码/Cookie）。

**测试与部署：**
- 后端：注册必密、禁止无密码建号、已有密码不可覆盖、改密无 reauth/过期/重放拒绝、成功踢其他会话、密码登录回归。
- 前端：注册流与改密多步；设置页无首次设密捷径。
- 全量 server + app 测试、双方 typecheck/build。
- 远端备份；有 migration 才动 Postgres，否则按需重建 api + 热更前端；健康检查；`--resolve`/隧道验证。不切换 production。

**交付：** 双语报告 `server/docs/password-signup-reauth.md`；证据 `logs/password-signup-reauth-*.jsonl`。全部通过后再报完成。
