# JeaYon 品牌定名报告 / Branding report

验收日期 / Verified: 2026-10-27 UTC。产品显示名统一为 **JeaYon**，仅修改品牌文案，已热更新线上前端。
The displayed product name is **JeaYon**. Branding-only edits have been deployed to the live static frontend.

## 改动文件 / Changed files

| 文件 / File | 本次改动 / Change |
| --- | --- |
| `app/index.html` | 正式页面标题设为 `JeaYon` / Production title set to `JeaYon` |
| `app/preview.html` | 开发预览标题设为 `JeaYon` / Development preview title set to `JeaYon` |
| `app/src/config/publicConfig.ts` | `appName` 及品牌注释 / `appName` and branding comment |
| `app/src/auth/LoginPage.tsx` | 图片 alt 与隐藏 h1 / Image alt and visually hidden h1 |
| `app/src/lib/cloud.ts` | 仅品牌注释 / Branding comment only |
| `server/src/tasks/hierarchy-contract.ts` | 仅契约标题注释 / Contract heading comment only |
| `server/docs/auth-password-contract.md` | 仅文档标题 / Document heading only |
| `server/docs/brand-jeayon.md` | 本报告 / This report |

`AppShell` 已读取 `publicConfig.appName`，无需修改；“工作空间”保留。未发现 manifest/PWA 名称配置。已有未提交改动均保留，本次源码差异已对照任务前快照记录。
`AppShell` already reads `publicConfig.appName`; “工作空间” is preserved. No manifest/PWA naming configuration was found. Existing uncommitted work was preserved, with task-only source diffs recorded against snapshots.

域名、包名、目录、API 路径、cookie、环境变量均未改动。微信、短信、ICP、密码认证及业务逻辑未改动。未执行 git commit/push，未删除远程项目、备份或旧静态资源。
Domains, package names, directories, API paths, cookies, environment variables, WeChat, SMS, ICP, authentication and business logic were unchanged. No git commit/push or deletion of remote projects, backups or old static assets was performed.

## 验证结果 / Verification results

- Node **v24.22.1**：通过 `/opt/node24/bin/node` 执行 npm；前端测试 **53/53**，typecheck 与 build 均退出 0。项目未配置独立 lint 脚本，未声称执行 lint。
  Node **v24.22.1** via `/opt/node24/bin/node`: **53/53** frontend tests passed; typecheck and build exited 0. No standalone lint script is configured or claimed as run.
- 全仓搜索包含被 Git 忽略的源码，排除依赖、dist、Git 元数据、日志和备份；指定旧品牌字符串命中 **0**。`app/` 源码与新 dist 分别检查，均命中 **0**。
  Repository searches included ignored source files and excluded dependencies, dist, Git metadata, logs and backups. Legacy brand matches were **0**, including separate checks of `app/` source and the new dist.
- 正式标题、预览标题、配置、登录页 alt/h1 均为 `JeaYon`。实际 `LoginPage` 与 `AuthProvider` 的 Node/Vite SSR 渲染通过，两个登录方式标签仍存在；未模拟后端、未提交认证请求。
  Production/preview titles, config and login alt/h1 use `JeaYon`. Actual `LoginPage`/`AuthProvider` rendering passed through Node/Vite SSR, with both login tabs present; no backend mocks or authentication submissions were used.
- 新 JS 与线上原活动 JS 对比，仅三处品牌字符串替换；CSS、图片及其他共同文件与任务前线上版本一致。
  The new JavaScript equals the previously active live bundle after exactly three brand replacements. CSS, images and other shared files match the previous deployment.
- 上传包 SHA-256 已核对；**11/11** 个文件的本地、上传解包副本、线上 dist 及 HTTPS 响应哈希一致，完整清单见 JSONL。
  The archive SHA-256 was verified. All **11/11** files match across local build, uploaded extraction, live dist and HTTPS responses; full hashes are in the JSONL evidence.
- 服务器上通过公网 DNS 及 `--resolve jeayon.com:443:127.0.0.1` 请求 `https://jeayon.com/`，正常验证证书，均为 **200**，HTML 包含 `<title>JeaYon</title>`、不含旧品牌，并与本地首页逐字节一致。首页 SHA-256：`0c4bd5128cafd69b61fda7254a51cf4817ad7cbeb39b6e789cbd8c69b6274aec`。
  Server-side HTTPS requests using public DNS and loopback resolution both returned **200**, with certificate verification enabled, the correct title, no legacy brand text and byte-for-byte equality with the local homepage. Its SHA-256 is shown above.
