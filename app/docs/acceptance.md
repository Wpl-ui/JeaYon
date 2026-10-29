# 验收报告

> 交付日期：2026-10-26
> 应用：每日工作（`wbapp_0Tm71W7PKSg6dZLqOcVyRB`）
> 云资源：`wbcs_ZzJM3sXzmkEUP8zuNg8prw`
> 线上地址：<https://daily-work-84804.app.workbuddy.host/?sharecode=2YANPJPZ7B>
> 结论：**已上线到 HTTPS 域名、可访问；自动化检查全部通过。真实会话下的权限与微信登录验收仍未完成。**

---

## 0. 一句话结论

代码层面能自动验证的，全部通过；需要真实账号、真实会话、真实浏览器的，**没有跑**。
所以这份报告里没有"全部验收通过"这种说法——下面把"已通过""结构性保证""未验证""待实测"四类分开写，
不把编译通过当成云端权限通过。

| 类别 | 数量 | 含义 |
| --- | --- | --- |
| ✅ 已通过 | 4 项 | 有可复现的检查结果（命令输出、库结构查询） |
| 🟡 结构性保证 | 4 项 | 权限/约束已落到数据库并被查询确认，但未采集真实请求的拒绝响应 |
| ⚠️ 未验证 | 2 项 | 依赖浏览器与真实账号，当前环境无自动化浏览器 |
| 🟡 待实测 | 1 项 | 微信登录：HTTPS 域名已就绪，真实扫码往返未跑 |

---

## 1. 已通过的自动化检查

### 1.1 类型检查

```
npm run typecheck        # tsc --noEmit -p tsconfig.json
→ 0 error
```

`strict: true`、`noUnusedLocals`、`jsx: react-jsx`、`moduleResolution: bundler`。

### 1.2 生产构建

```
npm run build
→ dist/index.html                    0.42 kB
→ dist/assets/index-D52ThwhR.css    17.15 kB
→ dist/assets/index-Vu2iSY7i.js    412.23 kB │ gzip: 125.05 kB
→ 54 modules transformed, built in 168ms
```

单 chunk 412 kB 主要来自 React + react-router + SDK，未做代码分割（首版不做优化）。

### 1.3 单元测试：50 个用例全部通过

```
npm test   # node --import tsx --test tests/unit/*.test.ts
→ # tests 50  # pass 50  # fail 0
```

| 文件 | 用例数 | 覆盖内容 |
| --- | --- | --- |
| `tests/unit/dates.test.ts` | 12 | ISO 合法性（闰年 2/29 通过、平年 2/29 拒绝、4/31 拒绝、13 月拒绝）、日序号往返、跨闰日/跨年 `diffDays`/`addDays`、周一为 0 的 `weekdayIndex`、`startOfWeek` 跨年、`endOfMonth`、`addMonths` 月末夹取、`eachDay` 闭区间 |
| `tests/unit/progress.test.ts` | 6 | 进度夹取（-5→0、42.5→43、NaN→0、Infinity→0）、状态推导、`progressForStatus` 把 in_progress 的 0/100 修正为 1、平均进度（空数组→null、`[0,33,100]`→44.3、归档排除） |
| `tests/unit/stats.test.ts` | 8 | 逾期判定（截止当天**不算**、done/archived 不算）、近 7 天范围（今天算、+6 算、+7 不算）、仪表盘汇总、空任务平均进度为 null、最新日报同日取 `updated_at` 最晚、团队日报按日期倒序 + 姓名中文排序 |
| `tests/unit/gantt-scale.test.ts` | 13 | **日/周/月三缩放 × 6 个跨月跨年闰年样本，`dateToX` / `dateAtX` 严格互逆**；格内向下取整；同日起止为 1 天宽；`snapDays` 按小数宽度吸附；2 月闰年 29 天；周视图每格 7 天宽；`applyDragDates` 移动不改变时长、拖边缘夹取、跨月跨年按自然日 |
| `tests/unit/permissions.test.ts` | 9 | owner/admin/member 三档 × 邀请码/改角色/移除成员/改他人日报的完整矩阵；不能移除自己与已停用成员；不要移除唯一 owner |
| `tests/unit/conflict.test.ts` | 7 | 错误分类（`unauthenticated` 才算会话失效、`permission-denied` 不算、`23505`→`already_exists`、`PGRST116`→`not_found`、`credits-exhausted` 文案）、**乐观并发规格模型**：A 用 v1 成功升到 v2，B 仍用 v1 被拒且不覆盖 A、不推进版本，B 用 v2 重提成功升到 v3 |

