Create a single self-contained HTML file (inline CSS only, no external assets/JS libs) at /workspace/selfhost/logs/mockup-tasks-split-pane-v3.html. It is a high-fidelity product mockup (not wireframe) of the JeaYon "待办" tasks page, split-pane, light theme, Chinese UI, realistic task titles, viewport ~1440x900. Do NOT modify anything under app/ or server/. Only write that one file.

Design (expert v3, locked):
1. Sidebar: brand "JeaYon" only (never 佳阳 or 工作台). Nav: 看板 / 待办 (active) / 计划 / 日记 / 组织. NO weekly progress card. Minimal user footer (avatar + name) OK.
2. Top bar: breadcrumb + title 待办 + search + bell. No filter tabs under the top bar. No primary 新建任务 button in top bar (create lives in right pane).
3. Left pane (~30% width) = tight list, not cards. Row height 40-44px. Above list: segmented control 全部/待处理/已完成. First row: 「独立任务 · 6」 first-class entry, visually separated from parents. Then ~6 parent rows (e.g. 发布计划, 官网改版, Q4 招聘, 数据迁移, 客户回访, 年终复盘), each with title + small numeral progress like 3/5 or tiny ring. 发布计划 selected: soft background + 3px left accent bar. No ▸/▾ chevrons anywhere.
4. Divider: visible grip handle, cursor col-resize, ~30/70 split.
5. Right pane (~70%) = work surface. Sticky header: 发布计划, compact progress ring 3/5, due date (e.g. 11月15日截止), member avatars. Then 2 open child task cards shown prominently (muted pastel, only thin left color bar, checkbox, title, meta like assignee/due). Then a collapsed disclosure group 「已完成 3」 (collapsed, items not shown; use a +/− or text affordance, not ▸/▾). Primary button 「＋ 新建子任务」 in right pane. Tiny caption hint: 选择「独立任务」时右栏显示独立任务列表.
Polish: refined typography (system Chinese fonts), subtle borders, 8px grid, restrained color, consistent radius.
