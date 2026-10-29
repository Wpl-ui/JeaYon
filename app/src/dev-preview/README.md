# Development visual preview

Run `npm run dev`, then open:

- `http://localhost:5183/preview.html#/login`
- `http://localhost:5183/preview.html#/dashboard`
- `http://localhost:5183/preview.html#/tasks`
- `http://localhost:5183/preview.html#/gantt`
- `http://localhost:5183/preview.html#/logs`
- `http://localhost:5183/preview.html#/team`

Use the port printed by Vite if `PORT` is set or 5183 is occupied. Check desktop and 390px viewport widths.

The preview uses the real page components. A serve-only Vite plugin tags only the module graph imported by this entry and replaces auth/team hooks and API imports with these adapters. `index.html` retains its real authentication and cloud data access even on the same dev server. Pure API validators are reused without invoking cloud reads or writes. SMS, OAuth and team management actions are explicitly blocked in the preview; task and report edits update disposable fixture data until reload.

Dates are relative to the real day in Asia/Shanghai. The fixtures have six members, ten tasks (including one overdue and one same-day milestone), and five reports. Every screen displays “预览模式 · 示例数据”.

Production uses Vite's default `index.html` input. No production module imports this entry or its fixtures. Verify after `npm run build`:

```bash
if rg -l 'WORKBUDDY_VISUAL_FIXTURE_ONLY_2026|preview-member-|DEMO-ONLY|visual-preview|预览模式' dist; then
  echo 'FAIL: preview data found in production'
  exit 1
else
  echo 'PASS: preview data excluded'
fi
```
