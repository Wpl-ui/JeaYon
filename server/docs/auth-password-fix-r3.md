# Password authentication fix R3 / 密码认证第三轮小修复

2026-10-27 UTC. Scope: only low items 1–3 in `logs/claude-review-password-r2.log:65–80`. / 范围仅为 Claude R2 复审“低”级第 1–3 项。

All required tests and cleanup acceptance passed. Effective live configuration stayed identical; no container was rebuilt, recreated or restarted. Production was not started. / 所需测试与 cleanup 验收通过，线上有效配置一致，未构建、重建或重启容器，未启动 production。

## Changes / 修复与文件

| Item / 项目 | Change and files / 修复与文件 |
| --- | --- |
| Credential argv / 凭据命令行 | `server/scripts/password-fix-r2-acceptance.py`: `request()` uses fixed `curl -sS --max-time 25 -i --config -` argv. URL, every header (including Cookie) and JSON body are escaped into one config stream over SSH stdin. No credential temporary files. / 固定 curl 参数，所有请求头与 JSON body 经同一 stdin 配置流传递，不创建凭据临时文件。 |
| Offline regression / 离线回归 | `server/scripts/password-fix-r3-offline-check.py`: intercepts subprocess execution without connecting to SSH or the online service; checks local and parsed remote argv for synthetic Cookie, password and sensitive-header sentinels, and verifies stdin body escaping including quotes, backslashes and newline. Covers body requests and header-only requests. / 不连接线上，检查本地及远端 argv 不含合成凭据，并核对特殊字符转义和有/无 body 两种情况。 |
| Production IP / production 固定地址 | `deploy/docker-compose.yml`: API edge IP is `172.30.240.3`, reserving Caddy `.2` even when API starts first. / 固定 API 为 `.3`，避免 API 先启动抢占 Caddy `.2`。 |
| Explicit origin / 显式同源地址 | `deploy/docker-compose.staging.yml`: requires `${APP_ORIGIN:?Set APP_ORIGIN}`, removing the HTTP-IP default. / 移除 HTTP IP 默认回落，缺失或空值时 Compose 配置失败。 |
| Static coverage / 静态测试 | `server/tests/deployment.test.ts`: checks production and staging+edge API `.3`, Caddy `.2`, trust `172.30.240.2/32`, required APP_ORIGIN and absence of HTTP fallback; runs the offline argv check. / 同时覆盖两套网络约束、显式 APP_ORIGIN 与离线凭据检查。 |
| Deployment guidance / 部署文档 | `server/docs/auth-password-deployment.md`: correct transport description, explicit HTTPS same-origin prerequisite, and R3 backup/config comparison/no-recreation procedure. / 更新传输描述、HTTPS 同源前提与本轮备份、比对和不重建流程。 |

This report is the seventh changed/added deliverable file. No business/authentication source logic was edited. / 本报告为第七个修改或新增的交付文件，未改业务或认证源码逻辑。

## Verification / 本地验证

Runtime: `/opt/node24/bin/node`, **v24.22.1**. Server tests used `PGOPTIONS='-c timezone=UTC'` and the existing isolated test database. / 使用指定 Node 24；server 测试沿用隔离测试库与 UTC 会话时区。

| Check / 检查 | Actual result / 实际结果 | Evidence / 证据 |
| --- | --- | --- |
| Before-fix targeted regression / 修复前定向回归 | 8 tests: 5 pass, 3 fail, reproducing the three requested issues / 三项失败对应本轮三项问题 | `logs/password-fix-r3-regression.jsonl` |
| Full server tests / server 全量 | **170/170**, 0 failed, 0 skipped | `logs/password-fix-r3-server-checks.jsonl` |
| Frontend tests / 前端测试 | **53/53**, 0 failed, 0 skipped | `logs/password-fix-r3-app-checks.jsonl` |
| Both typechecks and builds / 双方 typecheck、build | All exit 0 / 全部退出码 0 | Same two check logs / 同上两份日志 |
| Offline argv check / 离线参数检查 | PASS, two cases / 通过，两种请求 | `logs/password-fix-r3-offline.jsonl` |

Commands used `PATH=/opt/node24/bin:$PATH npm --prefix <server|app> test`, `run typecheck` and `run build`; server tests additionally used the UTC setting above. The offline command is `python3 server/scripts/password-fix-r3-offline-check.py`. Logs record actual exit codes, test counts and captured-output SHA-256. Neither package configures a lint script, so no lint command was run. / 使用各包 npm 脚本运行测试、类型检查与构建；证据记录实际退出码、测试计数和输出摘要哈希。两包均未定义 lint 脚本，未运行 lint。

