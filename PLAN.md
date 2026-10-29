# 每日工作自托管迁移计划 / Daily Work Self-hosting Plan

日期 / Date: 2026-10-26。状态 / Status: 架构计划，尚未实施 / Architecture only, not implemented.

## 0. 范围、依据与假设 / Scope, evidence and assumptions

- 本步骤只新增本文件；不改 `app/`，不向空的 `server/` 写代码，不安装依赖、不迁移数据库、不部署、不执行改变 Git 状态的命令。
- 依据：已阅读指定的 `src/lib/*`、`auth/*`、`types/db.ts`、`teams/*`、`tasks/*`、`logs/*`、`dashboard/*`、`gantt/*`、全部六个 unit test 文件、`docs/db-schema.sql`、`docs/acceptance.md`、`README.md`；补查 `main.tsx`、`App.tsx`、`vite.config.ts`、依赖声明及 SDK README/相关 `.d.ts`。数据库语义以 971 行 SQL 快照为准，旧验收文档中的成功记录不算本次实测。
- 确定选型：单体 API + 单 PostgreSQL，同域 `https://jeayon.com/` 静态应用、`/api` 后端。登录先实现邮箱验证码与大陆手机短信验证码；微信留到后续，不继续调用 WBCS Relay。业务 UI、HashRouter、自然日计算、权限与冲突语义保留。
- 旧数据存在两种落地路径：全新初始化，或保留云端数据并迁移身份映射。尚未指定，故两种路径均在 §11 列出，不默认丢弃旧数据；本步骤不执行任何一种。
- 本机：`/opt/node24/bin/node --version` 实测 `v24.22.1`；有原生 PostgreSQL 16，`pg_lsclusters` 显示 `16 main 5432 down`；未找到 Docker 命令。开发使用原生 PostgreSQL 16，不使用 Docker。生产 Compose 是交付目标，不要求本机能启动容器。
- 用户提供的本地连接：dev `postgres://dwa:dwa_dev_only@127.0.0.1:5432/dwa_dev`；test `postgres://dwa:dwa_dev_only@127.0.0.1:5432/dwa_test`。这是开发专用凭据，生产必须更换。只读连接尝试未成功；数据库存在性、授权、内容尚未独立验证，不启动服务来越过本步骤边界。

English: Preserve the observed application contract, replace cloud auth and database transport, and keep production deployment separate from native local development. Existing-data migration remains an explicit decision.

## 1. 全部云调用清单 / Complete cloud-call inventory

### 1.1 初始化、认证及隐式行为 / Client and auth

以下路径均相对 `app/src/`。SDK 为 `@tencent-ai/workbuddy-cloud-sdk@0.1.4-dev.ca27990.202610161713`。

| 文件:函数 / Call site | 实际调用 / SDK call | 新服务需要提供 / Replacement |
| --- | --- | --- |
| `lib/cloud.ts`: 模块初始化 | `createWorkBuddyCloud({endpoint, oauthRelayBaseUrl, publishableKey})`，单一实例 | 同源 `/api` fetch 客户端，不再需要资源 ID、publishable key 或 Relay |
| `main.tsx:bootstrap` | `cloud.auth.getSession()`，先于 render/路由保护 | `GET /api/auth/me`；需要时先完成一次受控 refresh，再确定首屏 |
| `auth/AuthProvider.tsx:useEffect` | `cloud.auth.onAuthStateChange(callback)`，处理 INITIAL_SESSION、SIGNED_IN、SIGNED_OUT 等，cleanup 调 unsubscribe | 应用自有 auth 状态通知；登录、刷新、退出后同步状态，保留 `dataEpoch` |
| `auth/AuthProvider.tsx:signOut` | `cloud.auth.signOut()`；当前代码忽略返回的 error，且异常也清本地 UI | `POST /api/auth/logout` 撤销服务端 session 并清 cookie；失败不能宣称服务器已退出，见 §4 |
| `auth/AuthProvider.tsx:syncSession` | `cloud.auth.getSession()` | 复用 me/refresh，不把网络失败归为 401 |
| `auth/api.ts:requestPhoneCode` | `cloud.auth.signInWithOtp({phone: normalizedE164})` → challenge | `POST /api/auth/otp/request` → 可序列化 challenge，无 `isExistingUser/isUser` |
| `auth/api.ts:verifyPhoneCode` | `challenge.verify({token: whitespaceStrippedCode})`，目前接受 4–8 位数字 | `POST /api/auth/otp/verify` → session 元数据 + Set-Cookie；新验证码固定 6 位 |
| `auth/api.ts:startWechatLogin` | HTTPS 下 `signInWithOAuth({provider:'wechat',redirectTo: origin+'/' + sharecode?})`，随后 `location.assign(data.url)` | 本阶段下线该动作/显示“稍后提供”；不提供假 OAuth 成功 |
| `auth/callback.ts:dispatchOAuthCallback` | 有 code/error 参数时 `cloud.auth.handleWechatWebCallback(search)`；清认证参数，保留业务 query/hash | 本阶段取消 WBCS 兑换与启动依赖；后续微信使用自有服务端回调 |

SDK 类型确认：`getSession()` 可隐式刷新；每个数据库请求前共享 fetch 会调用 `auth.getAccessToken()`；SDK 原先把凭据存 localStorage，其跨标签页行为也由 SDK 处理。新实现必须接管这些职责，不能只替换登录按钮。前端没有直接调用 `refreshSession()`、`getUser()`、密码登录/注册或匿名登录。

### 1.2 团队：8 个调用点 / Teams: 8 call sites

`fromTable(T)` 是 `cloud.database.from(T)`；`expectRpc` / `callRpcEnvelope` 最终是 `cloud.database.rpc(fn,args)`。

| 文件:函数 | SDK 查询或 RPC（全部参数/筛选/排序） | 服务端需求 |
| --- | --- | --- |
| `teams/api.ts:fetchMyTeams(userId)` | `from('team_members').select('team_id, role, display_name, joined_at, teams(id, name, timezone, created_by, created_at, updated_at)').eq('user_id',userId).eq('active',true).order('joined_at',{ascending:true})` | 查询当前 session 用户的有效 membership + 嵌套 team；返回 joined_at 升序。API 不接受任意 userId 来替代本人 |
| `teams/api.ts:fetchMembers(teamId)` | `from('team_members').select('*').eq('team_id',teamId).order('joined_at',{ascending:true})` | 有效队员可读全队成员，包括 inactive 历史行 |
| `teams/api.ts:createTeam` | `rpc('app_create_team',{p_name:name,p_display_name:displayName})` | 原子创建 team + owner membership + 首枚邀请码 |
| `teams/api.ts:joinTeam` | `rpc('app_join_team',{p_code:code,p_display_name:displayName})`，读取完整业务信封 | 首次加入/重新激活/`already_member` 三分支；重复加入返回 team_id、role |
| `teams/api.ts:getInviteCode` | `rpc('app_get_invite_code',{p_team_id:teamId})` | owner/admin 读取受限邀请码 |
| `teams/api.ts:resetInviteCode` | `rpc('app_reset_invite_code',{p_team_id:teamId})` | owner/admin 换码，旧码立即失效 |
| `teams/api.ts:setMemberRole` | `rpc('app_set_member_role',{p_team_id:teamId,p_user_id:userId,p_role:'admin'\|'member'})` | 仅 owner 可变更其他有效非 owner 成员 |
| `teams/api.ts:removeMember` | `rpc('app_remove_member',{p_team_id:teamId,p_user_id:userId})` | 停用、任务解绑及版本增长、换码；返回 `unassigned_tasks,invite_code` |

`fetchMyTeams` 当前兼容 `teams` 为对象/数组/null，转换成 `TeamSummary {team,role,displayName,joinedAt}`。新 API 返回确定的嵌套 team 对象，前端 adapter 继续输出同一 TeamSummary。

### 1.3 任务：7 个调用点 / Tasks: 7 call sites

| 文件:函数 | SDK 查询或 RPC | 服务端需求 |
| --- | --- | --- |
| `tasks/api.ts:fetchTasks` | `from('tasks').select('*').eq('team_id',teamId).is('archived_at',null).order('due_date',{ascending:true}).order('id',{ascending:true})` | 未归档完整 TaskRow[]，due_date ASC、id ASC |
| `tasks/api.ts:fetchArchivedTasks` | `from('tasks').select('*').eq('team_id',teamId).order('archived_at',{ascending:false})`；取回后 JS 过滤 `archived_at!==null` | 新 API 可直接 `archived_at IS NOT NULL`，保留 archived_at DESC；同时间加 id 作为稳定次序 |
| `tasks/api.ts:createTask` | `from('tasks').insert({team_id,title,description,assignee_id,status,progress,start_date,due_date}).select('*').single()` | 服务端生成 created_by、id、version=1、时间戳；返回完整落库行 |
| `tasks/api.ts:updateTask` | `rpc('app_task_update',{p_payload:{task_id,expected_version,title,description,assignee_id,status,progress,start_date,due_date}})`；assignee 空值为 `''` | 原子版本检查、有效成员检查、字段 allowlist、全 draft 更新；TaskDrawer 与甘特拖动共用 |
| `tasks/api.ts:setTaskArchived` | `rpc('app_task_archive',{p_task_id,p_expected_version,p_archived:boolean})` | 可归档/恢复；恢复时清空已停用负责人；每次成功 version+1 |
| `tasks/api.ts:fetchTask` | `from('tasks').select('*').eq('id',taskId).maybeSingle()` | 完整行或 null，含归档；用于冲突后重读 |
| `tasks/api.ts:fetchTaskLogs` | `from('work_logs').select('id, owner_id, owner_name, work_date, done_today, version').eq('team_id',teamId).eq('related_task_id',taskId).order('work_date',{ascending:false})` | 同团队关联日报投影；归档任务的历史关联可读 |

### 1.4 日报：5 个调用点 / Work logs: 5 call sites

