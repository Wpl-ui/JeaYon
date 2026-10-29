审阅 Codex「任务数量胶囊折叠 + 拖拽调序」（/workspace/selfhost）。只审不改，不要 commit/push/delete。
必读：logs/prompt-task-collapse-reorder.md、server/docs/task-collapse-reorder.md、logs/codex-task-collapse-reorder.log 末尾、logs/task-collapse-reorder-*、TasksPage、hierarchy、business/migrations、api。
核对：1) 父行数量胶囊可折叠展开且显示 done/total；2) 无组内序号、未把 #id 当主序号；3) 同父拖拽落库 sort_order；4) 契约未破坏；5) 品牌文案未回退；6) 测试与部署证据。
可跑 /opt/node24/bin/node 测试。最后一行「结论：可上线」或「结论：需修复」。
