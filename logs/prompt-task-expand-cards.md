对 JeaYon（https://jeayon.com）待办做**卡片化 + 左右短→长展开 + 清新色 + 依次展开**。只改前端交互/组件/样式，不加 API、migration、新依赖库。未经允许不要 git commit / push，不要删除远程项目或备份。

工作区：/workspace/selfhost。线上：Lighthouse 43.136.106.96，SSH `ubuntu` + `~/.ssh/jeayon_deploy_ed25519`，`/home/ubuntu/jeayon-work/`；staging + edge Caddy。测试用 `/opt/node24/bin/node`。

**前提：** 若同会话刚完成「注册设密+改密升权」，在其通过测试的代码上继续，勿回退品牌/设置/认证。产品方案：`logs/proposal-task-expand-cards.md`。

**更深一层故意不做：** FLIP/弹簧、用户自选色入库、右侧分栏侧栏布局、色弱完整主题。本轮：列表内水平短→长、错落、稳定清新色、组件拆分。

**生材料：** `app/src/tasks/TasksPage.tsx`、`collapse.ts`、`hierarchy.ts`、`global.css`（现有竖直 0fr/1fr 动画）、`server/docs/task-collapse-anim.md`。侧栏 JeaYon + 导航/看板/待办/计划/日记/组织勿回退。

**要做的：**
1. **组件：** 拆出 `ParentTaskCard`、`ChildTaskCard`（或等价）；TasksPage 组数据/折叠/排序。保留 `data-task-id`、胶囊 `aria-expanded`、sessionStorage、同父拖拽/键盘、筛选父上下文、inert/a11y。
2. **左右展开：** 替换竖直 grid 0fr/1fr；子卡水平从短变长（宽或 clip-path），约 220–280ms Apple 曲线。
3. **依次：** 展开 delay≈40–60ms/项（上限约 8）；收起建议整组较快；`prefers-reduced-motion` 瞬时无 delay。
4. **颜色：** 8–12 低饱和清新色；`hash(task.id)` 稳定映射；浅底+左侧色条；深色模式变体；文字对比度可读。禁止每次挂载 random 跳色。
5. **不要：** 右侧滑出侧栏、后端存色、framer-motion、组内序号、微信/ICP、commit/push。
6. **测试：** 折叠/展开/色 class 或 data 属性稳定、拖拽回归；全量 app+server 测试、typecheck/build。
7. **部署：** 备份；预计只热更 `app/dist`；健康检查；隧道/resolve 验哈希。不切换 production。
8. **报告：** `server/docs/task-expand-cards.md` 双语；证据 `logs/task-expand-cards-*.jsonl`。