> 关于第 6 项"并发"：`conflict.test.ts` 里是**逻辑级模拟**（本地行 + `expectedVersion` 比对），
> 用来钉住前端在这种情况下的行为契约。它不等于真实数据库上两个客户端并发写入的实测。

---

## 2. 十项验收逐条状态

### ① 类型检查 / 构建 / 日期 / 进度 / 统计 / 并发测试 — ✅ 通过

见第 1 节。日期、进度、统计、甘特刻度、权限、并发分类均有可复跑的用例。

### ② 登录与会话恢复、团队、任务、日报、甘特拖拽全流程 — ⚠️ 未验证

- **代码已完整实现**：`main.tsx` 里先 `dispatchOAuthCallback()` 再取 session 再 render，路由守卫在会话恢复之后才渲染；`AuthProvider` 统一 `loading / signed-out / signed-in / error` 四态；团队入口有 `TeamGate`（无团队时创建/加入）；任务、日报、甘特三个页面都有空态与加载态。
- **未跑通全链路的原因**：当前环境没有 Playwright / Puppeteer（`node_modules/.bin` 下不存在），无法脚本化点击。已确认 `npm run dev` 起来后 `GET /` 返回 200、`/src/main.tsx` 正常转译，但这只能证明**服务器能起、模块能加载**，不等于业务流程走得通。
- 手机验证码登录还需要真实手机号接收短信，这一步本次未做。

### ③ owner / admin / member / 外部用户权限矩阵 — 🟡 结构性保证 + 单元测试覆盖

- 前端规则集中在 `src/lib/permissions.ts`，9 个用例覆盖完整矩阵（含"不能再移除已停用成员""不能移除唯一 owner"）。
- 数据库侧的对应关系已通过查询确认（`pg_policies` 共 6 条策略 + 表级 GRANT 快照，见 `docs/db-schema.sql` 第 11–13 节）。
- **未做**：用四个真实账号分别登录、逐个点击并采集实际响应。

### ④ 真实会话直连 API 伪造作者/团队/角色被拒（而非仅隐藏按钮） — 🟡 结构性保证，请求级未采集

这一项分两层看，我把两层分开说清楚：

**数据库结构上已经不可能成功**（这是从 `pg_class` / `acl` 查询出来的客观事实，不是推测）：

| 伪造尝试 | 直接 API 的结果 | 原因 |
| --- | --- | --- |
| `INSERT INTO team_members` 把自己加成 owner | 42501 无权限 | `authenticated` 对该表只有 `SELECT` |
| `UPDATE team_members SET role='admin'` | 42501 无权限 | 同上，无 `UPDATE` 授权 |
| `SELECT * FROM team_invites` 读别队邀请码 | 42501 无权限 | 该表对 `authenticated` 零授权 |
| `UPDATE tasks SET team_id=<别队>` | 42501 无权限 | `tasks` 对 `authenticated` 只有 `SELECT, INSERT` |
| `DELETE FROM work_logs` 删别人的日报 | 42501 无权限 | `work_logs` 只有 `SELECT, INSERT` |
| `INSERT INTO tasks (created_by=<别人>)` | 42501 / 策略拒绝 | `tasks_insert_member` 的 `WITH CHECK` 要求 `created_by = auth.uid()` |
| 未登录（anon）读任何业务表 | 42501 | 五张表对 `anon` 均已 `REVOKE ALL` |

