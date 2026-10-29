# Finish only: task-expand-cards (do NOT re-implement)

Working tree already has the horizontal short→long child expand + pastel colors + Parent/Child cards.
Local final checks already PASSED (app 59/59, server 188/188, React DOM cards acceptance PASS). Evidence in logs/task-expand-cards-*.

Your previous session stalled on Chrome/CUA after final checks (~00:19 Beijing). Resume from deploy.

## Must do
1. Write `server/docs/task-expand-cards.md` (acceptance report: what changed, how to verify, evidence paths, Chrome/browser visual unavailable — disclose that DOM+HTTP was used instead; brand/nav unchanged).
2. Package release + deploy to Lighthouse staging with existing `logs/task-expand-cards-deploy.py` / verify helpers (same pattern as recent tasks: backup, upload, frontend/API as needed, postgres+caddy untouched if no server change). Frontend-only change is fine.
3. Append deploy/verify events to `logs/task-expand-cards-20261027.jsonl` (or a dated sibling if you prefer, but keep one clear trail).
4. Re-run final typecheck/build/tests only if you touch source; do not rewrite working TaskCards/CSS unless a deploy blocker forces a tiny fix.
5. Skip Chrome/headless visual animation claims; document unavailable.
6. No git commit/push/delete. Brand stays JeaYon; nav 导航/看板/待办/计划/日记/组织.
7. Node: `/opt/node24/bin/node`. SSH: `~/.ssh/jeayon_deploy_ed25519` → ubuntu@43.136.106.96.

Stop when docs exist, staging frontend serves the new bundle hashes, and evidence is complete.