| 文件:函数 | SDK 查询或 RPC | 服务端需求 |
| --- | --- | --- |
| `logs/api.ts:fetchWorkLogs` | `from('work_logs').select('*').eq('team_id',teamId).order('work_date',{ascending:false}).order('updated_at',{ascending:false}).limit(300)` | 实际是最新 300 条，无 60 天条件；保留该默认与排序，加 id 稳定同值次序 |
| `logs/api.ts:fetchMyLogOnDate` | `from('work_logs').select('*').eq('team_id',teamId).eq('owner_id',ownerId).eq('work_date',workDate).maybeSingle()` | 当前用户/团队/日期唯一行或 null；重复检测与冲突重读 |
| `logs/api.ts:createWorkLog` | `from('work_logs').insert({team_id,owner_name,work_date,done_today,problems,plan_tomorrow,hours,related_task_id}).select('*').single()` | owner_id 来自 session；保留姓名快照；唯一冲突明确失败 |
| `logs/api.ts:updateWorkLog` | `rpc('app_worklog_update',{p_payload:{log_id,expected_version,work_date,done_today,problems,plan_tomorrow,hours,related_task_id}})`；hours 是 trimmed 字符串，related_task_id 是数字字符串或 `''` | 仅有效队员且是作者；版本控制；日期可改；保留原已归档任务关联 |
| `logs/api.ts:deleteWorkLog` | `rpc('app_worklog_delete',{p_log_id,p_expected_version})` | 本人、有效队员、版本一致才物理删除日报 |

### 1.5 封装、请求头与无调用部分 / Wrappers and transport

- `lib/db.ts:fromTable/callRpc` 分别代理 SDK `from/rpc`；`expectRows/expectMaybe/expectOne/expectOk` 处理 `{data,error}`；`callRpcEnvelope/expectRpc` 处理 `{ok,code,message,data?}`。`expectOk` 与 QueryBuilder 中 update、neq、gt/gte/lt/lte/in 等只是声明/工具，没有业务调用。总计 **20 个业务云调用点 = 8 SELECT + 2 INSERT + 10 RPC**，没有直接 UPDATE/DELETE/upsert。
- 前端没有手工设置 `Prefer`、Authorization、apikey 或其他自定义数据库头。SDK `.d.ts` 明确 publishable 头名为 `x-wb-webapp-access-key`，身份由共享 fetch 注入；类型中的 `apikey` 示例不等于本应用实际使用该头。数据库 SDK 面为 `/.cloud/database/rest`，不需要重建该平台路径。
- 两处 `insert(...).select('*').single()` 需要 PostgREST 的“返回 representation + 恰好一行”语义，通常对应 `Prefer: return=representation` 与单对象表示；本次未抓网络包，也未读取 SDK 实现，**不把具体 wire headers 声称为实测**。新 REST 用 201 + 完整行，无需前端再发 Prefer。`maybeSingle` 的 0 行 → null 必须保留。
- Dashboard 只调用 fetchTasks/fetchWorkLogs 并在客户端统计；Gantt 调 fetchTasks/updateTask；任务/日报页在客户端筛选。TeamProvider 调上述团队接口；没有遗漏的独立统计云接口。
- 全 `app/src` 检索未见 storage、realtime/channel、LLM、附件上传调用。当前是写后重查、手动刷新、窗口 focus 重查，不新增 WebSocket、对象存储或统计服务。

English: The replacement needs explicit REST routes for 20 database call sites and the auth lifecycle, not a generic PostgREST clone. No storage or realtime service is required.

## 2. 数据模型与迁移映射 / Data model and PostgreSQL mapping

### 2.1 原有五张表：完整列定义 / Existing columns

约定：`!`=NOT NULL，`?`=nullable；`BI`=bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY；`ts`=timestamptz。未列 default 的列没有 default。保留 `public` 下表名与 snake_case 字段，便于行类型和数据导入对应。

| 表 | 全部列、原类型/default → 新库映射 |
| --- | --- |
| `teams` | `id BI`; `name text!`; `timezone text! DEFAULT 'Asia/Shanghai'`; `created_by text! DEFAULT auth.uid()` → 改为 API 显式填 session.user.id，无 auth default；`created_at ts! DEFAULT now()`; `updated_at ts! DEFAULT now()` |
| `team_members` | `id BI`; `team_id bigint! REFERENCES teams(id)`; `user_id text!`; `role text! DEFAULT 'member'`; `active boolean! DEFAULT true`; `display_name text!`; `joined_at ts! DEFAULT now()`; `deactivated_at ts?` |
| `team_invites` | `team_id bigint PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE`; `code text!`; `updated_at ts! DEFAULT now()`; `updated_by text?` |
| `tasks` | `id BI`; `team_id bigint! REFERENCES teams(id)`; `created_by text! DEFAULT auth.uid()` → API 填；`assignee_id text?`; `title text!`; `description text?`; `status text! DEFAULT 'todo'`; `progress smallint! DEFAULT 0`; `start_date date!`; `due_date date!`; `archived_at ts?`; `version integer! DEFAULT 1`; `created_at ts! DEFAULT now()`; `updated_at ts! DEFAULT now()` |
| `work_logs` | `id BI`; `team_id bigint! REFERENCES teams(id)`; `owner_id text! DEFAULT auth.uid()` → API 填；`owner_name text!`; `work_date date!`; `done_today text!`; `problems text?`; `plan_tomorrow text!`; `hours numeric?`（不擅自改成固定 scale）；`related_task_id bigint?`; `version integer! DEFAULT 1`; `created_at ts! DEFAULT now()`; `updated_at ts! DEFAULT now()` |

原 FK 没有指定删除行为的保留 PostgreSQL 默认 NO ACTION；不增加业务硬删除接口。负责人复合 FK 只保证成员行存在，**不保证 active**；有效性由服务端事务检查，不能误读 SQL 注释为更强约束。

### 2.2 全部约束与索引 / Constraints and indexes

| 表 | 除主键外全部命名约束 |
| --- | --- |
| `teams` | `teams_name_check`: char_length(btrim(name)) 1..40；`teams_timezone_check`: timezone='Asia/Shanghai' |
| `team_members` | `team_members_team_user_key`: UNIQUE(team_id,user_id)；`team_members_role_check`: owner/admin/member；`team_members_display_name_check`: trimmed 长度 1..40 |
| `team_invites` | `team_invites_code_key`: UNIQUE(code)；`team_invites_code_check`: `^[A-Z0-9]{10}$` |
| `tasks` | `tasks_team_id_key`: UNIQUE(team_id,id)；`tasks_team_assignee_fk`: (team_id,assignee_id) → team_members(team_id,user_id)，MATCH SIMPLE，assignee=null 合法；`tasks_title_check`: trimmed 1..120；`tasks_status_check`: todo/in_progress/done；`tasks_progress_check`: 0..100；`tasks_status_progress_ok`: todo=0 / in_progress=1..99 / done=100；`tasks_dates_ok`: due_date>=start_date |
| `work_logs` | `work_logs_team_owner_date_key`: UNIQUE(team_id,owner_id,work_date)；`work_logs_team_task_fk`: (team_id,related_task_id) → tasks(team_id,id)，null 合法；`work_logs_owner_name_check`: trimmed 1..40；`work_logs_done_today_check`、`work_logs_plan_tomorrow_check`: trimmed 非空；`work_logs_hours_check`: null 或 0..24 |

原显式索引全部保留：`team_members_user_idx(user_id)`；`tasks_team_archived_idx(team_id,archived_at)`；`tasks_team_assignee_idx(team_id,assignee_id)`；`tasks_team_due_idx(team_id,due_date)`；`tasks_team_status_idx(team_id,status)`；`work_logs_team_date_idx(team_id,work_date DESC)`。五个主键、四个 UNIQUE 另有隐式唯一索引。普通 FK 不会自动产生索引，不能把它们算成已有索引。

**触发器 / Triggers：SQL 快照没有 CREATE TRIGGER 或触发器函数，原库在该文件中定义的触发器数量为 0。** 新库也不引入更新时间/版本触发器；业务事务显式写 `updated_at=now(), version=version+1`，避免双重增长。schema 未 CHECK version>0、description<=2000、日报正文<=2000 或工时两位小数；后面三类依靠当前前端/RPC，新 API 对创建和更新均补服务端验证。新增 version 正数 CHECK 可在核对导入数据后加入，作为明确加固，不冒充原有约束。

### 2.3 十二个函数与 WBCS 依赖替换 / Functions and auth coupling

| 原函数 | 新位置/保持的事务语义 |
| --- | --- |
| `team_role(bigint)` | API `requireActiveMembership(tx,teamId,userId)`，每次请求读当前 membership，不把团队角色固化在 JWT |
| `app_new_invite_code()` | 内部 CSPRNG 生成器，10 位 uppercase UUID hex，有界碰撞重试（原函数实际在 `v_try>20` 时失败）；不暴露 endpoint |
| `app_create_team(text,text)` | teams service，三项创建同事务 |
| `app_join_team(text,text)` | teams service，邀请码校验 + membership upsert/锁行，重复与重加分支 |
| `app_get_invite_code(bigint)` | teams service，owner/admin 读取 |
| `app_reset_invite_code(bigint)` | teams service，轮换并在缺行时补建 |
| `app_set_member_role(bigint,text,text)` | members service，owner 授/撤 admin |
| `app_remove_member(bigint,text)` | members service，停用/解绑/版本/换码同事务 |
| `app_task_update(jsonb)` | tasks service，锁行 + expected_version + 全 draft 更新 |
| `app_task_archive(bigint,integer,boolean)` | tasks service，归档/恢复 + 版本 |
| `app_worklog_update(jsonb)` | logs service，本人/版本/重复日期/历史关联 |
| `app_worklog_delete(bigint,integer)` | logs service，本人/版本 + 物理删除 |

原 SQL 所有 `auth.uid()`（三个列 default、team_role、10 个业务 RPC、两个 INSERT policy）都由验证后的 `request.auth.userId` 替换；客户端 `user_id/owner_id/created_by` 不得决定调用者。快照没有直接读取 `auth.jwt()`、`request.jwt.claims` 等 JWT claim 的代码；WBCS 把 token 映射成 auth.uid/数据库角色属于平台能力，不迁入新库。

**权限实现选择：新库的业务授权集中于显式 API/service 事务，保留 CHECK/UNIQUE/FK，六条旧 RLS 的业务含义逐项迁到 §3；不把旧 auth schema、anon/authenticated/service_role、SECURITY DEFINER RPC 原样安装。** 这是主动更换授权边界，并非宣称新库仍由旧 RLS 保护。DB 不对公网/浏览器开放；运行账号 `dwa_api` 非 owner、非超级用户、无 BYPASSRLS/DDL/角色管理，只有 API 所需表操作与 identity sequence 权限；owner/migrator 独立。team_invites/auth 表只给受信 API，API 无通用表名/SQL/RPC 执行入口。若后续要求数据库也逐请求隔离，再设计事务级身份和新 RLS；不能在连接池上遗留全局用户变量。

