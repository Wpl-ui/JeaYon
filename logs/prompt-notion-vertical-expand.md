# Codex：待办展开改为 Notion 式竖直大纲

实现依据：`logs/proposal-notion-vertical-expand.md`（用户已批准方案 A）。

## 必做
1. 去掉子项水平 `clip-path` 短→长扫入与错峰 delay；改为父下**竖直**高度揭示（推荐 `grid-template-rows: 0fr↔1fr` + 内层 overflow hidden）。
2. 胶囊三角 Notion 式：收起朝右、展开朝下（旋转）；展开高度 ~200ms、收起 ~150ms，整组同时无错峰；inert/aria-hidden；reduced-motion 瞬时。
3. 保留 Parent/Child 卡片、pastel、胶囊计数、sessionStorage、同父拖拽/键盘/回滚。
4. 更新 DOM/单元验收断言；全量 app/server 测试；staging 前端部署（Postgres/Caddy/API 无谓勿动）；写 `server/docs/task-notion-vertical-expand.md` 证据。
5. 品牌 JeaYon；导航文案不回退。无新依赖/API。无 commit/push/delete。
6. Node：`/opt/node24/bin/node`。SSH：`~/.ssh/jeayon_deploy_ed25519` → ubuntu@43.136.106.96。

Chrome 不可用则披露 DOM+HTTP 替代。结束时报告路径与部署哈希。
