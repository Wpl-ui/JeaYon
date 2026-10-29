对 Jeayon Work（https://jeayon.com）做**品牌定名**小改动：用户可见位置以及网站其他文案里不要出现「佳阳」或「工作台」；产品最终定名为 **JeaYon**（J 与 Y 大写，中间 a/o/n 小写）。不加新功能。不要扩大到微信、真实短信、ICP、密码认证逻辑。未经允许不要 git commit / push，不要删除远程项目或备份。

工作区：/workspace/selfhost。线上：Lighthouse 43.136.106.96，SSH `ubuntu` + `~/.ssh/jeayon_deploy_ed25519`，部署目录 `/home/ubuntu/jeayon-work/`；运行中的是 staging compose + edge Caddy。测试用 `/opt/node24/bin/node`。

**生材料（先读原文，不凭摘要）：**
- `app/index.html` 第 6 行 `<title>佳阳工作台 · Jeayon Work</title>`（浏览器标签当前文案，用户已截图）
- `app/src/config/publicConfig.ts` 的 `appName: 'Jeayon Work'`（顶栏品牌文案来源）
- `app/src/auth/LoginPage.tsx` 的 img alt / h1
- `app/src/components/AppShell.tsx` 里 `{publicConfig.appName}`
- 全仓搜：`佳阳`、`工作台`、`Jeayon Work`（排除 node_modules/dist/.git/logs/backups）

**要改的：**
1. **用户可见品牌统一为 JeaYon。** `publicConfig.appName` → `'JeaYon'`；`index.html` `<title>` → `JeaYon`（不要「佳阳」「工作台」「Jeayon Work」）；LoginPage 的 alt / 可视隐藏 h1 改为 `JeaYon`。任何其他会进浏览器标签、顶栏、登录页、manifest/PWA 名称（若有）的字符串同样改成 `JeaYon`。
2. **清掉全站文案中的「佳阳」「工作台」。** 全仓搜索确认这两个中文字符串在 app/ 用户可见路径与静态 HTML 中为 0。注释、docs、服务端契约标题里的旧英文名 `Jeayon Work` 一并改成 `JeaYon`（保持文件路径/域名 `jeayon.com` / 包名 / 目录名不变，除非某处把旧品牌写进了用户可见响应）。
3. **不要误伤。** 「工作空间」（workspace）不是「工作台」，保留。域名、API 路径、cookie 名、环境变量名、备份目录名一律不动。

**方法：** 读生材料 → 改 → 再跑一次全仓 `佳阳|工作台` 搜索确认 app 用户可见路径为 0 → Node 24 跑前端测试 + typecheck + build → 远端备份将覆盖的前端 dist（mode 700 新备份目录）→ 上传新 dist → **不要重建 API/Postgres**；若 Caddy 只静态挂载 dist，按现有部署方式热更新静态文件（对照 staging compose 里前端怎么挂载）。→ HTTPS 首页与 `/` 的 HTML `<title>` 抽查为 `JeaYon`；登录页仍可打开。

**验收（证据存 `logs/brand-jeayon-*.jsonl`，脱敏）：**
- 前端测试通过；typecheck/build 通过
- 全仓搜索：`app/`（排除 node_modules/dist）内 `佳阳` 与 `工作台` 命中为 0；用户可见字符串为 `JeaYon`
- 线上 `curl -s https://jeayon.com/`（或本机 `--resolve`）HTML 含 `<title>JeaYon</title>`，不含佳阳/工作台
- 上传文件 SHA-256 与本地一致；未重建 api/postgres（或说明为何）

最终报告写到 `server/docs/brand-jeayon.md`：改动文件、部署步骤、证据路径、遗留风险。测试和验收都通过后再报完成，报告用中英双语。
