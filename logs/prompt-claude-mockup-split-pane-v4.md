Write ONE self-contained HTML file (inline CSS, minimal JS for toggles) to /workspace/selfhost/logs/mockup-tasks-split-pane-v4.html. Do NOT modify anything in app/ or server/. Do not commit, push, deploy. You may read logs/mockup-tasks-split-pane-v3.html for reference but must not overwrite it.

High-fidelity, light theme, Chinese UI mockup of the JeaYon tasks page, expert split-pane design:
1. Sidebar: brand "JeaYon" only (never 佳阳/工作台). Nav: 看板 / 待办(active) / 计划 / 日记 / 组织. NO weekly 本周完成 card. Minimal user footer OK.
2. Left pane ~30%: segmented filter 全部/待处理/已完成 above the list (only filter on page). First-class row 「独立任务 · 6」. ~6 parent rows, tight 40–44px list rows (not cards), selected 发布计划 with soft bg + 3px accent bar, small n/m progress numerals.
3. Draggable divider clearly visible with grip dots, cursor col-resize.
4. Right pane: sticky header with title 发布计划, 3/5 progress ring, due date, member avatars. Open children prominent; 「已完成 3」 group collapsed by default (subtle disclosure, toggle via JS, no ▸/▾ characters). Thin pastel left bars only. Primary 「＋ 新建子任务」 button in right pane. Top bar: search + bell only, no 新建任务 button, no duplicate filters.
5. Small caption note: selecting 独立任务 shows the leaf task list on the right.
Polish beyond v3: cleaner type hierarchy, consistent 4/8px spacing rhythm, refined selected state, subtler completed disclosure. Viewport 1440x900.