### 2.4 新增认证及审计表 / New auth and audit tables

以下是待实施设计，不是已存在的 DDL。业务用户列继续 text，新用户用 `gen_random_uuid()::text`；可原样保留旧 uid。所有凭据表不进入业务响应。

| 表 | 列、约束及索引 |
| --- | --- |
| `users` | `id text PK DEFAULT gen_random_uuid()::text`; `name text NULL`（trimmed 1..40 若填）；`status text NOT NULL DEFAULT 'active' CHECK IN ('active','unclaimed','disabled')`; `created_at,updated_at timestamptz NOT NULL DEFAULT now()`。unclaimed 仅迁移占位，不可登录；没有密码列 |
| `identities` | `id uuid PK DEFAULT gen_random_uuid()`; `user_id text NOT NULL FK users RESTRICT`; `kind text NOT NULL CHECK IN ('email','phone')`; `identifier_normalized text NOT NULL`; `verified_at,created_at timestamptz NOT NULL DEFAULT now()`；UNIQUE(kind,identifier_normalized)、UNIQUE(user_id,kind)，本阶段每用户最多一邮箱一手机；查询 user_id 的索引由第二个 UNIQUE 覆盖。phone CHECK 大陆 E.164；email 由规范化后的服务端校验。将来微信通过迁移扩展 kind/provider subject，不提前虚构 openid |
| `otp_codes` | `id uuid PK DEFAULT gen_random_uuid()`（即 challenge_id）；`channel text! CHECK email/phone`; `target_normalized text!`; `purpose text! CHECK login/link/reauth`; `bound_user_id text? FK users RESTRICT`; `bound_session_id uuid? FK sessions RESTRICT`; `code_hmac bytea! CHECK octet_length=32`; `key_version smallint!`; `state text! CHECK pending/sent/consumed/superseded/failed`; `attempts smallint! DEFAULT 0 CHECK 0..5`; `created_at,expires_at timestamptz!`; `sent_at,consumed_at timestamptz?`; `request_ip_hash bytea!`; `provider_request_id text?`。CHECK expires_at>created_at，业务固定 300 秒；purpose=login 不绑定 user/session，link/reauth 必须绑定；索引 expires_at、(channel,target_normalized,purpose,created_at DESC)；部分 UNIQUE(channel,target_normalized,purpose) WHERE state IN ('pending','sent')，过期行先标 superseded 再重发 |
| `sessions` | `id uuid PK DEFAULT gen_random_uuid()`; `user_id text! FK users RESTRICT`; `created_at,last_seen_at,auth_time,absolute_expires_at,idle_expires_at timestamptz!`; `revoked_at timestamptz?`; `revoke_reason text?`; `created_ip_hash bytea!`; `user_agent_hash bytea?`。CHECK 两个 expiry>created_at；索引 (user_id,revoked_at)、absolute_expires_at、idle_expires_at；UA/IP 只审计，不做易误伤的硬绑定 |
| `session_refresh_tokens` | `id uuid PK DEFAULT gen_random_uuid()`; `session_id uuid! FK sessions RESTRICT`; `token_hash bytea! UNIQUE CHECK octet_length=32`; `created_at,expires_at timestamptz!`; `used_at timestamptz?`; `replaced_by uuid? FK 本表 RESTRICT`。索引 session_id、expires_at；每 session 最多一个 used_at IS NULL 的 token（部分 UNIQUE）；保留已轮换 hash 用于重放检测 |
| `auth_rate_limits` | `scope text!`; `key_hash bytea!`; `window_start timestamptz!`; `window_seconds integer! CHECK >0`; `count integer! CHECK >=0`; `expires_at timestamptz!`；复合 PK(scope,key_hash,window_start,window_seconds)，expires_at 索引。真实 PostgreSQL 原子 UPSERT/锁行存配额，进程重启不能清零 |
| `audit_events` | `id bigint GENERATED BY DEFAULT AS IDENTITY PK`; `occurred_at timestamptz! DEFAULT now()`; `actor_user_id text? FK users RESTRICT`; `session_id uuid? FK sessions RESTRICT`; `team_id bigint? FK teams RESTRICT`; `action text!`; `resource_type text?`; `resource_id text?`; `outcome text! CHECK success/denied/failure`; `request_id text!`; `ip_hash bytea?`; `metadata jsonb! DEFAULT '{}'::jsonb`。索引 (team_id,occurred_at DESC)、(actor_user_id,occurred_at DESC)、occurred_at。metadata 固定 allowlist，不存正文、验证码、完整身份标识或凭据 |

增加 `teams.created_by`、`team_members.user_id`、`tasks.created_by`、`work_logs.owner_id`、`team_invites.updated_by` → users(id) 的 FK（默认 RESTRICT，nullable updated_by 仍可空），导入前先创建所有历史用户占位。assignee 的已有复合 FK 保留。认证表按 users → identities/sessions → otp/refresh → audit 顺序建；sessions 不反向 FK 到当前 token，以免循环建表。

清理：OTP 过期/终态保留 24 小时后清理；rate bucket 到期 48 小时后清理；session/refresh 链在 session 绝对过期后再保留 30 天然后按 FK 顺序清理，先将 audit.session_id 置空；审计默认 90 天（最终留存待确认）。身份/业务数据不跟 session 一起删。维护由明确的定时任务执行，不在 GET 中顺手做批量删除。

序列化：date 始终 `YYYY-MM-DD`，timestamptz 为 ISO 8601 UTC；显示仍 Asia/Shanghai；hours 返回 numeric 的十进制字符串或 null（现有类型允许 number|string），API adapter 保留 Number 转换。bigint 在 DB/driver 层按字符串处理，只在显式 DTO 转换且通过 `Number.isSafeInteger` 后返回当前 UI 所需 number；超界报受控错误，不能全局把 int8 无检查 parseInt。导入显式 id 后设置 identity sequence 到 MAX(id) 后方。

English: Keep all five business tables, constraints and six explicit indexes; move the twelve function behaviors into transactional services. The snapshot defines no triggers. New tables own verified identities, OTPs, revocable sessions, durable quotas and minimal audit history.

## 3. 服务端权限与并发 / Server-side authorization and concurrency

### 3.1 六条 RLS 与 GRANT 的逐项替代 / Policy mapping

| 原安全规则 | 对应服务端检查 |
| --- | --- |
| `teams_select_member` | GET /teams 只返回本人 active membership 关联 team；所有 team 路由 requireActiveMembership |
| `team_members_select_member` | GET /teams/:id/members：调用者 active，返回本队 active+inactive 行；其他队身份信息不返回 |
| `tasks_select_member` | 任务列表、单任务、关联日报读取：先确认任务所属 team 的 active membership；归档不禁止读取 |
| `tasks_insert_member` | 创建任务：调用者 active；created_by=服务端 caller；assignee 为 null 或本队 active 成员；FK 同时兜底 |
| `work_logs_select_member` | 日报列表、按日期查询、任务关联日报：调用者 active；全队可读，包括已停用作者的历史日报 |
| `work_logs_insert_member` | 创建日报：调用者 active；owner_id=caller；关联任务 null 或同队未归档；不可伪造作者 |
| `team_invites` 无 policy、无 authenticated GRANT | 不暴露表读取；仅经有角色校验的 get/reset/create/remove 和受限 code join 服务访问 |
| anon 五表零权限 | 所有业务 API 先认证，未认证 401；健康检查和登录请求除外 |
| teams/members 仅 SELECT；tasks/logs 仅 SELECT+INSERT；均无直接 UPDATE/DELETE | 不提供通用表写接口；更改只允许下面的动作及字段，禁止 team_id/created_by/owner_id/id/version/时间戳 mass assignment；无任务/团队物理删除接口 |
| 函数 EXECUTE 全部对 anon/PUBLIC 收回，new_invite_code 对 authenticated 也收回 | 仅有明确路由；内部生成器/成员角色探测不是公开 RPC；不给外部 DB 用户 EXECUTE 权限 |

旧 SELECT RLS 对外队返回空集合；新集合接口仍可返回空/单行 null 来匹配旧查询，显式团队动作对非成员返回 403。单行 GET 的不存在/不可见均 `{data:null}`，防止枚举；已定位到对象的写动作对非成员返回 403，不返回内容或 current_version。真正不存在的写目标返回 404。仅权限错误不使整个账号会话失效。

### 3.2 每个动作保持的业务规则 / Action rules

- **创建团队**：任意已认证 active 用户；name/display_name trim 后 1..40；固定 Asia/Shanghai；caller 自动 owner；三项操作同事务。无团队更名、删除、主动退队或 owner 转让功能。
- **邀请码**：只有本队 active owner/admin 可 get/reset。码 trim+uppercase；空码 invalid，未知/已重置 invalid_code；不用邀请码推导任意角色。当前生成器为 UUID 的 10 位十六进制（40 bit），schema 虽允许 A-Z0-9，不声称现有生成器使用全部 36 字符。保留格式与碰撞重试，join 加用户/IP 速率限制，日志不记录码。
- **加入**：已登录即可持码加入；首次 display_name 1..40，角色 member。已 active 返回 `ok:false,code:already_member,data:{team_id,role}`，不变角色/姓名。inactive 复用同一行：active=true、role=member、deactivated_at=null、joined_at=now()；非空新姓名替换，否则保留历史名，过长仍拒绝。旧 admin 不会自动恢复。
- **改角色**：caller active owner；target 不是本人、不是 owner、且 active；只允许 admin/member；同角色请求成功但不写。目标缺失/停用 not_found；不授予 owner。
- **移除成员**：owner 可移除其他 admin/member；admin 只可移除 member；不得移除自己、owner、已停用人。原子完成：停用并设 deactivated_at → 本队该人 `status<>'done' AND archived_at IS NULL` 任务 assignee=null、version+1、updated_at=now() → 换邀请码 → 返回解绑数/新码。done 或归档任务保留历史负责人；历史日报、姓名、创建者不改。
- **任务**：任意 active member/admin/owner 都可创建、编辑、归档、恢复任何本队任务，不要求自己是 creator/assignee。归档任务不能普通编辑（invalid），但可读和恢复；恢复时负责人 inactive 则置 null。重复归档/恢复仍按原 RPC 成功推进一次 version。文本、日期、状态合法性在服务端重验；update 的状态权威：todo→0、done→100、in_progress 把 progress 夹到 1..99（100→99）。前端 `progressForStatus` 切状态会把原 0/100 设为 1，这是不同层的已有规则，均保留；不误称二者完全相同。
- **日报**：全队 active 成员可读；只有作者且仍 active 才能改/删，owner/admin 也无例外。owner_id 不变，owner_name 为创建时快照且更新不变；兼容现有创建 body 的 owner_name 展示值（trimmed 1..40，不作为身份依据）。每人每队每天最多一篇，重复创建/改日期撞键均 already_exists，不 upsert 覆盖。新建或更换关联任务要求同队未归档；不变的原关联允许已归档；设 null 可解除关联。工时 null/空或 0..24、最多两位小数；文本 trim，今日完成/明日计划 1..2000，problems 可空且<=2000。无额外“只能今天写”限制。
- **创建字段加固**：源 INSERT 的表级权限实际上未限制可写列，故除前端预校验外，某些长度/初始版本/归档/时间戳还可被直连客户端指定。新 API 仅接收现有 UI 使用的 draft 字段，拒绝多余字段，服务端生成身份/版本/时间。这是关闭绕过入口，不扩大任何业务权限。

