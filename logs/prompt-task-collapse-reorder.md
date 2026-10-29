对 JeaYon（https://jeayon.com）任务列表做交互增强：**父任务用「数量胶囊」折叠/展开子任务**；**不显示组内序号**；子任务支持**拖拽调序并持久化**。不加新业务功能（不要微信/ICP/认证改动）。未经允许不要 git commit / push，不要删除远程项目或备份。

工作区：/workspace/selfhost。线上：Lighthouse 43.136.106.96，SSH `ubuntu` + `~/.ssh/jeayon_deploy_ed25519`，部署目录 `/home/ubuntu/jeayon-work/`；staging + edge Caddy。测试用 `/opt/node24/bin/node`。

**生材料（先读原文）：** `app/src/tasks/TasksPage.tsx`；`app/src/tasks/hierarchy.ts`；`server/src/tasks/hierarchy-contract.ts`；`server/src/business.ts`（children `order by id`）；`server/src/db/migrations/002_business.ts`、`004_task_parent.ts`；`app/src/tasks/api.ts`；前端任务测试。品牌已定为 JeaYon；侧栏 导航/看板/待办/计划/日记/组织 — 不要回退。

**交互规格：**
1. **数量胶囊（折叠控件）：** 有活跃子任务的父行，在标题旁或 trailing 区显示可点击胶囊，文案为 `done/total`（如 `2/3`）或至少显示总数；点击切换展开/收起（`aria-expanded`）。收起时隐藏子行，父行仍可见进度条/推导状态。默认全部展开；用 `sessionStorage` 记住本会话每个父任务的展开状态。Apple 风格，轻量。不要用普通 chevron 作为唯一控件——胶囊本身就是折叠按钮（可内嵌小三角）。
2. **无组内序号：** 子行不要显示 1、2、3；弱化或去掉把 `#database id` 当主序号的展示（详情里可保留弱化 id 供排障，但不作为序号交互）。
3. **拖拽调序并保存：** 仅同父兄弟之间；新增 `sort_order`（或等价）+ migration；查询 `order by sort_order, id`；新建子任务排末尾；API 选最小清晰方案（如 PATCH reorder / 批量 siblings），带版本冲突处理；禁止跨父、禁止多层。前端拖拽（@dnd-kit 或原生），乐观更新，失败回滚提示。
4. **测试 + 部署：** 全量 server/前端测试、typecheck/build；远端备份；migration；必要时重建 api（保留 postgres 数据）；前端 dist 热更新；健康检查；本机 `--resolve` 验证。不切换 production。

**验收证据** `logs/task-collapse-reorder-*.jsonl`（脱敏）。最终报告 `server/docs/task-collapse-reorder.md`，中英双语。测试和验收都通过后再报完成。
