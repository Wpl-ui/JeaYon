对 JeaYon（https://jeayon.com）做**个人设置第一期**：新建设置页（资料 / 安全 / 外观），把密码与外观从「组织」页迁出。不加微信、真实短信、ICP、注销账号、会话列表。未经允许不要 git commit / push，不要删除远程项目或备份。

工作区：/workspace/selfhost。线上：Lighthouse 43.136.106.96，SSH `ubuntu` + `~/.ssh/jeayon_deploy_ed25519`，`/home/ubuntu/jeayon-work/`；staging + edge Caddy。测试用 `/opt/node24/bin/node`。

**生材料（先读原文）：** `app/src/App.tsx` 路由；`app/src/components/AppShell.tsx` 用户区；`app/src/teams/TeamSettingsPage.tsx`（现挂 ThemeControl + PasswordSettings）；`app/src/auth/PasswordSettings.tsx`、`api.ts`、`types.ts`；`app/src/components/ThemeControl.tsx`；`server/src/auth/service.ts` 的 `me()`（已返回 name + identities 的 phone/email）；`server/src/app.ts` auth 路由；`server/src/db/migrations/001_auth.ts` users.name 约束；侧栏品牌文案保持 导航/看板/待办/计划/日记/组织。

**要做的：**
1. **路由与入口：** 新增 `/settings`（HashRouter），页面标题「设置」。在 AppShell 用户区增加入口（点头像/姓名或「设置」按钮均可，Apple 风格、不挤进主导航五项）。未登录仍走现有登录门。
2. **设置页三区（窄页、分组卡片）：**
   - **资料：** 可编辑账号 `name`（1–40，与 DB 约束一致）；只读展示已绑定手机/邮箱（来自 `/api/auth/me`，无则显示「未绑定」）。补充最小 API：`PATCH /api/auth/me`（或等价）只改 `name`，需登录；返回更新后的 me。团队内 `display_name` 本轮不改，可在资料区用一行说明「各组织内的显示名在组织页成员处管理」。
   - **安全：** 迁入现有 `PasswordSettings`（设密/改密逻辑不重写）。
   - **外观：** 迁入 `ThemeControl`。
3. **组织页瘦身：** `TeamSettingsPage` 去掉 PasswordSettings 与外观块，只留邀请/成员/角色。
4. **测试：** 后端 me PATCH（校验长度、未登录 401）；前端设置页渲染与入口；回归密码设置相关测试。全量 server + 前端测试、双方 typecheck/build。
5. **部署：** 远端备份；有 migration 才动 postgres，否则只热更前端 dist + 必要时重建 api；健康检查；本机 `--resolve` 验证。不切换 production。

**验收证据** `logs/personal-settings-*.jsonl`（脱敏）。报告 `server/docs/personal-settings.md`，中英双语。测试和验收都通过后再报完成。