**但"实际 HTTP 响应"没有采集**。严格按验收标准，这一条应记为"未完成实测"。
复现方法见第 4 节。

### ⑤ 被移除成员已有会话不能再读写 — 🟡 结构性保证

机制：`app_remove_member` 只把 `active` 置 false，不删行；所有策略与 RPC 的身份判定都走 `team_role()`，
而 `team_role()` 的 SQL 是 `... AND m.user_id = auth.uid() AND m.active`。所以停用之后：

- 5 条 `SELECT` 策略的 `USING` 全部变 NULL → 查询返回空集，不是报错，界面会显示"没有数据"
- 所有写 RPC 第一步 `IF team_role(...) IS NULL THEN RETURN forbidden` → 明确拒绝
- 前端 `useTeamQuery` 里 `isSessionExpired` 之外的 `permission-denied` 会显示"可能已被移出团队"

**未做**：用真实客户端在移除后立刻发请求，确认返回码与界面提示。

### ⑥ 两客户端并发修改旧版本被拒 — 🟡 逻辑已测，库侧未实测

- RPC 实现：`SELECT ... FOR UPDATE` 锁行 → `IF v_task.version <> v_expected THEN RETURN conflict` → 不符直接返回，**不写、不推进版本**。
- 前端行为：`conflict` 时**保留用户输入**、提示"该任务已被他人修改，已重新加载最新状态"，不静默覆盖。
- 甘特拖拽的 `conflict` 走"先回滚乐观显示、再 `query.reload()`"，不用旧快照覆盖较新结果。
- **未做**：两个浏览器会话对同一任务并发保存，观察第二个请求的真实返回。

### ⑦ 团队切换 / 退出 / 慢请求交错不出现旧团队数据回填 — ⚠️ 未验证

实现手段（三层，都在代码里但未在浏览器中构造慢响应验证）：

1. `RequestGuard`（`src/lib/request-guard.ts`）：每次查询拿一个 token，响应回来时比对，不是最新就丢弃。
2. `useTeamQuery` 的 `useEffect` cleanup 里 `guard.current.invalidate()`：切团队/切用户时立刻让在途请求作废。
3. 查询依赖数组含 `teamId`、`dataEpoch`、`nonce`；退出登录时 `dataEpoch` 递增，缓存整体失效，并清理 `localStorage` 的 `dwa:selectedTeamId`。

**未做**：人为延迟某个团队请求，切走后观察旧响应是否回填。

### ⑧ 重复日报 / 唯一日期冲突 / 归档任务历史关联 / 成员历史姓名 — 🟡 库约束已确认，行为未实测

| 子项 | 保证方式 | 状态 |
| --- | --- | --- |
| 每人每团队每天最多一篇 | `work_logs_team_owner_date_key UNIQUE (team_id, owner_id, work_date)`（库中已确认） | 🟡 约束存在 |
| 重复提交的提示 | 前端先查当天是否已有，有则直接打开那篇并提示；`UPDATE` 撞唯一键时 RPC 捕获 `unique_violation` 返回 `already_exists`「该日期已有日报，请直接编辑那一篇」 | 🟡 代码已实现 |
| 归档任务的历史关联保留 | `app_worklog_update` 里只在"关联任务发生变化"时才校验未归档：`IF v_related <> coalesce(v_log.related_task_id, -1) THEN ...`；界面把已归档任务渲染成「已归档任务 #id（保留关联）」 | 🟡 代码已实现 |
| 成员历史姓名 | 成员软停用不删行，`display_name` 保留；`work_logs.owner_name` 是写入时快照 | 🟡 结构保证 |

### ⑨ 甘特跨月跨年闰年 / 同日起止 / 横向滚动后拖拽 / 取消拖拽 / 保存失败 — ⚠️ 部分通过