### 3.3 原子性、撤权与锁顺序 / Atomicity and locking

所有 task/log 更改、归档、删除必须带正整数 `expected_version`；锁行后比较，不匹配返回 **409 conflict + data.current_version**，不覆盖、不加版本、不进行后续副作用。成功原子 version+1。无 force 参数；用户确认保留内容后仍必须带刚读取的版本，遇到第三方再次更新仍 409。

采用同一锁顺序：确定 team（ID 查询只用于定位，尚不返回内容）→ 锁 team → 重读 caller active/role → target membership → 按 id 顺序锁 task/log → 版本及字段验证 → 写及审计 → commit。小规模阶段，队内业务写/成员变更/换码使用 team 行 `FOR UPDATE`，简化 join/remove/assign/archive 竞态；队内读取可用短事务 team `FOR SHARE` + 权限查询。GET /teams 用单 SQL JOIN 当前 active membership，不跨请求缓存角色。join 查码定位 team 后取得 team 锁并重查码，防止换码同时加入；唯一键处理首次并发加入，不能仅依赖“锁到不存在行”。事务保持短小，不持锁调用邮件/SMS。

已移除者在移除 commit 后的下一请求立即无权限，即使 access JWT 尚有效；已执行中的请求可能先于移除完成，按事务先后排序，不承诺从浏览器抹去已下载内容。所有 API 先验 JWT/session，再按 DB 当前 membership 授权；会话失效与业务撤权分开。

English: Authorization comes from current database membership, never client claims. Task access is collaborative; work-log writes are author-only. Team and row locks preserve removal, invite rotation and optimistic-concurrency semantics.

## 4. 邮箱/手机认证与会话 / OTP authentication and sessions

### 4.1 规范化与账号关联 / Normalization and linking

- phone：去空格/连字符后仅接受 `^1[3-9][0-9]{9}$` 或 `^\+861[3-9][0-9]{9}$`，存 `+86`+11 位；不接受非大陆、分机、任意前缀截断。前后端同规则。
- email：trim，拒绝控制字符/CRLF、多地址、无效地址、超长（总长<=254）；本阶段接受 ASCII mailbox，domain lowercase，local-part 也 lowercase，明确作为本站不区分大小写账号约定；不去 `+tag`、不合并点号、不采用 Gmail 专有规则。国际化邮箱另议；不要在导入时未检查碰撞就改大小写。
- 首次验证某 identity 后，在同一真实 DB 事务中查找/创建 user+verified identity+session；UNIQUE 防并发重复创建。未知 email/phone 均允许注册，发码不透露“已注册”。email 与 phone 是独立 identity，**不凭姓名、相似地址或客户端提交 userId 自动合并**。
- 后续绑定另一渠道：已登录且最近 10 分钟完成本人现有 identity 的 OTP 认证；若过期，先 purpose=reauth 验本人已有渠道，更新本 session.auth_time。再请求 purpose=link，challenge 绑定 user+session+target，验新渠道后原子插入 identity，不新建 user。已绑定同一 user 可幂等成功；属于另一 user 时返回泛化 `409 identity_unavailable`，不暴露对方资料，不自动合并账号。一个 user 最多一邮箱一手机；换绑、解绑、丢失全部身份后的人工恢复需另行设计，首版不开放。

### 4.2 发码、验码及枚举抵抗 / Request and verify

1. request 校验 channel/target/purpose 与 CSRF；link/reauth 额外验证当前 session。按规范化目标、可信 IP 和全局预算在 PostgreSQL 原子预占配额。登录不先查询账户存在性；响应形状/流程对新老账号一致。
2. `crypto.randomInt(0,1_000_000)` 生成补零 6 位代码；challenge 为随机 UUID；有效期固定 **5 分钟**。持久化 `HMAC-SHA256(OTP_HMAC_SECRET, version || challenge || purpose || channel || normalizedTarget || boundUser || boundSession || code)`，字段使用无歧义分隔/长度编码；保存 key_version。密钥至少 32 随机字节，仅服务端。普通无密钥 SHA256 对低熵 OTP 不够。
3. 同目标/用途只保留一个 pending/sent challenge。重发使旧码 superseded，旧码即使未满 5 分钟也不可用；配额锁与部分唯一键避免并发多码。pending 行落库后才调用 provider；不在数据库事务中等待公网。
4. provider 接受后仅将仍为 pending、未过期的同一 challenge 原子改为 sent（不能让迟到回执复活已 superseded 的码），返回 **202 `{challenge_id,expires_in,retry_after}`**，expires_in 最大 300 秒、retry_after 初始 60 秒，均按剩余期限计算，统一文案“若地址/号码可接收，将收到验证码”。这只表示服务商接受，不保证最终送达。失败/超时 state=failed、返回 503 delivery_unavailable，绝不假成功；失败预占的防刷额度不回退。provider 成功而进程崩溃在 sent 更新之前时，不把 pending 当可验证，用户等待 cooldown 后重试。
5. verify 使用 challenge_id+code；不信任客户端再传 target/purpose。查 row `FOR UPDATE`，校验 sent、expires_at、绑定、attempts<5；对候选码重新 HMAC，用固定 32 字节 buffer 的 `crypto.timingSafeEqual`。未知/过期等也做 dummy HMAC/比较；返回统一 `invalid_code` 文案，不区分不存在/过期/已用/错误/超限。
6. 每 challenge 最多 **5 次**失败；有效 challenge 的格式错误也计入尝试，verify 全部请求另受 IP/目标配额限制。成功标 consumed 并创建/更新身份与 session 同事务；并行提交同码只能一次成功。绑定需重验 live session 和 user，不能把登录码拿来绑定另一个账号。

发码响应无 `isExistingUser`；错误正文不回传目标是否存在、provider 原始账户信息或敏感参数。不刻意针对已有账号返回更快分支；延迟仅做小范围统一化，不能声称网络时延完全恒定。

### 4.3 初始限额 / Initial rate limits

这是待观察调整的配置基线，不是云厂商默认额度。目标维度跨 IP、跨 login/link/reauth 共用，避免换用途绕过。

| 范围 | 初始额度 |
| --- | --- |
| 发送：每规范化 target | 间隔至少 60 秒；5 次/小时；20 次/日 |
| 发送：每 IP | 10 次/分钟；30 次/小时；100 次/日 |
| 验证：每 challenge | 5 次失败后封闭该 challenge |
| 验证：每 target | 20 次失败/小时；达到后暂停该目标验码到窗口结束 |
| 验证：每 IP | 30 次/分钟；300 次/小时；1000 次/日 |
| 全站 provider 预算 | SMS 500 次/日、email 1000 次/日，达到返回 429 并告警；上线按真实注册量调整 |
| 邀请码 join | 每 user 10 次/分钟、100 次/日；每 IP 30 次/分钟、300 次/日 |
| 一般 API | 已认证 user 120 次/分钟，匿名 IP 60 次/分钟；健康探针单独配置 |

短窗口为明确固定时间桶，日桶按 Asia/Shanghai 自然日；不会承诺严格滚动窗口。429 有 `Retry-After`（秒）。`@fastify/rate-limit` 使用 PostgreSQL-backed store（依安装版本实现其文档要求的 incr/child/read 等接口）；目标+IP+预算多维预占在 auth service 事务中完成，不能靠多个独立进程内计数器。IP 只信受控 Caddy hop，拒绝伪造 X-Forwarded-For 绕限；IPv6 按 /64 聚合，IP/target 的限额键用独立 `RATE_LIMIT_HMAC_SECRET` HMAC，避免日志存完整目标。

### 4.4 JWT、cookies、refresh、me、logout 与 CSRF / Session lifecycle

