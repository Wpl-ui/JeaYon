审阅 Codex「Notion 竖直大纲展开」（/workspace/selfhost）。只审不改，不要 commit/push/delete。
必读：logs/proposal-notion-vertical-expand.md、logs/prompt-notion-vertical-expand.md、server/docs/task-notion-vertical-expand.md、logs/codex-notion-vertical-expand.log 末尾、证据、TasksPage/TaskCards/global.css。
核对：1) 竖直高度揭示非水平扫入；2) 展开~200ms/收起~150ms；3) 三角收起朝右展开朝下；4) 无错峰；5) pastel/胶囊/sessionStorage/拖拽保留；6) reduced-motion；7) 品牌导航未回退；8) 部署证据。
可跑 /opt/node24/bin/node 测试。最后一行「结论：可上线」或「结论：需修复」。