- **✅ 跨月跨年闰年**：`gantt-scale.test.ts` 用 13 个用例把三种缩放 × 跨月/跨年/闰年样本的 `dateToX`↔`dateAtX` 互逆锁死；期间还修掉一个真实浮点 bug —— 月视图 `dayWidth = 2.4` 时 `2.4 * 3 = 7.199999999999999`，除回去 `floor` 会算成前一天，已改为 `floor(x / dayWidth + 1e-9)`。**这个 bug 是测试跑出来的，不是想出来的。**
- **✅ 同日起止**：`barRect` 强制 `days = max(1, diffDays + 1)`，测试断言同日 = 1 天宽。
- **✅ 取消拖拽**：三条路径都接了 —— `pointercancel`、`lostpointercapture`（`handleLostCapture`）、Escape（`useEffect` 注册 window `keydown`）。**未在浏览器里实际按 Esc 验证。**
- **🟡 横向滚动后拖拽**：设计上规避了坐标错误 —— 拖动只用"按下时的 `clientX` + 位移"算天数，不用绝对坐标，因此滚动位置不参与计算。**未实测。**
- **🟡 保存失败**：先回滚乐观值到原始日期，再 `reload()` 拉服务端状态；`savingRef` 阻止同一任务重复提交。**未实测。**

### ⑩ 网络失败 / 无权限 / 会话失效 / 云额度不足明确状态、无假成功 — 🟡 分类已测，真实场景未观察

`src/lib/errors.ts` + `conflict.test.ts` 7 个用例钉住了映射：

| 输入 | 分类 | 用户看到 |
| --- | --- | --- |
| `unauthenticated` / HTTP 401 | `unauthenticated` + `sessionExpired=true` | 回到登录页并说明会话已失效 |
| `permission-denied` / `42501` | `permission-denied` | 「没有权限执行此操作（可能已被移出团队）」 |
| `credits-exhausted` | `credits-exhausted` | 「云服务额度不足，写入已停止，请联系团队管理员」 |
| `rate-limited` | `rate-limited` | 稍后重试 |
| `network` | `network` | 网络异常 |
| `23505` | `already_exists` | 已存在 |
| `23503` / `23514` | `invalid` | 数据不合法 |
| `PGRST116` | `not_found` | 不存在 |

关键点：**裸字符串和普通对象不会透传到界面**（有一条用例专门断言这点），只有标准 `Error.message` 才显示原文——避免后端内部错误泄露成一串英文堆栈。

「无假成功」的做法：写操作只认 RPC 返回的 `ok === true`，不接受"没抛错就算成功"；表 INSERT 用 `.select()` 检查返回行数。

**未做**：真断网、真耗尽额度、真令牌过期下的界面表现。

---

## 3. 待实测项

### 🟡 微信登录与 OAuth 回调：域名已就绪，真实往返未跑

应用已发布到 HTTPS 域名（`https://daily-work-84804.app.workbuddy.host/`），原先"没有 HTTPS 域名"这个阻碍已经消除。

- 代码已接入官方 SDK：`signInWithOAuth({ provider: 'wechat', redirectTo })` + `handleWechatWebCallback()`，**没有手写或绕过回调校验**。
- 本地开发时 `startWechatLogin` 主动抛错：「微信登录需要在已发布的 HTTPS 域名下使用；本地开发请用手机验证码登录」——这是刻意行为，不是失效。
- 回调处理器已保证：先于路由守卫和受保护查询执行；处理后只清理认证参数（`code/state/provider/provider_id/error/error_description/error_uri`），**保留业务查询参数与 HashRouter 路由**。
- **上线后修掉了一个只有真域名才暴露的缺陷**：平台按 `?sharecode=` 放行访问，根路径 `/` 直接返回 403。原 `redirectTo` 取 `${origin}/`，微信授权回跳必然被拦成 403。现改为把当前 `sharecode` 带进 `redirectTo`，回跳后既过得了门禁，也会被回调清理逻辑原样保留。
- **仍未验证**：真实微信扫码 → 授权页 → 回调 → 建立会话的完整往返。需要你用真实微信账号点一次「微信登录」。
  **在这次实测完成前，不得声称微信登录已通过验收。**

