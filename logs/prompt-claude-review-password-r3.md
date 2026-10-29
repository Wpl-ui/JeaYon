审阅 Codex 刚完成的「密码认证第三轮小修复」（工作区 /workspace/selfhost）。只审不改代码，不要 commit/push/delete，不要扩 scope。
必读：logs/claude-review-password-r2.log（低级 1–3 项）、logs/prompt-password-fix-r3.md（任务要求）、server/docs/auth-password-fix-r3.md（报告）、logs/codex-password-fix-r3.log 末尾、logs/password-fix-r3-* 证据、以及改动文件（server/scripts/password-fix-r2-acceptance.py、deploy/docker-compose.yml、deploy/docker-compose.staging.yml、server/tests/deployment.test.ts、server/docs/auth-password-deployment.md 和任何新增检查脚本/测试）。
核对：1) 本地与远端 argv 是否真的不再含 Cookie/密码，临时文件是否 0600 且 finally 删除；2) prod/staging Caddy=.2、API=.3、TRUST_PROXY_CIDR 一致且有测试；3) staging APP_ORIGIN 必须显式设置、线上 .env 为 https://jeayon.com、有效配置前后一致、是否避免了重建/停机；4) 证据是否脱敏、无密钥值；5) 是否越界改了业务/认证源码。
可跑 `cd server && npm test`（Node 24：/opt/node24/bin/node）与前端测试。
输出：已关闭项逐条给证据；残留问题按阻断/高/中/低给文件:行号、证据、最小修复提示词。最后一行「结论：可上线」或「结论：需修复」（针对 staging + console OTP）。