One direct targeted invocation from the repository root failed to resolve server's `tsx`; subsequent package npm runs, including the final full server rerun after strengthening the offline assertions, passed. / 曾从仓库根目录直接启动定向检查，因无法解析 server 的 `tsx` 而失败；随后通过各包 npm 脚本运行，且加强离线断言后的最终 server 全量复跑通过。

## Deployment and acceptance / 部署与验收

1. Read the original review, request helper, deployment documentation, both Compose files, static tests and R2 `.2` collision record. Checked remote `deploy/.env` only for APP_ORIGIN presence and equality to `https://jeayon.com`; both true. No other environment values were printed. / 先读指定原文；线上 `.env` 仅记录 APP_ORIGIN 存在性与目标 HTTPS 地址相等性，均为真，未输出其他环境变量值。
2. Captured effective API configuration with `docker compose -f docker-compose.staging.yml config --format json` and Caddy configuration with the edge file. Retained only APP_ORIGIN, TRUST_PROXY_CIDR, networks/IP definitions and ports; full configuration output was not logged. / 两份 Compose 分别解析，只保留指定字段，不记录完整配置输出。
3. Before overwriting, backed up exactly the three remote targets to `/home/ubuntu/jeayon-work/password-fix-r3-backup-20261027T054818308243Z` (directory **0700**, each file **0600**); verified backup bytes against originals. Existing backups were untouched. / 覆盖前备份三文件并核对原始字节，未改历史备份。
4. Uploaded only `deploy/docker-compose.staging.yml`, `deploy/docker-compose.yml`, and `server/docs/auth-password-deployment.md`. All three remote SHA-256 hashes match local files. The acceptance helper runs locally over SSH; uploading it was unnecessary. / 线上仅上传上述三文件，哈希全部一致；修好的验收脚本在本地通过 SSH 执行。
5. Effective selected fields were identical before/after. API `.3`, Caddy `.2`, trust `/32`, HTTPS APP_ORIGIN and ports were unchanged. Container IDs and start times matched; **no recreation/restart**, no production switch. / 前后有效配置完全一致，容器 ID 与启动时间未变，未重建或重启，未切换 production。
6. HTTPS `/api/health/ready` returned **200** with TLS verification enabled; API, Caddy and Postgres were **healthy**; API had no host port bindings. / HTTPS ready 为 200，保留 TLS 校验，三容器 healthy，API 无公网映射端口。
7. Ran the fixed helper **once in `cleanup` mode**, with no `acceptance` or `limits` run. Unset-password login returned `401 invalid_credentials`; existing staging console OTP login returned 200 with `has_password=false`. The final reset verified `password_hash IS NULL`, `password_updated_at IS NULL`, and **0 active sessions** for the acceptance account. No private files existed or were deleted. / 仅执行一次 cleanup；未设置密码登录返回统一 401，现有 console OTP 返回 200；最终两密码字段为 NULL、有效会话 0，无私密文件存在或被删除。
8. Rechecked HTTPS health and unchanged container identity/start times after cleanup. / cleanup 后再次检查 HTTPS 健康与容器未重建状态。

Deployment, backup permissions, filtered configuration, upload hashes and runtime evidence: `logs/password-fix-r3-deploy.jsonl`. Cleanup evidence: `logs/password-fix-r3-cleanup.jsonl`. Final deliverable hashes and checks: `logs/password-fix-r3-final.jsonl`. Evidence contains no Cookie/password/OTP/key values. / 部署、备份权限、配置比对、上传哈希与健康证据及清理证据均在上述 JSONL；不含 Cookie、密码、OTP 或密钥值。

## Remaining risks and boundaries / 遗留风险与边界

- Review item 4, old hashes in historical backups, remains untouched. Never restore acceptance credentials inadvertently. / 第 4 项历史备份旧 hash 按要求未动，恢复时仍须防止重新引入验收凭据。
- Required-variable syntax rejects missing/empty APP_ORIGIN but does not enforce HTTPS or same-origin semantics; future deployments must retain the explicit precheck. / 必填替换只约束非空，后续部署仍须执行 HTTPS 同源检查。
- Production IP is statically covered and uploaded, but production runtime was not exercised. / production 固定 IP 已测试并上传，本轮未验证其运行态。
- Live checks used existing staging console OTP; no real SMS/email, WeChat, ICP, password recovery, browser interaction, or full quota-limit acceptance was performed. / 线上沿用 staging console OTP，未扩展真实短信/邮件、微信、ICP、找回密码、浏览器交互或整套额度验收。
- Credentials remain in process memory/stdin during requests; the fix removes their exposure through argv and evidence, not privileged process inspection. / 请求期间凭据仍在进程内存与 stdin 中；本轮消除 argv 和证据泄露，不防御特权进程检查。
- No git commit/push, remote-project deletion, backup deletion or historical-backup cleanup was performed. / 未提交或推送，未删除远程项目或任何备份。