### 3.1 上线过程中发现并已修复的两个问题

| 问题 | 表现 | 原因 | 修法 |
| --- | --- | --- | --- |
| 端口注入不生效 | 沙箱内 `vite preview` 进程存在，但探活端口无人监听，首次发布失败 | `preview.port` 依赖 `process.env.PORT` 在配置求值时可见，沙箱里这条链不可靠 | 启动命令显式传 `--port 3000`，不再依赖配置推断 |
| 资源被门禁拦成 403 | 首页 200，但页面白屏；`/assets/*.js`、`*.css` 裸请求全部 403「链接不完整」 | 平台只按 `?sharecode=` 放行，HTML 里的静态资源引用不带该参数 | 构建收尾把 `<script src>` / `<link href>` 换成内联 loader，运行时读出 `sharecode` 再拼到资源地址 |

两个修复都已用线上请求验过：`HTML 200` / `CSS 200 17158B text/css` / `JS 200 412367B text/javascript`，且**裸请求仍为 403**——门禁照常生效，没有被绕过；线上 JS 的 sha256 与本地构建产物完全一致。

### 其他未验证项的根因

| 未验证内容 | 根因 |
| --- | --- |
| 浏览器端到端流程 | 环境中无 Playwright / Puppeteer，且未获得真实手机号完成登录 |
| 云端权限负向验证 | 管理通道（`exec_sql`）以表主身份执行、自动绕过 RLS，无法用它模拟"带某个用户 JWT 的匿名客户端" |
| 两客户端并发 | 需要两个真实登录会话 |

---

## 4. 剩余验收怎么自己做（可执行步骤）

### 4.1 造两个账号

1. `npm run dev` → 打开 `http://127.0.0.1:5183`
2. A 用手机号验证码登录 → 创建团队「测试组」，记下邀请码
3. B 用另一个手机号登录 → 用邀请码加入（默认 member）
4. A 在团队页把 B 设为管理员 → 再取消 → 确认角色提示与按钮可用性随之变化

### 4.2 权限矩阵（③）

按 owner / admin / member 三种身份分别看团队页：邀请码是否可见、改角色按钮是否出现、移除按钮对 owner/admin/member 分别是否可用。
再用第三个账号（不在团队）登录，确认列表里看不到这个团队。

### 4.3 伪造请求被拒（④）

这一项的关键是**不要相信界面**：按钮藏起来只说明前端拦了，不说明服务端会拒。

做法：浏览器 DevTools → Network，随便点一次任务保存，找到那条真实请求 → 右键 **Copy as cURL**。
这条命令里的 URL、`apikey`、`Authorization` 都是抓到的真值，不用自己拼。然后只改 `--data` 里的 JSON 再执行：

```bash
# 1) 改 created_by 为别人的 user_id（团队里另一个成员的 id）
#    期望：4xx 拒绝。理由：tasks_insert_member 的 WITH CHECK 要求 created_by = auth.uid()
#    若返回 2xx 且真的插入了，说明策略失效 —— 这是严重缺陷。

# 2) 改 team_id 为自己不属于的团队 id
#    期望：4xx 拒绝。理由：team_role(team_id) 为 NULL，WITH CHECK 不通过。

# 3) 把请求方法改成 PATCH（或 DELETE），打同一个任务 URL
#    期望：42501。理由：authenticated 对 tasks 只有 SELECT / INSERT，没有 UPDATE / DELETE。

# 4) 用 GET 打 team_invites 对应的表地址（从 SDK 请求里找同源的表地址换表名）
#    期望：42501 或空数组。理由：该表对 authenticated 零授权。
```

我只把 URL 写成"从抓包复制"，是因为这个端点下 PostgREST 的实际路径前缀由平台决定，
我没有实测过，不想在文档里给一个看着像真的、但可能拼错的地址。

