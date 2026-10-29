# 方案：注册设密 + 改密升权 / Password at signup + step-up change

状态 / Status: **待确认 / awaiting approval**（本文件仅方案，未改代码）

## 目标 / Goals

1. **首次设密并入「注册」**：手机/邮箱验证码通过后，同一流程必须设置密码，账号才算注册完成。不再提供「登录后再在设置页首次设密」。
2. **之后改密必须升权**：设置页不能只靠当前密码直接改；需手机（优先）或已绑邮箱 OTP → 短时 reauth → 再提交新密码。
3. 不做：微信、真实短信供应商切换、注销账号、ICP、多会话列表 UI（除非改密踢会话沿用现有）。

## 现状 / Current

- 验证码 `purpose=login` 校验成功即建用户 + 会话；`has_password` 可为 false。
- `POST /api/auth/password/set`：已登录；首次设密无需 `current_password`；改密只需 `current_password`。
- 登录页文案：「首次使用请用验证码登录，登录后可在账号密码区域设置密码。」

## 产品流 / Product flows

### A. 注册（首次身份）

1. 用户选手机或邮箱 → 发验证码（仍可复用 request OTP；建议新增 `purpose=register`，或 login 校验后若用户无密码则进入「完成注册」态）。
2. 输入验证码 + **新密码 + 确认密码**（8–128，沿用现有策略）。
3. 服务端一次事务：校验 OTP → 创建/绑定 identity → 写入 `password_hash` → 发会话 Cookie。
4. 若该身份已存在且**已有密码**：走「登录」而非注册（提示改用密码登录或「忘记密码」）；不得用注册接口覆盖密码。
5. 若该身份已存在但**无密码**（历史账号）：允许走「完成设密」补齐，完成后与注册同等；补齐窗口可限一次/短时。

### B. 日常登录

- 密码登录：不变（phone|email + password）。
- 验证码登录：仅允许**已注册且已有密码**的账号（二次验证/备用登录）；**不再**用纯 OTP 创建无密码新用户。

### C. 改密（设置 → 安全）

1. 已登录用户点「修改密码」。
2. 向**已绑定手机**发 OTP（无手机则已绑邮箱；都无则拒绝改密，提示先绑定）。
3. OTP 通过 → 签发短时 **reauth**（建议 5–10 分钟、一次性、绑定 `user_id` + `session_id`，存服务端哈希）。
4. 提交：`reauth_token` + `new_password`（可选再要 `current_password` 作第二因子；**推荐要**，防仅占有手机的攻击）。
5. 成功：更新哈希、作废 reauth、撤销其他会话、保留当前会话（与现行为一致）。
6. 设置页**移除**「无密码时的首次设密」UI（注册已保证有密码；历史无密码用户只走「完成设密」补洞，补完后该 UI 消失）。

### D. 忘记密码（本轮可列二期，建议契约预留）

- 未登录：身份 + OTP → 重置密码（与改密升权不同端点）。本轮若砍 scope，文档标明「未做」，登录页可只放入口文案占位。

## API 草案 / API sketch

| 能力 | 建议 |
| --- | --- |
| 注册完成 | `POST /api/auth/register`：`channel,target,challenge_id,code,password` → 会话；或扩展现有 `verify` 在 body 带 `password` 且仅当新用户/无密码 |
| OTP purpose | 新增 `register` / `password_change` /（二期 `password_reset`）；限流与 login 隔离 |
| 改密升权 | `POST /api/auth/reauth/request` + `POST /api/auth/reauth/verify`（或合并 verify 返回 token） |
| 改密提交 | `POST /api/auth/password/change`：`reauth_token,password,current_password?`；**废弃或收紧**旧 `password/set` 的「无 current 即可首次设」路径 |
| me | 仍返回 `has_password`；新用户恒为 true |

## 数据 / Data

- `users.password_hash`：注册后非空（历史行迁移策略：强制下次登录前完成设密，或一次性引导）。
- 新表或复用挑战表存 `reauth`：`id,user_id,session_id,token_hmac,expires_at,consumed_at,purpose`。
- `otp_codes.purpose` 扩展枚举；migration 若需改 check 约束则写明。

## 前端 / Frontend

- `LoginPage`：验证码模式改为「注册 / 登录」清晰分流，或单流：未注册填密码完成注册；已注册验证码仅登录。
- 去掉「登录后设置密码」提示；密码 Tab 文案改为忘记密码（二期）或「未设密请用验证码完成注册」。
- `PasswordSettings`：仅「修改密码」多步（发码 → 验码 → 新密码）；无首次设密块。
- `/settings` 安全区沿用；组织页不回退密码块。

## 安全要点 / Security

- 注册与改密 OTP 分 purpose、分限流桶。
- reauth 一次性、短 TTL、绑会话；改密成功后轮换会话或至少踢其他设备。
- 统一错误文案，避免枚举「是否已注册」。
- staging 仍可用 console OTP；不把码写入证据 JSONL。

## 明确不做 / Out of scope

微信登录、真实短信供应商、邮箱魔法链、通行密钥/WebAuthn、注销、ICP、桌面打包、commit/push。

## 更深一层故意不做 / Deeper cut left out

顶级账号体系还会做：风险评分、异地改密通知、密码泄露库比对、强制定期轮换、硬件密钥。本轮只要注册设密闭环 + 改密 OTP 升权。

## 验收轮廓 / Acceptance sketch

- 新手机号：无密码无法只靠 OTP 建「裸账号」；带密码注册后 `has_password=true`，密码登录成功。
- 已有密码账号：注册接口不能覆盖密码。
- 改密：无 reauth 拒绝；过期/重放拒绝；成功后其他会话 401。
- 设置页无「首次设密」；全量测试 + staging 部署证据。

## 实施顺序建议 / Rollout

1. migration + OTP purpose + register 契约与测试  
2. 收紧 verify/login：禁止无密码新用户（或仅 register 可建）  
3. reauth + password/change；废弃宽松 set  
4. 前端 Login + PasswordSettings  
5. 历史无密码用户补齐策略与文案  
6. Claude 审阅 → staging 热更（有 migration 则迁库）
