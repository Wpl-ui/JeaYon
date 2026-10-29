小补丁：侧栏文案改名，功能与路由不变。工作区 /workspace/selfhost。

**改动（仅显示文案）：**
1. `app/src/components/AppShell.tsx`：`sidebar-section`「工作空间」→「导航」
2. 同文件 `NAV_ITEMS` 五个 label：
   - 概览 → 看板
   - 任务 → 待办
   - 甘特图 → 计划
   - 日报 → 日记
   - 团队 → 组织
3. 五个页面对应的页面标题 `h1.page-title`（以及移动端若有重复 nav）改成与上表一致，避免侧栏与页眉不一致。不要批量替换正文里的「任务」「团队」「日报」业务用语（例如「创建团队」「写日报」「未归档任务」），只改导航标签和这五个页面的主标题。

不要改路由 path、认证/业务逻辑；未经允许不要 git commit/push；不要重建 api/postgres。
用 /opt/node24/bin/node 跑前端测试 + build；远端备份 dist 后上传静态文件；用服务器本机 `--resolve jeayon.com:443:127.0.0.1` 抽查打包后的 JS 含「导航」「看板」「待办」「计划」「日记」「组织」，且主导航处不再是旧五词。
报告追加写入 `server/docs/brand-jeayon.md`（补一节），证据 `logs/brand-nav-*.jsonl`。中英双语。