- JS、CSS、图标及首页共 11 个 HTTPS 文件均返回 200；匿名 `GET /api/auth/me` 仍为 **401 / unauthenticated**。这是只读探测，未登录、发码或更改密码。
  All 11 HTTPS files returned 200. Anonymous `GET /api/auth/me` returned the expected **401 / unauthenticated**. This was read-only; no sign-in, code sending or password change occurred.

## 部署步骤 / Deployment steps

1. 核对服务器 `/home/ubuntu/jeayon-work/deploy/docker-compose.edge.yml` 与 Caddyfile，实际容器将 `app/dist` 只读挂载至 `/srv/app`；staging API/Postgres 独立运行。
   Confirmed the remote edge compose, Caddyfile and actual read-only `app/dist` → `/srv/app` bind mount, alongside the existing staging API/Postgres.
2. 在构建及源码检查通过后备份原 dist。新备份目录为 `/home/ubuntu/jeayon-work/backups/brand-jeayon-20261027T064232Z`，权限 **700**；`dist/` 内 **14** 个原文件逐一核对 SHA-256，与原目录一致。原先无 `backups/` 父目录，首次创建失败后建立父目录再成功备份，失败时未修改线上 dist。
   After validation, backed up the original 14 files with matching hashes in the mode-700 directory above. The initial attempt found no parent backup directory; creating it resolved the failure before any live-file changes.
3. SCP/SFTP 首次上传超时；改用 SSH 标准输入上传 `frontend-dist.tar.gz`，校验压缩包及解包后的全部文件。两次传输都在启用新文件前进行。
   The initial SCP/SFTP upload timed out. SSH stdin transfer succeeded; archive and extracted-file hashes were verified before activation.
4. 保留现有 dist 目录及挂载 inode，逐文件原子替换，`index.html` 最后更新。保留四个历史哈希资源，不清空目录。无需 compose build/up、容器重启或 Caddy reload。
   Atomically replaced files within the existing bind-mounted directory, replacing `index.html` last and retaining four historical assets. No compose build/up, container restart or Caddy reload was needed.
5. 核对 HTTPS、静态文件哈希及容器状态。API、Postgres、Caddy 的容器 ID、镜像、启动时间、重启次数均与部署前一致，三者仍健康；edge compose 和 Caddyfile 哈希未变。
   Verified HTTPS, served-file hashes and container state. API, Postgres and Caddy retained their IDs, images, start times and restart counts, remained healthy, and their edge configuration hashes were unchanged.

仅 dist 上传上线；服务端文档和注释更名保留在工作区，没有为注释改动重建 API。
Only dist was deployed. Server documentation/comment renames remain in the workspace; no API rebuild was performed for comments.

## 证据及遗留限制 / Evidence and remaining limits

- 主证据 / Main evidence: `logs/brand-jeayon-20261027.jsonl`。记录命令结果、源码差异、测试输出、备份与文件哈希、HTTPS 和容器前后状态；未记录密钥、口令、cookie 或 token 值。
  Contains command results, task-only diffs, tests, backup/file hashes, HTTPS checks and container states; no credential, cookie or token values were recorded.
- 任务前源码快照 / Original source snapshots: `logs/brand-jeayon-20261027-before/`（目录权限 / directory mode 700）。构建传输包 / Build archive: `logs/brand-jeayon-20261027-dist.tar.gz`。
- 当前工作环境的公网及指定 IP HTTPS 请求均出现 curl 35 / TLS EOF；服务器端公网 DNS 与本机解析的 HTTPS 检查成功。工作环境外部访问失败原因未定位，也未修改网络或 TLS 配置。
  HTTPS from the workspace failed with curl 35 / TLS EOF, including the resolved origin. Server-side public-DNS and loopback HTTPS checks passed. The workspace connection failure remains unexplained; network/TLS settings were not changed.
- CUA 没有可用浏览器，未进行浏览器视觉验收或真实认证回归；已有 HTTP、全量资源、登录组件渲染及单元测试证据。补充渲染脚本首次错误地通过 SSR 加载 CommonJS React，修正测试脚本导入方式后通过，应用代码未为此调整。
  No CUA browser was available, so browser visual verification and real sign-in regression were not performed. HTTP/assets, login-component rendering and unit checks passed. The supplemental render harness initially loaded CommonJS React incorrectly through SSR; standard Node imports fixed the harness without application changes.
- 已打开的旧页面可能继续显示缓存的旧品牌，刷新后加载新入口。历史资源及备份按要求保留；本次没有删除它们。
  Already-open pages may retain cached branding until refreshed. Historical assets and backups were preserved as requested.


