对 Jeayon Work（https://jeayon.com）密码认证做第二轮**修复**，只修 Claude 复审（logs/claude-review-password.log）列出的问题，不加新功能。不要扩大到微信、真实短信、ICP、找回密码。未经允许不要 git commit / push，也不要删除远程项目。

工作区：/workspace/selfhost。线上：Lighthouse 43.136.106.96，SSH 用户 `ubuntu` + `~/.ssh/jeayon_deploy_ed25519`，部署目录 `/home/ubuntu/jeayon-work/`。实际运行的是 staging compose 加上 edge Caddy（容器 `jeayon-work-staging-api-1`、`jeayon-work-staging-caddy-1`）。跑测试请用 `/opt/node24/bin/node`，默认 Node 20 没有 argon2。

**生材料（先读，不要凭摘要动手）：** 复审原文 `logs/claude-review-password.log`；`deploy/docker-compose.staging.yml`、`deploy/docker-compose.edge.yml`、`deploy/docker-compose.yml` 里已有的 `TRUST_PROXY_CIDR` 写法；`server/src/app.ts` 中 trustProxy 的逻辑；线上 `docker inspect` 看到的网络和 IP；以及线上 API 实际记录到的 `req.ip`。

**要修的：**
1. **[高] 按 IP 限流不生效。** 给 edge Caddy 一个固定的内部地址（专用网络或固定 IP），api 只通过 `TRUST_PROXY_CIDR` 信任这一个地址；Caddy 透传 `X-Forwarded-For`；8787 端口不对公网开放。改动前后各取一次线上证据，证明 API 看到的是真实客户端 IP，而不是 Caddy 容器 IP。补测试：在可信代理配置下，两个不同的 `X-Forwarded-For` 应该落到两个独立的 `password_login_ip` 桶；从不可信来源伪造的 `X-Forwarded-For` 不能生效。
2. **[高] 验收账号还留着已知密码。** 对验收用户 `649dce00-3867-4d28-a30d-c05001ad65eb`（+8613****8001，测试号）把 `password_hash` 和 `password_updated_at` 置为 NULL，并吊销它的全部会话。确认之后密码登录统一返回 401 `invalid_credentials`，OTP 仍然能登录。然后删除 `server/acceptance-private/` 下保存明文密码的状态文件和 cookie jar（用户已同意删除）。以后验收每次生成临时密码，结束前清掉，并把这一步写进 `auth-password-deployment.md` 的发布流程。
3. **[中] 邮箱身份在页面上走不通。** `LoginPage` 的验证码登录加上手机号 / 邮箱切换，邮箱走现有的 `requestEmailCode` 和 `normalizeEmail`，challenge 和 verify 复用现有流程。补一个前端 API 测试：只有邮箱的用户用验证码登录，再设置密码。
4. **[中] 契约写清楚。** 在 `auth-password-contract.md` 里写明：目前没有用验证码重新认证或自助找回密码；如果密码是由不可信会话设置的，需要运维把 `password_hash` 置空并吊销该用户全部会话。同时把「并发锁导致的残余时序差」标为已接受的风险。
5. **[低] 预览模式。** 给 `app/src/dev-preview/auth-api.ts` 补上 `passwordLogin` 和 `setAccountPassword` 的 stub，保证 `?visual-preview` 能正常加载。
6. **3 个既有失败测试对齐（不要改无关业务代码去掩盖）：**
   - `business.test.ts:215`：按现有 clamp 行为改断言（期望 201，progress 为 0）。
   - `business.test.ts:323`：完成子任务改用 `PATCH /api/tasks/:id/complete`。
   - `deployment.test.ts:25`：线上目前没有 www 的 DNS 记录，把测试改成和当前 Caddyfile 一致，并在注释里说明原因。

**方法：** 先读生材料并记下改动前的线上证据 → 改代码和配置 → 用 Node 24 跑全量 server 测试和前端测试 → 部署前先备份 → 部署 → 线上验收。

**验收（证据存进 `logs/password-fix-r2-*.jsonl`，脱敏）：**
- 全量 server 测试全部通过（目标 164/164 或更多），前端测试、typecheck、build 都通过
- 线上能看到真实客户端 IP；IP 桶和账号桶的锁定各自独立生效；不可信来源伪造的 `X-Forwarded-For` 无效
- 验收号的密码哈希已清空，密码登录返回 401，OTP 能登录；工作区里搜不到任何明文密码文件
- 记录以下事件：CSRF 缺失被拒、旧密码错误被拒、账号不存在或未设密码统一返回 401
- 邮箱验证码登录接口在前端 API 测试中跑通

最终报告：每项问题怎么修的、改动文件、部署步骤、证据文件路径、遗留风险。测试和验收都通过后再报完成。
