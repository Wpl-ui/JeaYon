# 方案：待办展开对齐 Notion 竖直大纲 / Notion-like vertical outline expand

状态 / Status: **待确认 / awaiting approval**（只方案，未改代码）

## 问题 / Problem

当前子项用水平 `clip-path` 短→长扫入 + 错峰，既不像 Notion，也裁掉阴影。用户要求按 Notion **整体重做交互**。

## 目标 / Goal

展开/收起观感对齐 Notion 大纲：子项在父项**下方竖直挤开**、缩进层级清晰、三角/胶囊指示状态；保留已有业务能力。

## 推荐方案 A / Approach A

### 交互

1. **竖直揭示**：子项容器用高度动画（优先 `grid-template-rows: 0fr ↔ 1fr` + 内层 `overflow: hidden`，与早前可上线垂直折叠同族），替代水平 `clip-path` / `display:none` 扫入。
2. **布局**：子项仍在文档流、父卡下方；左侧缩进（现有约 28px 可微调，保持可拖拽命中区）。
3. **指示器**：父卡胶囊保留 `done/total`；三角 **Notion 式**——收起朝右（▸），展开朝下（▾），用旋转过渡（同一字形旋转约 90°），与高度动画同拍。
4. **时长（已确认）**：展开高度 **~200ms**；收起高度 **~150ms**；三角旋转跟对应阶段（展开约 200ms / 收起约 150ms）。ease 用现有 Apple 曲线即可。
5. **错峰 / 收起**：展开与收起均为**整组同时**，**无**逐项 stagger；不做左右短→长。`prefers-reduced-motion: reduce`：高度与三角均瞬时到位。
6. **a11y**：收起子树 `inert` + `aria-hidden`；焦点不困在隐藏项；胶囊 `aria-expanded` / `aria-label` 保留。

### 保留 / Keep

- `ParentTaskCard` / `ChildTaskCard` 组件拆分
- 稳定 pastel（`taskColor(id)`）+ 左侧色条（可继续；不改成纯 Notion 扁行）
- 胶囊折叠 + `sessionStorage`（`collapse.ts`）
- 同父拖拽 / 键盘调序 / 409 回滚 / 筛选上下文
- 无新依赖、无 API/migration、无 commit/push
- 品牌 JeaYon；导航「导航 / 看板 / 待办 / 计划 / 日记 / 组织」

### 代码触点 / Touch points（预期）

- `app/src/styles/global.css`：替换 `.task-child-collapse` 水平规则为竖直 grid 揭示；三角 transition；去掉展开态残留 `clip-path: inset(0 0 0 0)` 裁阴影问题
- `app/src/tasks/TasksPage.tsx`：去掉或停用 expand delay style
- `app/src/tasks/appearance.ts`：可删或 unused `taskExpandDelay`
- DOM/验收脚本：断言从水平 clip/stagger 改为竖直 grid rows + reduced-motion
- 文档 `server/docs/task-expand-cards.md` 或新 `task-notion-vertical-expand.md` + staging 前端热更证据

## 明确不做 / Out of scope

- 无限多层嵌套、拖到任意深度、Notion 全套快捷键
- 方案 B 扁行去色、方案 C 右侧子树面板
- 新动画库（framer-motion 等）
- 密码/设置/ICP/微信
- production cutover、git commit/push/delete

## 更深一层故意不做 / Deeper cut left out

FLIP 共享布局、弹簧物理、虚拟长列表、色弱专用双编码主题（本轮保持对比度即可）。

## 验收 / Acceptance

1. 展开：子项从父下竖直挤开，无水平扫入；阴影不被整卡 clip 裁掉。
2. 收起：高度收合 + inert；胶囊三角状态正确。
3. 无 stagger（或 delay=0）；reduced-motion 安全。
4. 拖拽/筛选/sessionStorage/胶囊计数回归。
5. pastel + 父/子组件仍在；品牌导航未回退。
6. 本地测试 + staging 前端部署证据；Claude 审阅结论行。

## 实施流程 / Process

Codex `gpt-6.1-sol` high 实现并部署 staging → Claude `deepseek-flash` 只审不改 → 原文审阅回传。**确认本方案后才开工。**