## 导航文案补丁 / Navigation label patch — 2026-10-27 UTC

已上线，仅修改六个前端源码文件的 12 处显示文案：`AppShell.tsx` 的 sidebar-section「工作空间」→「导航」，五个 NAV_ITEMS 标签为「看板 / 待办 / 计划 / 日记 / 组织」；对应五页的 `h1.page-title` 同步更新，包括看板页两个状态分支。桌面与移动端共用 NAV_ITEMS，没有独立重复标签。
Deployed 12 display-text edits across six frontend source files: the sidebar section now reads “导航”, and navigation labels and the five page headings use “看板 / 待办 / 计划 / 日记 / 组织”, including both dashboard heading branches. Desktop and mobile share NAV_ITEMS.

路由 path、图标、认证及业务逻辑均未改变；正文中的「任务」「团队」「日报」、团队切换标签及「加入或创建团队」标题保留。未执行 git commit/push，未重建或重启 API、Postgres、Caddy。
Route paths, icons, authentication and business logic are unchanged. Business wording, the team selector label and the join/create-team heading remain intact. No git commit/push, API/Postgres rebuild or container restart was performed.

- 验证 / Validation：使用 `/opt/node24/bin/node` **v24.22.1** 运行前端测试，**53/53** 通过；`npm run build`（含 `tsc --noEmit`）退出 **0**。项目无独立 lint 脚本，未运行或声称运行 lint。
  Frontend tests passed **53/53** using Node v24.22.1 at the requested path. Build, including TypeScript checking, exited **0**. No standalone lint script is configured or claimed as run.
- 远端备份 / Remote backup：`/home/ubuntu/jeayon-work/backups/brand-nav-20261027T064950Z/dist`，备份目录权限 **700**；原 dist **15** 个文件逐一核对 SHA-256 一致，再上传并校验构建压缩包。
  Backed up all **15** original dist files with matching SHA-256 hashes before upload; the backup directory is mode **700**, and the uploaded archive hash was verified.
- 最小变更核对 / Scope verification：新 JS 与原线上活动 JS 相比，严格等于指定的 **12** 处文案替换；CSS、图片及其余共同文件哈希不变。检查脚本首次误按直接 script src 解析首页，实际入口由 `var js` 动态加载；该次在修改线上文件前停止，修正检查脚本后通过，应用源码无需调整。
  The new JS equals the previously active live bundle after exactly the **12** requested text replacements. CSS, images and other shared files are unchanged. The initial checker expected a direct script src, but the actual HTML uses a dynamic `var js` entry. It stopped before live-file replacement; correcting the checker resolved it without application changes.
- 上线 / Deployment：仅上传静态 dist，在原目录内逐文件原子替换，最后更新 `index.html`，保留目录 inode、旧哈希资源与备份。
  Deployed static dist only, atomically replacing files within the existing directory and updating index.html last while retaining the directory inode, historical assets and backups.
- HTTPS 验证 / HTTPS verification：在服务器本机使用 `curl --resolve jeayon.com:443:127.0.0.1`，保持证书验证；首页与构建引用资源共 **11/11** 个响应为 **200**，响应 SHA-256 与本地构建一致。活动 JS 为 `assets/index-OQDVrwaj.js`，含「导航」「看板」「待办」「计划」「日记」「组织」；主导航标签精确为新五词，不再出现旧五词；对应主标题亦通过检查。旧业务用语仍按要求存在于 bundle 其他位置。
  Server-local HTTPS with the requested loopback resolution and TLS verification returned **200** for **11/11** files, with hashes matching the local build. The active JS contains all six required strings; the main navigation uses exactly the five new labels, and page headings match. Existing business terminology remains elsewhere in the bundle as requested.
- 容器 / Containers：部署前后 API、Postgres、Caddy 的 ID、镜像、启动时间、重启次数、运行与健康状态一致；三者均为 running / healthy。
  API, Postgres and Caddy retained their IDs, images, start times, restart counts and running/healthy states.

证据 / Evidence：`logs/brand-nav-20261027.jsonl`（源码定点差异、Node 版本、真实测试及构建输出、备份与上传哈希、部署与 HTTPS 验证、容器前后状态）。未执行浏览器视觉或真实登录回归；已打开页面刷新后加载新入口。
Evidence includes task-only source diffs, Node version, actual test/build output, backup/upload hashes, deployment and HTTPS checks, and container states. Browser visual and real sign-in regression checks were not run; already-open pages load the new entry after refresh.
