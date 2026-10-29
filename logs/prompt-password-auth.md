对 Jeayon Work（https://jeayon.com）自建认证做一次**密码凭证与会话契约级**补强，与现有 OTP 并存，不要扩大到微信/真短信/ICP。
未经允许不要 git commit / push / delete 远程。

工作区：/workspace/selfhost（app + server）。线上：Lighthouse 43.136.106.96，SSH `ubuntu` + `~/.ssh/jeayon_deploy_ed25519`，部署目录 `/home/ubuntu/jeayon-work/`。

**生材料：** 先读 auth 相关表与迁移、OTP request/verify/me/refresh/logout 实现与 cookie 属性（`__Secure-dwa_access` / `__Secure-dwa_refresh`、Path、CSRF `x-dwa-csrf:1`）、前端 LoginPage / AuthProvider 实际流量；用已有手机号账号做样本。

**目标：**
- 已登录可设置/修改密码（只存 argon2id 或 bcrypt 强哈希，库中无明文）
- 登录页支持 phone|email + password → 与 OTP 相同的 cookie 会话与 CSRF
- 未设密码不可密码登录；防暴力与防枚举（错密文案不泄露用户是否存在）
- 明确改密策略：改密后是否吊销其他 refresh 会话（写进契约并实现）
- OTP 行为不变

**方法：** 先写认证状态机与 API 契约（单独文件）→ 实现哈希/接口/UI → 单测 + curl 差分 → 部署 API+前端到 Lighthouse → 对照同一用户 OTP 与密码两条路径的 `GET /api/auth/me`。

**验收：** DB 无明文密码；密码登录与 OTP 会话等价；错密/锁定期符合契约；OTP 回归通过。测试通过后再报完成。

最终报告：契约摘要、改动文件、部署步骤、用真实手机号账号的验收证据。