- access JWT：有效 **10 分钟**；固定允许算法（计划 HS256）、独立强随机 `JWT_ACCESS_SECRET`；验证签名、iss=`https://jeayon.com`、aud=`daily-work-api`、exp/iat、sub=user.id、sid=session.id、jti；不装手机号、邮箱、团队角色或 refresh secret。使用成熟 JWT 库（如 jose，实施时锁定兼容版本），不手写签名算法。每个受保护请求还查询 session 未撤销、idle/absolute 未过期及 users.status=active，支持即时 logout/禁用。
- refresh：32 字节随机 secret，cookie 内容是 token-row-id + secret；DB 只存 SHA256 token hash。高熵 token 与低熵 OTP 不同，可安全用无密钥 hash。session **绝对 30 天、闲置 7 天**，成功刷新延长 idle 到 min(now+7d,absolute)，绝不延长 absolute。
- 两个凭据均为 httpOnly cookie：生产 `__Secure-dwa_access` Path=`/api` Max-Age=600；`__Secure-dwa_refresh` Path=`/api/auth` Max-Age 不超过 idle/absolute 剩余时间；都 `Secure; SameSite=Lax`。**Domain 不设置**，因此是仅 `jeayon.com` 的 host-only cookie；app 在 `/`、API 在 `/api` 无需 `.jeayon.com` 的跨子域 cookie。www 若启用仅重定向 canonical host。不使用要求 Path=/ 的 `__Host-` 前缀与上述路径矛盾配置。[@fastify/cookie 官方属性说明](https://github.com/fastify/fastify-cookie)。
- `GET /auth/me` 只返回 AppSession 元数据 `{user:{id,name?,email?,phone?,isAnonymous:false},expiresAt}`（expiresAt 为 Unix 毫秒），不回 access/refresh token；无有效 access 返回 401。bootstrap/普通 fetch 捕获 401 后，最多一次 `POST /auth/refresh`，成功再重发原请求；服务端在任何业务副作用前完成认证，故只重试认证前拒绝的请求，不重试网络超时后的不确定写入。普通 403、409、5xx 不触发 refresh/登出。
- refresh 在事务中锁 session+token；有效当前 token 标 used、生成替代 token、签发新 access，再 Set-Cookie；旧 hash 留存。每 tab 单飞 refresh，跨 tab 优先用 Web Locks 协调；服务端处理极短并发（5 秒内旧 token）返回 `409 refresh_conflict`，不发新 token、不清 cookie、不立即撤销赢家 session；客户端等待在途刷新后重读 me，一次失败则重登。窗口外已使用 token 重放撤销该 session 全链并 401。旧 token 不可获得第二套凭据；网络丢失 Set-Cookie 可能需重登，作为已知取舍，不无限宽限。
- logout：POST，若有可识别 session（access 或 refresh）则撤销，重复/无 cookie 也成功，清两个 cookie（匹配 Path/flags）。其他设备 session 不受影响。前端先 invalidate 在途结果；网络失败可清 UI，但 JS 无法清 httpOnly cookie，须显示“服务器退出未确认，请重试”，不能吞错后宣称已撤销；页面重载仍可能恢复 session。断网不等于服务器 logout。
- CSRF：所有 POST/PUT/PATCH/DELETE（含发码、验码、refresh、logout、link）必须 JSON Content-Type、`X-DWA-CSRF: 1` 自定义头、**Origin 严格等于 APP_ORIGIN**；缺失/`null` Origin 也拒绝，非浏览器测试需显式提供。拒绝不在白名单的预检，不开跨域凭据 CORS；SameSite=Lax 是附加保护，不能替代 Origin 校验（同站子域仍可能有风险）。GET 无业务状态变更、认证响应 `Cache-Control: no-store`。参见 [OWASP custom header 与 Origin 防护](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。
- dev：仅 NODE_ENV=development + loopback 的 HTTP APP_ORIGIN 允许 Secure=false，cookie 使用不带 `__Secure-` 的开发名、Domain 仍省略；前端只访问 Vite origin，经 `/api` proxy，不能混用 localhost 与 127.0.0.1。生产启动拒绝 HTTP origin、弱/缺失 secrets、不安全 cookie 配置。auth 状态/业务数据不放 localStorage；现有主题、选队偏好可保留。跨 tab 用无凭据 BroadcastChannel 通知重读 me，不广播 token。

English: Use six-digit, five-minute, single-use HMAC-protected OTPs with durable quotas. Tokens stay in secure host-only cookies; short JWTs are backed by revocable database sessions. Linking requires proof of both the existing account and the new identity.

## 5. OTP 服务商接口与配置 / Delivery provider interfaces

下列为**新建接口的设计**，不是声称第三方 SDK 已有这些方法：

```ts
type DeliveryReceipt = { providerRequestId: string; messageId?: string }
interface EmailSender {
  sendCode(input: {
    to: string; code: string; expiresMinutes: number; challengeId: string
  }): Promise<DeliveryReceipt>
}
interface SmsSender {
  sendCode(input: {
    toE164: string; code: string; expiresMinutes: number; challengeId: string
  }): Promise<DeliveryReceipt>
}
```

- 生产 EmailSender：Tencent Cloud **SES**，中国站 `SendEmail`，`ses.tencentcloudapi.com`；使用已配置的发信人、主题及 `Template:{TemplateID,TemplateData}`（JSON 字符串），验证码放 template variables。凭据/region/from/template 仅 env；不允许浏览器指定模板、主题或发件人。只把真实服务商接受回执视为 accepted，失败抛受控错误。[SES SendEmail 官方 API](https://cloud.tencent.com/document/api/1288/51034)、[Template 字段大小写](https://cloud.tencent.com/document/api/1288/51053)。
- 生产 SmsSender：Tencent Cloud SMS `SendSms` 2021-01-11，`sms.tencentcloudapi.com`；内部 env `TENCENT_SMS_SDK_APP_ID` 映射云 API 的 **`SmsSdkAppId`**（不是猜写 `SdkAppId`），另有 `SignName`、`TemplateId`、单个 E.164 `PhoneNumberSet` 和按审批模板顺序填的 `TemplateParamSet`。必须同时检查 SDK/传输错误及 `SendStatusSet` 对该号码的 Code=Ok；HTTP 200 不等于发码成功。接受不代表已送达。[SMS 官方 API](https://cloud.tencent.com/document/api/382/55981)。
- 初始化 zod 校验 `EMAIL_PROVIDER=tencent_ses|console`、`SMS_PROVIDER=tencent_sms|console`；只有 **NODE_ENV=development** 可选 console。NODE_ENV=production 或 test 选 console 一律启动失败；生产缺 env、无效配置不能自动 fallback 到 console。dev console 在专用本机输出中显示真实生成码，仍走真实 PostgreSQL 验码/session，不提供固定通用码、绕过登录或伪造 DB。生产日志绝不输出 OTP；测试用预置的真实 HMAC fixture 验证协议，不能把 console 当生产验收。
- 官方腾讯 Node.js SDK 的具体包/子模块版本在实施时从其官方声明确认并锁定；本文件只确定已核实的 API 操作和字段，不猜构造函数签名。网络超时、退信/发送失败、模板不匹配、余额/配额不足要可观察；不自动无限重试，避免重复扣费/多条短信。

English: Delivery adapters are server-only. Production requires genuine Tencent SES/SMS acceptance; a console adapter is explicitly development-only and cannot be a production fallback.

## 6. REST API 契约 / REST endpoint contract

统一前缀 `/api`。成功 `{ok:true,code:'ok',message,data}`；失败 `{ok:false,code,message,data?}`，同时使用真实 HTTP 状态。业务行字段保持现有 snake_case/nullable/date/version；读数组 `data:Row[]`，maybe single `data:Row|null`。新写接口返回**完整** TaskRow/WorkLogRow（含 created_at），避免原 RPC 返回局部对象却被断言为完整行的问题。请求均 strict zod，拒绝额外可伪造字段；body 限制初始 32 KiB。

简称：S=有效 session/user，M=本队 active 任意角色，A=本队 active owner/admin，O=owner，L=本人日报作者且 M。认证失败先于业务写入；所有变更遵守 §4 CSRF。

| Method path | Body / query | data / 状态 | 权限、专属错误 |
| --- | --- | --- | --- |
| POST `/auth/otp/request` | `{channel:'email'\|'phone',target,purpose:'login'\|'link'\|'reauth'}` | `{challenge_id,expires_in,retry_after}` / 202，按剩余期限计算（上限 300/60 秒） | login 公开；link/reauth=S；400 invalid，429 rate-limited，503 delivery_unavailable；reauth 只能用当前用户已有 identity，失败不暴露归属 |
| POST `/auth/otp/verify` | `{challenge_id,code}` | AppSession / 200 + cookies | 仅 login challenge；400 invalid_code，429；缺失/过期/已用统一失败 |
| POST `/auth/reauth/verify` | `{challenge_id,code}` | `{auth_time}` / 200 | S，purpose=reauth 且绑定同 user/session；400 invalid_code |
| POST `/auth/identities/verify` | `{challenge_id,code}` | `{kind,identifier_masked,verified_at}` / 200 | S + recent auth，purpose=link，同 user/session；400 invalid_code，403 reauth_required，409 identity_unavailable |
| GET `/auth/me` | 无 | AppSession / 200 | S；401 unauthenticated；无续期副作用 |
| POST `/auth/refresh` | `{}`，refresh cookie | AppSession / 200 + 新 cookies | 当前有效 refresh；401 unauthenticated，409 refresh_conflict，429 |
| POST `/auth/logout` | `{}` | `null` / 200 + 清 cookies | 幂等，识别到 session 则撤销；无 session 也成功 |
| GET `/auth/identities` | 无 | `[{kind,identifier_masked,verified_at}]` | S；便于后续账号绑定设置，不返回别人的 identity |
| GET `/teams` | 无，不接任意 userId | `[{team_id,role,display_name,joined_at,teams:TeamRow}]` | S，限本人 active membership；joined_at ASC |
| POST `/teams` | `{name,display_name}` | `{team_id,name,role:'owner',invite_code}` / 201 | S；400 invalid |
| POST `/teams/join` | `{code,display_name}` | `{team_id,name,role}` / 200 | S；400 invalid/invalid_code；409 already_member，仍带 `{team_id,role}`，adapter 转成现有 JoinResult.already |
| GET `/teams/:teamId/members` | 无 | TeamMemberRow[]，含 inactive | M；不可见 team 返回空数组；joined_at ASC |
| GET `/teams/:teamId/invite-code` | 无 | `{team_id,invite_code}` | A；403 forbidden；缺邀请码 404 not_found；no-store |
| POST `/teams/:teamId/invite-code/reset` | `{}` | `{team_id,invite_code}` | A；403 forbidden；旧码 commit 后失效 |
| PATCH `/teams/:teamId/members/:userId/role` | `{role:'admin'\|'member'}` | `{user_id,role}` | O + 非本人/非 owner/active target；400 invalid，403 forbidden，404 not_found |
| POST `/teams/:teamId/members/:userId/remove` | `{}` | `{user_id,unassigned_tasks,invite_code}` | 按 §3 owner/admin 规则；403 forbidden，404 not_found；不是物理 DELETE |
| GET `/teams/:teamId/tasks` | `?scope=active\|archived`，默认 active | TaskRow[]；active: due_date ASC,id ASC；archived: archived_at DESC,id DESC | M；不可见 team 空数组；无默认截断以保持当前统计/甘特完整性 |
| POST `/teams/:teamId/tasks` | `{title,description:null\|string,assignee_id:null\|string,status,progress,start_date,due_date}` | TaskRow / 201 | M；assignee active 同队；400 invalid；created_by/version/times 不可传 |
| GET `/tasks/:taskId` | 无 | TaskRow 或 null | S+对象 team 的 M；不存在/不可见同为 null；含归档 |
| PUT `/tasks/:taskId` | 完整 task draft snake_case + `{expected_version}`，不带 team_id/created_by | TaskRow | M，不限 creator；归档 400 invalid；409 conflict |
| PATCH `/tasks/:taskId/archive` | `{archived:boolean,expected_version}` | 完整 TaskRow | M；409 conflict；恢复时清 inactive assignee |
| GET `/teams/:teamId/tasks/:taskId/logs` | 无 | `[{id,owner_id,owner_name,work_date,done_today,version}]` | M且 task 同队；不可见/不匹配返回空数组；work_date DESC,id DESC；可查归档 |
| GET `/teams/:teamId/work-logs` | `?limit=300` 默认/上限 300；可选 `owner_id=me&work_date=YYYY-MM-DD` | 普通查询 WorkLogRow[]；指定 me+date 时 WorkLogRow 或 null | M；指定 me 时 owner 从 session 取；普通 work_date DESC,updated_at DESC,id DESC；没有暗加 60 天条件 |
| POST `/teams/:teamId/work-logs` | `{owner_name,work_date,done_today,problems:null\|string,plan_tomorrow,hours:null\|string\|number,related_task_id:null\|number}` | WorkLogRow / 201 | M，owner_id=caller；400 invalid，409 already_exists |
| PUT `/work-logs/:logId` | 完整可编辑 log draft + `{expected_version}`，无 owner_name/owner_id/team_id | WorkLogRow | L；400 invalid，403 forbidden，409 conflict/already_exists |
| DELETE `/work-logs/:logId` | JSON `{expected_version}` | `{id}` / 200 | L；409 conflict；删除仅日报，经过 CSRF，不将版本放 URL |
| GET `/health/live` | 无 | `{status:'ok'}` / 200 | 公开最小状态，不含配置/版本/凭据 |
| GET `/health/ready` | 无 | `{status:'ok'}` / 200 或 `{status:'unavailable'}` / 503 | 内部探针，DB `SELECT 1` + migration 版本就绪；对外不回数据库详情 |

共通错误：400 `invalid`（格式、CHECK/FK、无效负责人/关联）；401 `unauthenticated`（唯一触发会话失效的分类）；403 `forbidden` / `reauth_required` / `csrf_rejected`；404 `not_found`（已授权路径的缺失资源）；409 `conflict`（`data:{current_version}`）、`already_exists`、`already_member`、`identity_unavailable`、`refresh_conflict`；429 `rate-limited` + Retry-After；503 `delivery_unavailable`/`backend-unavailable`；500 `unknown` + request_id，无 SQL、stack、凭据。PG 23505→already_exists（业务唯一键）、23503/23514→invalid；未知错误不伪装为空结果。

adapter 读取非 2xx JSON 后再抛 AppError，保留 code/message/data（尤其 already_member、current_version）；不把所有 409 变成普通 network，也不把 403 当 logout。无需开放任意 table filters、`rpc/:fn`、原始 SQL 或写入 headers。

English: Keep existing row/envelope shapes while using explicit routes and meaningful status codes. Version conflicts are HTTP 409, never silent success or authentication expiry.

## 7. 服务端栈、迁移与测试 / Stack, migrations and testing

- **Node 24 + TypeScript + Fastify**：本机指定 `/opt/node24/bin`；ESM、strict TS；Fastify 的 lifecycle hooks 统一认证、Origin、错误、日志与 readiness，`inject()` 可测真实 HTTP 路由。实施时固定受支持 Fastify 主版本及匹配插件版本，不凭 latest 装混合版本。[Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/)。
- **PostgreSQL 16 + pg + Kysely**，选择 Kysely 而非 Drizzle：现有 schema 是权威 SQL，复合 FK、显式锁、约束、事务最重要；Kysely 保持 SQL 可读、类型化查询、不需要为少量表引入另一套关系/自动推导 schema。DDL 用显式 SQL/Kysely migration，避免自动 diff 改坏导入约束；不是为了同时使用两个 ORM。pool 初始 max=10、连接超时与 statement_timeout 有界；事务内权限检查和写共享同一 connection。[Kysely migrations](https://www.kysely.dev/docs/migrations)。
- **zod**：env/request/response DTO 校验；所有 body strict，日期需真实日历 round-trip 而非单 regex，数字/nullable 不通过任意 JS coercion；金额无关但工时不走不受控浮点格式化。**@fastify/cookie** 管 cookie；**@fastify/rate-limit** + 持久配额；**pino** JSON 日志、request_id、状态/耗时、provider receipt。redact Cookie、Set-Cookie、Authorization、code、target、keys、body 正文；关闭不受控 request/response body 日志。
- 后续 `server/` 最小模块：config、db/migrations、auth（otp/session/providers）、teams、tasks、logs、http/errors、tests；不加 Redis、消息队列、微服务、fake repository 或 localStorage backend。邮件/SMS 不在 DB 锁中发送；无需本阶段通用 job framework。
- migrations：001 users/auth 及配额审计 → 002 五表原约束/索引、去 WBCS auth defaults、添加 users FK → 003 经验证的加固约束。使用 Kysely Migrator 的锁/历史表，一次受控迁移任务，API 启动只检查 schema 版本，不让每个副本自动运行 DDL。迁移不可引用未来可变业务类型；不直接重跑 db-schema.sql。建库/角色需独立预备步骤，不能靠 migration 擅自覆盖已有库。
- **node:test + tsx**，与现有前端一致；服务端集成测试连接真实 `TEST_DATABASE_URL`，不使用 SQLite、内存数据库或 fake auth。dev 只读 `DATABASE_URL`；test 必须显式 TEST_DATABASE_URL，dbname 必须为允许的 dwa_test，且与 dev/prod URL 不同；缺失/不可连即失败，不自动 fallback。测试 schema/fixture 在隔离测试库中，清理策略只作用于已确认测试库，实施前不对现有库执行清理。
- native dev：原生 PG16 启动由后续实施前的运维步骤处理；本步骤不 sudo、不启动集群、不修改角色/数据库。本机无 Docker，因此不要写“运行 docker compose 即可本地验证”。生产 compose 可在有 Docker 的目标主机验证。
- 有意义的服务端测试：四种身份 owner/admin/member/outsider、inactive 旧 session 全矩阵；raw body 伪造 team/author/role/初始 version/时间被拒；并发 task/log 更新与 archive/delete，两个真实连接基于 v1 只能一方成功；重复日报同时创建只有一篇；remove 与 assign/join/role 竞态、换码后旧码失败、重新加入降 member、历史名称/关联保留；跨团队关联和 inactive assignee 拒绝。
- 认证测试：同码并行一次消费、expiry=300s 边界、5 次失败、重发旧码、purpose/session 绑定、所有配额跨重启不失效、identity 大小写/phone 归一与并发唯一、link 不能抢占已有 identity、refresh 轮换/并发/重放、logout 后 access 立即失效；缺 Origin/假 Origin/缺 header/表单提交均拒；生产 console/missing secrets 启动失败。测试可预置已知 HMAC 的 OTP fixtures，但会话由真实 verify handler 与真实 DB 建立，不能添加“测试用户免认证”路径。
- 单测验证 provider 参数/错误映射；真实 SES/SMS 端到端验收须获准的邮箱/手机号及正式配置，记录服务商接受与实际收到，不以测试 fixture 代替可达性证据。

English: Kysely fits the existing SQL-first schema and explicit locking. Integration tests must use the real, isolated native PostgreSQL test database; missing database connectivity must fail visibly.

## 8. 前端迁移与验收顺序 / Frontend migration and checks

| 文件 | 后续最小变更 |
| --- | --- |
| `src/lib/cloud.ts` | 在原位置替换为统一 `/api` fetch/auth 客户端（或等价改名后更新所有引用），credentials='same-origin'；JSON/CSRF/错误/401 单飞 refresh；无 SDK 与前端 secret |
| `src/lib/db.ts` | 移除 QueryBuilder/raw.database，改薄的 `apiGet/apiMutation/expectEnvelope` 等明确请求；不仿造全套 PostgREST DSL；保留错误必抛、null/rows 语义 |
| `src/auth/api.ts` | email/phone 的 request/verify、reauth/link、logout/me/refresh；自有 challenge 类型，不保留 SDK 的 verify 方法闭包/已注册标记；沿用 phone normalization |
| `src/auth/AuthProvider.tsx` | 用 AppUser/AppSession 替换 SDK 类型和事件；保留 dataEpoch/expireSession/UI cleanup；显式处理 logout 失败、refresh、跨 tab 通知 |
| `src/auth/LoginPage.tsx` | 保留布局、busy/error/cooldown 交互，增加 email/phone 渠道切换并使用服务端 retry_after；固定 6 位码；微信入口标稍后提供/隐藏，不指向 WBCS |
| `src/auth/callback.ts` | 取消旧微信 Relay 兑换；本阶段无 OAuth exchange，不为了移除依赖保留空成功实现；后续独立实现自有 callback |
| `src/main.tsx`, `src/App.tsx` | 去 CloudSession import；启动 me/refresh 再 render，移除旧 callback 依赖，保留 guard/HashRouter |
| `src/teams/api.ts` | 显式 REST 调用，保留导出的 TeamSummary/JoinResult 和函数签名以减少组件变化；userId 参数仅为兼容，实际身份由 session 决定；already_member 单独映射 |
| `src/tasks/api.ts`, `src/logs/api.ts` | REST body allowlist/空字符串→null/数字字段适配；保留 exported draft/functions，expected_version 必传；新 API 完整行返回；归档查询直接 scope=archived |
| `src/lib/errors.ts`, `src/types/db.ts` | 自有 AppSession/AuthChallenge/ErrorCode 类型；保留 conflict/forbidden/already_exists、401-only expiry；补 rate-limited/backend-unavailable 等新错误；不要把所有失败吞成 rows=[] |
| `src/config/publicConfig.ts` | 去 WBCS resource/endpoint/key/Relay，公开值仅 API_BASE='/api'（可直接常量，避免不必要配置）；所有腾讯 secrets 留 server env |
| `vite.config.ts` | dev proxy `/api`→`http://127.0.0.1:8787`，保留 `/api` 前缀；dev origin 固定 http://127.0.0.1:5183；allowedHosts 收紧到开发已知主机；移除 WBCS sharecode loader，恢复标准静态资源引用 |
| `app/package.json` + 实际锁文件 | 本副本移除 `@tencent-ai/workbuddy-cloud-sdk`，用包管理器更新锁文件；不手工删除 node_modules/文件；本步骤不做此操作 |
| `README.md`, `docs/acceptance.md`, env example | 后续记录新 auth/API/本地启动/配置与真实验证状态；原 db-schema.sql 保留为来源快照，新增迁移说明，不能把快照改成假装新库已上线 |

任务/日报/团队页面及 Dashboard/Gantt 的业务布局、自然日函数、进度/统计与请求代次 guard 原则上保持。仅在契约需要时做小改；已发现 LogDrawer 冲突后按用户已编辑的日期重读可能找不到原日志、TaskDrawer 关联日志失败被吞成空列表，列为既有问题，不在迁移中顺手重构。

dev proxy 规划片段（不是当前配置）：

```ts
server: {
  proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } }
}
```

不 rewrite `/api`，浏览器 cookie 绑定 Vite origin；服务端开发 APP_ORIGIN 与浏览器一致。Vite proxy 依据[官方 server.proxy 配置](https://vite.dev/config/server-options.html#server-proxy)。生产不运行 vite dev/preview。

测试变更：现有 permissions/conflict 的权限含义与冲突判定保持；保留 SQLSTATE 映射回归，新增 HTTP 409/403/401、非 2xx 信封、already_member 的 adapter 测试。dates/progress/stats/gantt-scale 不改判定。补 request guard/refresh/logout 与真实浏览器 cookie 验证，服务端测试承担安全边界，不能只靠 UI 单测。

实施批次 / Steps → verification：

1. 原生 dev/test DB 连通与迁移 → schema/约束、非 owner runtime 权限核验。
2. 邮箱/SMS adapters、OTP/session/auth endpoints → DB 集成测试 + 开发实际收码，再确认生产 provider。
3. 团队/任务/日报服务与 REST → 全权限矩阵、真实并发/唯一约束/撤权测试。
4. 前端薄层与登录渠道切换、移除 SDK → typecheck、50 个既有用例、adapter/browser tests、生产 build；全源码及 bundle 检索无 WBCS 依赖。
5. Compose/备份恢复/健康检查 → 目标机 staging 验证，再按备案和切换决定安排上线；当前步骤不部署。

English: Replace transport and auth types at the boundary, retain page behavior, and migrate one verified layer at a time. The SDK also appears in main.tsx/App.tsx, so changing only api.ts files would be incomplete.

## 9. 生产部署与运行手册 / Deployment and operations

### 9.1 Compose 拓扑与文件 / Production topology

后续交付 `compose.yaml`、Caddyfile、api/frontend 多阶段 Dockerfile、`.dockerignore`、server env examples、`scripts/backup.sh`、restore runbook；本步骤不创建这些文件。

| 服务 | 职责与持久化 |
| --- | --- |
| `caddy`（Caddy 2，实施时固定 patch/digest） | 唯一发布 80/443；HTTPS 自动证书；挂载前端 dist 只读，Caddy data/config volume 保证证书重启保留；`/api`、`/api/*` reverse_proxy api:8787，其他静态资源 file_server；api 404 不能落 SPA HTML |
| `api`（Node 24 镜像固定 patch/digest，非 root） | 监听容器 0.0.0.0:8787，不映射公网端口；依赖 postgres healthy；最小生产依赖、只读根文件系统/可写 tmp、graceful shutdown、restart policy；DB pool 有界 |
| `postgres`（PostgreSQL 16 镜像固定 patch/digest） | 命名 volume pgdata；不发布公网 5432；只内部网络；pg_isready 健康检查；生产随机 credentials，独立 migrator/runtime/backup 角色 |

可用边缘网络连接 caddy↔api、内部 DB 网络连接 api↔postgres，Caddy 不需接 DB 网络；API 仍需出站 HTTPS 到 SES/SMS。migrate 是一次性受控命令，不在每个 API 副本并行跑；Compose service_healthy 只是启动顺序，运行时仍处理断连。镜像拉取/依赖下载在国内目标机的可达性需要预演，不假设 Docker Hub 永远可用。

Caddy 配置规划（保留 `/api` 前缀，用 `handle`，不用会剥前缀的 `handle_path`）：

```caddyfile
jeayon.com {
    encode zstd gzip
    @api path /api /api/*
    handle @api {
        reverse_proxy api:8787
    }
    handle {
        root * /srv/app
        try_files {path} /index.html
        file_server
    }
}
```

HashRouter 不要求业务路径 rewrite；fallback 仅留给 SPA。为 `/assets/*` 单独配置缺失即 404，不能把缺少 JS 的请求返回 HTML；HTML no-cache、带 hash 资源长期 immutable；API private/no-store。反代 IP 仅信实际 Caddy 网络来源，不 `trustProxy:true` 无边界信任任意头。配置样式参考 [Caddy API+SPA 模式](https://caddyserver.com/docs/caddyfile/patterns)。目标环境须实测 DNS、80/443、ACME 连通性与证书续签。

### 9.2 Env 文件与密钥 / Environment contract

仅示例文件进入版本管理，真实 env 不进仓库/镜像/前端构建，权限 0600；Compose 显式 `env_file` 注入 API，不能误以为顶层 `.env` 会自动注入所有服务。dev 与 prod 分离。

| 类别 | 规划变量（本应用定义，待实现校验） |
| --- | --- |
| Runtime | `NODE_ENV`, `HOST`, `PORT=8787`, `APP_ORIGIN`, `LOG_LEVEL` |
| DB | `DATABASE_URL`, `TEST_DATABASE_URL`（只测试环境）, `MIGRATION_DATABASE_URL`（仅迁移任务）, pool 参数如需才开放；Compose 的 `POSTGRES_DB/USER/PASSWORD` 仅初始化/管理，不把超级用户口令给 API |
| Auth | `JWT_ACCESS_SECRET`, `OTP_HMAC_SECRET`, `OTP_HMAC_KEY_VERSION`, `RATE_LIMIT_HMAC_SECRET`，全部独立且强随机；access/idle/absolute TTL 按本文固定，不增加首版不必要配置开关 |
| Provider selection | `EMAIL_PROVIDER=tencent_ses`, `SMS_PROVIDER=tencent_sms`；开发可显式 console，生产禁止 |
| Tencent credentials | `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`（最小 CAM 专用子账号；如拆分两渠道账号则显式分开配置，不能使用主账号密钥） |
| SES | `TENCENT_SES_REGION`（计划 ap-guangzhou，实施前核对账号支持区域）、`TENCENT_SES_FROM_EMAIL`, `TENCENT_SES_TEMPLATE_ID`, `TENCENT_SES_SUBJECT`；模板变量名按批准模板固定 |
| SMS | `TENCENT_SMS_REGION`, `TENCENT_SMS_SDK_APP_ID`, `TENCENT_SMS_SIGN_NAME`, `TENCENT_SMS_TEMPLATE_ID`；TemplateParamSet 顺序按审批模板固定 |
| Quotas/backup | 实施时仅开放必要的 `OTP_EMAIL_DAILY_CAP`、`OTP_SMS_DAILY_CAP`；备份使用独立受保护 DB 连接、备份目录、保留天数、异机目的地配置，不放 VITE_* |

`.env.example` 仅 placeholder；local dev 的已提供 URL 可在开发说明出现，但生产 example 不含可用 secret。cookie 安全属性从 NODE_ENV+APP_ORIGIN 推导，生产不提供一键绕过开关。轮换 JWT key 需安排已登录用户重登或明确双 key 过渡；轮换 OTP key 保留旧 key 至最长 5 分钟挑战结束，不能丢失版本对应。

### 9.3 备份、恢复、探活和日志 / Backup, restore and monitoring

- 后续 backup.sh：`set -euo pipefail`、umask 077、flock 防重入；每天 Asia/Shanghai 03:00 调 PG16 `pg_dump --format=custom --no-owner --no-privileges` 到带时间戳 `.partial`，命令成功且 `pg_restore --list` 可读后原子 rename；记录大小/checksum/耗时，不记录 URI/password。可由 host timer 调 Compose 内 PG16 工具，不给常驻 API 挂 Docker socket。
- 保留本地最近 7 日、异机加密每日备份 30 日；上传成功并核验后才按限定备份目录+命名规则清理过期备份，不写泛化 rm/删 volume 流程。真实密钥放安全凭据源，shell 不 `set -x`，密码通过受限 PG env/pgpass 提供。备份含个人身份数据，限制读取者；独立保存角色/授权声明、迁移版本、部署镜像 digest 与 env 恢复材料。`pg_dump` 单库不含 cluster roles，不能声称一份 dump 包含全部权限。[PG16 pg_dump 文档](https://www.postgresql.org/docs/16/app-pgdump.html)。
- 恢复：先隔离/暂停 API 写入，保留当前备份 → 在**新库/新 volume**准备 PG16 与既定角色 → 校验 dump checksum/目录 → `pg_restore --exit-on-error --no-owner --no-privileges --dbname=<new_restore_db> <backup.dump>` → 由授权步骤重新设 owner/runtime grants、核对迁移版本与 sequence/行数/唯一键/FK → 撤销恢复出来的 sessions/refresh（避免复活旧凭据），清 OTP、按 runbook 重新发码登录 → 验证健康和权限/历史数据 → 经明确切换授权后把 API 指向恢复库。默认不 drop/覆盖旧库，不自动执行 `--clean`。
- 每月至少恢复演练一次；daily dump 的 RPO 最坏约 24h；目标 RTO 1–2h 是操作目标，需演练测定；若要分钟级 RPO 再加 WAL 归档/PITR，不承诺现方案已具备。
- /health/live 仅进程存活；/health/ready 在 DB/迁移未就绪 503。provider 配置启动校验，但健康检查不发真实短信/邮件；服务商故障由真实调用失败率告警。监控磁盘<20%、DB 连接/锁等待、5xx、OTP send/verify 失败率、429、短信预算、备份最后成功时间及证书有效期。
- pino JSON stdout + Caddy access log；容器日志轮转（例如 10MiB×3 每容器），保留期按磁盘预算；URL/body 不含 code，敏感 headers redact；审计记录角色变更、移除、换码、重要 task/log 写、认证成功/失败/重放和 request_id，不复制日报正文。备份失败要告警，不能只输出“完成”。

### 9.4 国内上线与腾讯云准备 / Mainland launch prerequisites

- ICP 正在办理；备案/接入条件满足后再公开大陆站点，页面展示真实备案信息并链接规定查询页；上线前由主体/接入商确认网站用途及其他所需手续，不编造备案号或声称已经批准。[腾讯云备案场景说明](https://cloud.tencent.com/document/product/243/18910)。
- SES：开通中国站产品和额度，配置发信域名/地址（可选择受控的 mail.jeayon.com）、按控制台要求验证 DNS 记录并保持 SPF/DKIM/MX/DMARC 正确；验证码模板建好且可用，测试 QQ/163/企业邮箱的实际收件与垃圾箱表现。[腾讯云邮件配置](https://cloud.tencent.cn/document/product/1288/47454)。
- SMS：开通大陆短信、应用实际 SdkAppId，主体/签名资质、**签名和验证码模板审核通过**、变量个数/顺序与代码一致、发送额度/预算告警；由真实手机验证延迟与错误响应。申请批准不等于代码已完成。
- CAM：专用子账号/API SecretId/Key，只允许 SES SendEmail 与 SMS SendSms，删除管理/创建模板/读取其他产品权限；固定出口时增加已支持的源 IP 条件。当前官方授权表中 **SendSms 是操作级、Resource='*'**，不能凭产品整体支持资源级就编造“限定 SdkAppId 的 SendSms resource”。SES SendEmail 也按操作级授权核实；最终策略用控制台当前支持的动作语法生成并实测拒绝其他动作，本文不提供未验证的 JSON ARN/condition key。应用层固定 sender/app/template 不能替代 CAM 隔离。[SMS CAM 接口粒度](https://cloud.tencent.com/document/product/598/85395)、[SES CAM 接口粒度](https://intl.cloud.tencent.com/ko/document/product/598/57150)。

English: Production uses Caddy, one API and persistent PostgreSQL behind a private network. Deliver tested backup/restore procedures and least-privilege delivery credentials; launch only after the required mainland approvals are ready.

## 10. 服务器规模估算 / Capacity estimate

假设 / Assumptions：几十到 300 个用户、平时 5–30 人同时使用、短时 50 人；文本任务/日报，无附件、音视频或实时连接。估算不是压测结论，也不是厂商价格报价。

| 资源 | 最低可用 / Minimum | 推荐 / Recommended |
| --- | --- | --- |
| CPU | 2 vCPU | 4 vCPU，为备份/更新/突发与 DB 同机留余量 |
| RAM | 4 GB | 8 GB，PG cache、API、OS、备份与部署余量更宽裕 |
| SSD | 60 GB | 100–150 GB，可扩容；备份异机另计 |
| 公网带宽 | 3 Mbps | 5–10 Mbps，主要缓解多人首屏/刷新突发；按流量包时初始预留 100–200 GB/月并观察 |

理由：300×250 工作日≈75,000 篇日报/年，按平均 4–12 KiB（正文+行/索引）约 0.3–0.9 GiB/年，接近上限中文正文可能达每篇约 20 KiB 或更多；任务量较小，但 WAL、索引膨胀、系统/镜像/日志、本地 7 份备份仍需数十 GB 余量。不能用“用户少”推导磁盘可以忽略。当前 build 的 JS gzip 约 129 KB、CSS gzip 约 8.5 KB；300 条长日报的 JSON 响应可能比静态包更大，压缩与缓存静态资源有帮助，分页是未来扩展项，不能悄悄截断任务导致统计失真。

4GB 最小预算可按 OS/Caddy≈0.7–1GB、API≈0.3–0.7GB、PG+cache≈1.5–2GB 分配，并为备份留峰值空间；实际 RSS/缓存会变化。API pool 初始 10，无需为 300 注册用户开 300 DB connections。首版在推荐规格上测 20/50 并发读写，目标普通 API p95<300ms、无锁超时（不含外部发送耗时）；观察 CPU、内存、慢 SQL、响应体与带宽后再调参。单机是单点，卷不等于备份或高可用；需更高可用性再拆 DB/引入复制。

English: Start at 2 vCPU/4GB/60GB SSD, preferably 4 vCPU/8GB/100–150GB SSD with 5–10Mbps. These are planning estimates pending a representative load test.

## 11. 风险、待定事项与本次验证 / Risks, open questions and verification

### 11.1 上线前必须明确 / Decisions before implementation or launch

1. **旧数据是否迁移？** 全新启动最简单；若保留，需获授权导出五表与可验证的旧 uid→email/phone 映射，保留数字 id、用户 text uid、历史姓名、版本与时间，并重设 sequence。不迁 WBCS token；所有人重新 OTP 登录。不凭用户自报旧 uid、同名或未验证邮箱认领历史权限。
2. **旧用户身份能否导出并证明？** 无可靠映射时保留 unclaimed 用户，不让任意新手机号自动接管 owner；需要独立的人工核验/认领流程方案。邮箱大小写归一、重复身份、多人误建账号不能自动合并。
3. **腾讯云配置与资质**：中国站账号、SES 发信人/模板、SMS 签名/模板/应用是否已可用？正式地域、模板变量和批准状态需从控制台确认；本次未调用发送服务，没有真实收码验收。
4. **绑定界面何时提供？** 后端按本文设计；若首发即可绑定，需要一个最小账号设置入口（属明确 auth 范围），不得借团队页改角色来关联账号。换绑/解绑/账号合并与恢复首版不开放，需确认业务预期。
5. **运营策略**：开放 OTP 自注册还是只允许指定人？当前 UI 是登录后用邀请码加入，本文按允许注册保留；300 人是否集中同日开通以调整全站日预算？审计/备份留存、管理员恢复渠道、RPO/RTO 与运维负责人待定。
6. **目标主机与备案**：云厂商/地域/系统、Docker 可用性、镜像下载源、DNS/证书出站、已申请 ICP 的主体用途及接入状态；未确定不声称可上线。

### 11.2 已发现的技术风险 / Observed technical risks

- 旧 acceptance.md 的部分描述已过时：AuthProvider 实际只有 signed-in/signed-out；SELECT policy 实际四条，不是某段文字所称五条；unit 文件仍共 50 个测试，但各文件用例数量与文档表格不一致。以源码、SQL 和本次结果为准。
- 旧 permission/conflict 单测是 UI 规则与内存规格模型，不能证明新服务的授权或真实数据库并发；后续必须跑 §7 的真实 PG/API 测试。
- API 集中授权取代 DB RLS，是本计划最重要的安全边界变化；遗漏任一查询的 membership 检查会跨团队泄露，需 endpoint 矩阵与攻击性测试。未来若开放直接 DB 访问或多个后台服务，必须重评 RLS/DB 权限，不能沿用当前假设。
- 原 RPC 与前端 in_progress 归一差异、部分 RPC 行字段不完整、日志按编辑后日期冲突重查、300 条日报导致更早记录/“我的”视图不完整，均已识别。迁移保留当前可见行为，不能把旧缺陷当成新后端已解决；分页/按 id 重读另作小范围明确改动。
- 10 位现有码只有约 40 bit 生成空间；邀请码不是公开检索入口，需登录/限额/轮换/审计。账号被移除后仍可能持有历史数据或新获得的邀请码重新加入；后者是当前 rejoin 语义，不在本阶段悄悄加入永久封禁。
- 邮箱/SMS 为外部依赖，可能限额、延迟、被过滤或因审批/余额不可发；错误要真实反映。console 仅开发可用，不能用于生产“临时顶替”。短信滥刷成本和 IP/NAT 共用误限需要监测。
- refresh 轮换的跨标签页/丢包处理与 httpOnly logout 失败行为必须真实浏览器验证；XSS 仍可在同源发请求，安全 cookie 不能替代前端脚本安全。移除 sharecode 内联 loader 后可再配置适合构建产物的 CSP，不照抄会破坏页面的策略。
- 本机 PG 集群 down，DB 已提供但连接未验证；后续实施前须解决服务启动与运行账号权限，不在只读步骤里擅自启动。生产 Docker Compose 只能在有 Docker 的环境完成实测。

### 11.3 本次实际检查 / Checks actually performed

| 检查 | 本次结果 |
| --- | --- |
| Node | `/opt/node24/bin/node --version` → `v24.22.1` |
| `env PATH=/opt/node24/bin:$PATH npm run typecheck`（app） | exit 0，tsc --noEmit 通过 |
| `env PATH=/opt/node24/bin:$PATH TSX_DISABLE_CACHE=1 npm test`（app） | exit 0，runner 输出 6 个文件通过、0 fail |
| 展开用例：`env -u NODE_TEST_CONTEXT PATH=/opt/node24/bin:$PATH TSX_DISABLE_CACHE=1 node --import tsx --test --test-isolation=none --test-reporter=spec tests/unit/*.test.ts` | exit 0，**50 tests / 50 pass / 0 fail**；没有把文件数量当测试数量 |
| `env PATH=/opt/node24/bin:$PATH npm run build -- --outDir /tmp/dwa-plan-review-build-20261026` | exit 0；57 modules；JS 424.10kB / gzip 128.67kB、CSS 39.47kB / gzip 8.47kB；输出仅 /tmp，未覆盖 app/dist；外部 outDir 不自动清理的 Vite 提示是预期 |
| lint | package.json 未定义 lint script；本次未虚构 lint 成功 |
| PostgreSQL / Docker | `pg_lsclusters` → PG16 main port 5432 down；psql 只读连接 dwa_dev/dwa_test 未成功；command 查到 psql，未查到 docker |
| 新后端/API/真实 OTP/浏览器/Compose/恢复/负载测试 | **未执行**：本步骤尚无 server 代码，未启动 DB、未配置或调用真实 providers、未部署 |

本次只交付可评审计划；上述检查仅说明现有前端基线，不能被解释为新后端已实现、数据已迁移或生产已通过验收。

English: The frontend baseline passes type checking, all 50 named tests and a build into /tmp. Native PostgreSQL is currently down. Backend, delivery, deployment and recovery remain planned work, with legacy identity migration requiring an explicit decision.
