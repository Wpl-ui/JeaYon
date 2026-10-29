Create ONLY one file: /workspace/selfhost/logs/mockup-tasks-split-pane.html — a self-contained single HTML file (inline CSS, no external deps, no JS libs) that looks like a real high-fidelity product screenshot (not a wireframe) of the JeaYon task app. Do not modify anything under app/ or server/.

Requirements:
- Brand: "JeaYon" only (never 佳阳 / 工作台). Primary UI Chinese.
- ~1280x800 desktop app shell, light theme, Material-ish clean UI, soft pastel cards.
- Left sidebar: heading 导航; items 看板, 待办 (active), 计划, 日记, 组织.
- Main area: FIXED two-pane master/detail split (~40/60).
  - LEFT pane: ~4 parent tasks (only parents with children), e.g. "发布计划 2/5" selected with color bar + soft highlight; others like "Q4 市场推广 1/3", "新版官网改版 0/4", "团队季度复盘 3/3". done/total pill shows progress only. NO ▸/▾ chevrons.
  - Visible draggable vertical divider between panes with a grip handle (cursor col-resize).
  - RIGHT pane: header with selected parent title, progress 2/5, due date; then ~5 child cards stacked vertically, pastel backgrounds with thin left color bars, checkbox (2 done), realistic Chinese titles, small meta (assignee/date); "＋ 新建子任务" at bottom.
  - Small subtle note: "未选父任务时，右栏显示独立任务 / Standalone tasks show here when no parent is selected".
- No lorem ipsum. Make it look finished.