判断标准只有一条：**服务端返回非 2xx，且数据没被改**。前端把按钮藏了不算通过。


### 4.4 被移除成员的旧会话（⑤）

B 登录后停在任务页不动 → A 移除 B → B 点任意刷新/保存 → 期望提示"可能已被移出团队"或数据清空，**不应**还能保存成功。

### 4.5 并发（⑥）

A、B 同时打开同一任务的编辑抽屉（都基于 version N）→ A 先保存 → B 再保存 → 期望 B 看到"该任务已被他人修改"，且**B 刚才填的内容还在 input 里**，不被清空、也不覆盖 A。

### 4.6 甘特（⑨）

- 把任务拖到 2026-12-31 → 2027-01-01 跨年、2 月 28 → 3 月 1 跨月、2028-02-29 闰年，松手后确认日期与预期一致
- 把右侧时间轴横向滚到最右，再拖任务条，确认位移与鼠标移动距离一致（不应出现"越滚越偏"）
- 拖到一半按 Esc / 把鼠标拖出窗口，确认回到原位，没有发出写请求
- 断开网络后拖动，确认先弹回原位再提示失败，而不是显示成已保存

---

## 5. 数据库结构核对（已完成的客观检查）

以下均来自对真实库的查询，不是设计稿：

| 检查 | 结果 |
| --- | --- |
| 5 张表均 `ENABLE ROW LEVEL SECURITY` | ✅ 全部开启 |
| 策略数量 | 6 条（teams/tasks/work_logs/team_members 各 SELECT，tasks/work_logs 各 INSERT） |
| `anon` 在 5 张表上的权限 | ✅ 零授权（已 `REVOKE ALL`） |
| `authenticated` 在 `team_invites` 上的权限 | ✅ 零授权 |
| `tasks` / `work_logs` 的 `UPDATE` / `DELETE` | ✅ 未授予（写操作只能走 RPC） |
| 函数 `EXECUTE` 对 `anon` | ✅ 全部收回 |
| `app_new_invite_code` 对 `authenticated` | ✅ 未授予（仅 service_role 与表主） |
| 所有 SECURITY DEFINER 函数的 `search_path` | ✅ 均为 `public, pg_temp` |
| 用户 ID 列类型 | ✅ 全部 `text`（匹配 `auth.uid()` 返回 text） |
| `tasks` 状态↔进度一致性 | ✅ `tasks_status_progress_ok` CHECK 已存在 |
| 同团队负责人约束 | ✅ 复合外键 `(team_id, assignee_id) → team_members(team_id, user_id)` |
| 关联任务同团队约束 | ✅ 复合外键 `(team_id, related_task_id) → tasks(team_id, id)` |
| 日报唯一日期 | ✅ `UNIQUE (team_id, owner_id, work_date)` |
| 邀请码格式 | ✅ `CHECK code ~ '^[A-Z0-9]{10}$'` |

完整镜像见 `docs/db-schema.sql`（971 行，含 12 个函数的完整定义）。

---

## 6. 交付物清单

| 文件 | 说明 |
| --- | --- |
| `src/` | 全部源码，约 30 个模块 |
| `tests/unit/*.test.ts` | 6 个测试文件，50 个用例 |
| `docs/db-schema.sql` | 云数据库结构快照（表/约束/索引/函数/权限/策略） |
| `docs/acceptance.md` | 本文件 |
| `README.md` | 使用说明、环境配置、云端资源契约、已知限制 |
| `dist/` | 生产构建产物 |

---

## 7. 明确未做的事

- 没有绑定自有域名（当前用的是平台分配的 `*.app.workbuddy.host` 域名）
- 没有执行 Git commit / push
- 没有修改 `E:/工作日记` 这个 Electron 桌面项目
- 没有为了"看起来跑通"而用 localStorage / 假登录 / 假数据替代云服务
