审阅 Codex 刚做的「密码 + OTP 并存」改动（工作区 /workspace/selfhost）。只审不改代码，不要 commit/push/delete，不要扩 scope。

先读契约与验收：server/docs/auth-password-contract.md、server/docs/auth-password-acceptance.md、server/docs/auth-password-deployment.md；再读 server/src/auth/password.ts、server/src/auth/service.ts、认证路由、server/src/db/migrations/005_user_password.ts、app/src/auth/LoginPage.tsx、app/src/auth/PasswordSettings.tsx、AuthProvider；原始证据 logs/password-curl-*.jsonl。

检查：
1. 哈希只存库（Argon2id 参数、DB CHECK）、无明文或密钥进代码/日志/报告
2. 密码登录与 OTP 是否共用会话签发、cookie Path/HttpOnly/Secure/SameSite、Origin + x-dwa-csrf 校验
3. 防枚举：不存在/未设密/停用/错密是否统一响应，含响应时间差（是否对不存在用户也跑哈希）
4. 限流与锁定：按账号和按 IP 是否都有、能否被绕过、OTP 额度是否独立
5. 改密：是否需旧密码、是否吊销其他 access+refresh、当前会话是否保留
6. 前端：OTP 是否被破坏、错误文案、密码字段 autocomplete
7. 全量测试 161/164：跑 `cd server && npm test`，判断 3 个失败是否为既有问题（任务父进度契约更新后测试未同步？Caddy www？），还是本次引入

输出：按严重度（阻断/高/中/低）列问题，每条给文件:行号、证据、最小修复提示词（可直接交给 Codex）。最后一行写「结论：可上线」或「结论：需修复」。
