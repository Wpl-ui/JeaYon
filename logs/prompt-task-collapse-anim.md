对 JeaYon（https://jeayon.com）待办列表做**折叠/展开流畅动画**。只改前端交互与样式，不加新业务、API、migration、依赖库。未经允许不要 git commit / push，不要删除远程项目或备份。

工作区：/workspace/selfhost。线上：Lighthouse 43.136.106.96，SSH `ubuntu` + `~/.ssh/jeayon_deploy_ed25519`，`/home/ubuntu/jeayon-work/`；staging + edge Caddy。测试用 `/opt/node24/bin/node`。

**更深一层（本轮故意不做）：** 顶级交互设计师会再做 FLIP/共享布局、弹簧物理、子行错落入场、拖拽时暂停动画、跨筛选态动画记忆。本轮只要「收起/展开丝滑」，用 CSS + 最小 React 状态即可，不要引入 framer-motion/react-spring。

**生材料（先读原文）：**
- `app/src/tasks/TasksPage.tsx`：`collapsed` / `toggleParent` / `visible` 用 filter 直接卸掉子行（无法做高度动画）；数量胶囊 `task-count-capsule` + `aria-expanded`
- `app/src/tasks/collapse.ts`、`hierarchy.ts`
- `app/src/styles/global.css`（已有 `@media (prefers-reduced-motion: reduce)` 与胶囊样式）
- `server/docs/task-collapse-reorder.md`（既有折叠/拖拽契约保持）
- 品牌侧栏：导航 / 看板、待办、计划、日记、组织；产品名 JeaYon（勿回退 佳阳/工作台）

**要做的：**
1. **丝滑折叠/展开：** 点父行数量胶囊时，子任务区域应有流畅高度（或等价 grid 0fr→1fr）+ 轻透明度/位移过渡；三角 ▾/▸ 同步旋转或过渡。默认仍全部展开；`sessionStorage` 折叠状态逻辑保留。
2. **实现约束：** 动画期间 DOM 策略自选（例如父+子分组容器，或收起时先动画再卸载、展开时先挂载再量高），但必须：
   - 不破坏同父拖拽/键盘调序、乐观更新与回滚
   - 筛选命中子任务时父行仍可见、胶囊仍可操作
   - 无活跃子任务的父行行为不变
   - `prefers-reduced-motion: reduce` 时近似瞬时（沿用或补强现有全局规则）
   - 不闪烁、不把列表布局撑乱；时长约 200–320ms、ease 偏 Apple（如 cubic-bezier）
3. **不要做：** 新 npm 依赖、后端/API/migration、组内序号、微信/ICP/设置页改动、commit/push。
4. **测试：** 前端单测覆盖折叠状态仍正确；必要时补组件/DOM 验收断言「收起后子行不可见 / 展开后可见」且动画类或过渡存在。全量 app + server 测试、双方 typecheck/build。
5. **部署：** 远端备份；本轮预计只热更前端 `app/dist`（无 migration 则不动 Postgres/API 镜像除非必须）；健康检查；本机 `--resolve`/隧道验证静态资源哈希。不切换 production。
6. **报告：** `server/docs/task-collapse-anim.md` 中英双语；证据 `logs/task-collapse-anim-*.jsonl`（脱敏）。测试与验收通过后再报完成。
