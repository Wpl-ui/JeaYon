审阅 Codex「任务折叠展开动画」（/workspace/selfhost）。只审不改，不要 commit/push/delete。
必读：logs/prompt-task-collapse-anim.md、server/docs/task-collapse-anim.md、logs/codex-task-collapse-anim.log 末尾、证据、TasksPage、collapse、global.css。
核对：1) 折叠/展开有流畅过渡且 reduced-motion 安全；2) 胶囊/sessionStorage/拖拽排序未坏；3) 无新依赖/API/migration；4) 品牌导航未回退；5) 测试与部署证据齐全。
可跑 /opt/node24/bin/node 测试。最后一行「结论：可上线」或「结论：需修复」。
