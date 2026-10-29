审阅 Codex 刚完成的「密码认证第二轮修复」（工作区 /workspace/selfhost）。只审不改代码，不要 commit/push/delete，不要扩 scope。

必读：
1. 第一轮复审结论（你要核对是否真的修了）：logs/claude-review-password.log（结论曾是「需修复」）
2. 第二轮修复报告：server/docs/auth-password-fix-r2.md
3. 契约与部署：server/docs/auth-password-contract.md、server/docs/auth-password-acceptance.md、server/docs/auth-password-deployment.md
4. 关键改动：deploy/docker-compose.staging.yml、deploy/docker-compose.edge.yml、deploy/Caddyfile、app/src/auth/LoginPage.tsx、app/src/auth/api.ts、app/src/auth/PasswordSettings.tsx、app/src/dev-preview/auth-api.ts、相关 tests、server/scripts/password-fix-r2-acceptance.py
5. 证据（全脱敏）：logs/password-fix-r2-before.jsonl、after.jsonl、limits.jsonl、credentials.jsonl、acceptance.jsonl、tests.jsonl、final.jsonl、integrity.jsonl、runtime.jsonl、frontend-api.json、deploy.txt

重点核对第一轮阻断/高优先级是否关闭：
A. IP 限流是否不再塌到 Caddy IP（专用 edge 网、信任仅 172.30.240.2/32、伪造 XFF 无效、两源各自 20 次 429）
B. 验收账号已知密码与私有明文/cookie 是否已清（两密码字段 NULL、会话 0、原/临时密码均 401、OTP 仍可用）
C. LoginPage 是否已有手机/邮箱切换，邮箱独有用户能否走 OTP→设密→密码登录（看 frontend-api 证据）
D. 三个既有失败是否只改测试对齐、未改业务逻辑掩盖
E. 契约是否写明无 OTP 重认证/自助找回；超长当前密码 400 vs 错密 401；预览 stub 是否补齐

也再扫一遍安全底线：Argon2id 只存库、会话与 OTP 等价、CSRF、防枚举、改密吊销其他会话、无明文进日志/报告。

可抽样跑：`cd /workspace/selfhost/server && npm test`（期望 167/167）与必要时前端测试；若环境不允许跑全量，明确写「未跑，依据 logs/password-fix-r2-tests.jsonl」。

输出：按严重度（阻断/高/中/低）列仍存在的问题；已关闭的第一轮问题逐条标注「已关闭」并给证据路径。每条残留问题给文件:行号、证据、最小修复提示词。最后一行必须是「结论：可上线」或「结论：需修复」（相对当前 staging + console OTP 目标，不是生产短信/微信）。
