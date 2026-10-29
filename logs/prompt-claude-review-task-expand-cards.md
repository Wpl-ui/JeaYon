审阅 Codex「待办卡片左右展开」（/workspace/selfhost）。只审不改，不要 commit/push/delete。
必读：logs/prompt-task-expand-cards.md、logs/prompt-task-expand-cards-finish.md、logs/proposal-task-expand-cards.md、server/docs/task-expand-cards.md、logs/codex-task-expand-cards.log 末尾、logs/codex-task-expand-cards-finish.log 末尾、证据、TasksPage/TaskCards、appearance、global.css。
核对：1) 子卡水平短→长且依次展开；2) 稳定清新色；3) 父/子组件化；4) 胶囊/sessionStorage/拖拽未坏；5) 无新依赖/API；6) 品牌导航未回退；7) reduced-motion 安全；8) 部署证据齐全（Chrome 不可用须披露）。
可跑 /opt/node24/bin/node 测试。最后一行「结论：可上线」或「结论：需修复」。
