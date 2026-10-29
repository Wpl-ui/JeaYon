对 Jeayon Work 密码认证做第三轮**小修复**，只修 Claude R2 复审（logs/claude-review-password-r2.log）"低"级第 1–3 项，不加新功能、不改业务/认证源码逻辑。不要扩大到微信、真实短信、ICP、找回密码。未经允许不要 git commit / push，不要删除远程项目或备份。第 4 项（历史备份旧 hash）本轮不动。

工作区：/workspace/selfhost。线上：Lighthouse 43.136.106.96，SSH `ubuntu` + `~/.ssh/jeayon_deploy_ed25519`，部署目录 `/home/ubuntu/jeayon-work/`；运行中的是 staging compose + edge Caddy（`jeayon-work-staging-api-1` 固定 172.30.240.3、`jeayon-work-staging-caddy-1` 固定 .2）。测试用 `/opt/node24/bin/node`。

**生材料（先读原文，不凭摘要）：** `logs/claude-review-password-r2.log` 第 65–80 行；`server/scripts/password-fix-r2-acceptance.py` 的 `request()`；`server/docs/auth-password-deployment.md` 第 33 行附近；`deploy/docker-compose.yml`（production）；`deploy/docker-compose.staging.yml:32`；`server/tests/deployment.test.ts`；`logs/password-fix-r2-deploy.txt` 里 `.2` 地址冲突记录；线上 `/home/ubuntu/jeayon-work/deploy/.env` **只看是否存在 APP_ORIGIN 及其值是否为 https://jeayon.com，不要打印其他任何键的值**。

**要修的：**
1. **验收脚本 Cookie 不进 argv。** `request()` 现在把 `Cookie:` 拼进 curl 参数再经 SSH 执行，运行期 `ps`/SSH 审计可见会话令牌。改为请求头（Cookie、以及其他敏感头）通过 stdin 传给远端 curl（例如 `curl --config -` 或 `-H @-` 方案；body 仍走 stdin 时要设计好两者共存，例如远端用临时 0600 文件放在 tmpfs 并 `finally` 删除），保证本地与远端 argv 都不含 Cookie/密码。文档第 33 行改成与实现一致的描述。加一个可离线运行的检查（不连线上）：构造请求时断言生成的命令行参数里不含 cookie 值和密码。
2. **production Compose 固定 API IP。** `deploy/docker-compose.yml` 的 api 在 `edge` 网加 `ipv4_address: 172.30.240.3`（与 staging 一致），避免 API 先启动抢占 Caddy 的 `.2`。在 `deployment.test.ts` 加静态断言：production 与 staging 两个文件里 Caddy=.2、API=.3、`TRUST_PROXY_CIDR=172.30.240.2/32`。本轮**不切换 production**。
3. **staging `APP_ORIGIN` 不再静默回落到 http IP。** `docker-compose.staging.yml:32` 改为 `${APP_ORIGIN:?Set APP_ORIGIN}`（必须显式设置）。先确认线上 `.env` 已有 `APP_ORIGIN=https://jeayon.com`；若没有，**停下来报告，不要部署**。在 `auth-password-deployment.md` 加部署前检查（APP_ORIGIN 必须为 https 同源）。加静态测试断言 staging 没有 http 默认值。

**方法：** 读生材料 → 改 → Node 24 跑全量 server 测试 + 前端测试 + 双方 typecheck/build → 远端先备份将覆盖的 3 个文件（compose/staging、compose/prod、deployment.md）到 mode 700 的新备份目录 → 上传 → 用 `docker compose -f docker-compose.staging.yml config` 对比上传前后 api/caddy 的**有效配置**（脱敏，只比对 APP_ORIGIN、网络/IP、TRUST_PROXY_CIDR、ports）。若有效配置不变，**不要重建容器**，避免再次停机；若意外变化，停下来报告。→ 健康检查：HTTPS ready、三个容器 healthy、API 无公网端口。→ 用修好的脚本跑一次 `cleanup` 模式（不跑整套 limits，避免消耗线上额度），确认验收账号两密码字段仍 NULL、会话 0。

**验收（证据存 `logs/password-fix-r3-*.jsonl`，脱敏，不含 Cookie/密码/OTP/密钥值）：**
- server 全量测试全过（≥167），前端 53/53 或更多，typecheck/build 全过
- 离线检查证明 argv 不含 Cookie/密码
- 静态测试覆盖 prod/staging 固定 IP 与 APP_ORIGIN 无 http 默认
- 线上 `.env` 有 https APP_ORIGIN（只记录 present + 是否等于 https://jeayon.com）；有效配置前后一致；未重建容器（或说明为何重建）
- 健康检查通过；验收账号 NULL/0 sessions
- 上传文件 SHA-256 与本地一致

最终报告写到 `server/docs/auth-password-fix-r3.md`：每项怎么修、改动文件、部署步骤、证据路径、遗留风险。测试和验收都通过后再报完成，报告用中英双语。
