import type { TaskRow, TaskStatus, TeamMemberRow, WorkLogRow } from '../types/db'
import type { TeamSummary } from '../teams/api'
import { addDays, todayISO } from '../lib/dates'

export const FIXTURE_MARKER = 'WORKBUDDY_VISUAL_FIXTURE_ONLY_2026'
export const today = todayISO()
const stamp = `${today}T08:00:00+08:00`
export const members: TeamMemberRow[] = ['王鹏亮', '李雪', '陈一鸣', '张晨', '赵静', '刘洋'].map((name, index) => ({
  id: index + 1, team_id: 1, user_id: `preview-member-${index + 1}`, display_name: name,
  role: index === 0 ? 'owner' : index === 1 ? 'admin' : 'member', active: true,
  joined_at: '2026-10-01T09:00:00+08:00', deactivated_at: null,
}))
export const summary: TeamSummary = {
  team: { id: 1, name: '产品研发组', timezone: 'Asia/Shanghai', created_by: members[0].user_id, created_at: stamp, updated_at: stamp },
  role: 'owner', displayName: '王鹏亮', joinedAt: stamp,
}
// Offsets preserve one overdue task and an upcoming milestone on any screenshot date.
const definitions: [string, TaskStatus, number, number, number, number, string][] = [
  ['需求评审与 PRD 定稿', 'done', 100, -25, -14, 1, '确认任务归档规则与验收标准，补齐评审结论并同步研发排期。'],
  ['登录与权限（RLS）联调', 'in_progress', 70, -18, -2, 3, '核对成员、管理员与访客的数据访问范围，回归会话过期场景。'],
  ['任务看板交互改版', 'in_progress', 55, -12, 4, 2, '调整筛选与任务编辑入口，完善空列表和提交失败时的反馈。'],
  ['日报提交与提醒', 'in_progress', 30, -9, 9, 4, '梳理日报必填项与补交提示，确认跨时区的日期展示。'],
  ['甘特图渲染优化', 'in_progress', 15, 0, 14, 0, '优化长时间轴滚动和任务条标签，验证拖拽后的进度展示。'],
  ['内测版本发布', 'todo', 0, 11, 11, 0, ''],
  ['微信登录实测', 'todo', 0, 6, 18, 3, '在真实设备上检查授权回跳、取消授权与重复登录流程。'],
  ['移动端适配', 'todo', 0, 10, 24, 1, ''],
  ['数据导出与归档', 'todo', 0, 16, 35, 4, '确认导出字段与日期格式，检查归档任务恢复后的关联日报。'],
  ['设计规范与组件整理', 'done', 100, -21, -10, 5, '统一表单、状态标记与抽屉间距，整理可复用组件的使用说明。'],
]
export const tasks: TaskRow[] = definitions.map(([title, status, progress, start, due, assignee, description], index) => ({
  id: index + 12, team_id: 1, parent_id: null, sort_order: 0, created_by: members[0].user_id, assignee_id: members[assignee].user_id,
  title, description, status, progress,
  start_date: addDays(today, start), due_date: addDays(today, due), archived_at: null, version: 1,
  created_at: stamp, updated_at: stamp,
}))
export const logs: WorkLogRow[] = [0, 1, 2, 4].map((index) => ({
  id: index + 1, team_id: 1, owner_id: members[index].user_id, owner_name: members[index].display_name,
  work_date: today, done_today: ['完成甘特图时间轴与任务进度联调，确认本周内测范围。', '完成需求文档评审，整理移动端组件规范。', '完成任务列表交互与筛选，推进接口联调。', '完成日报表单与提交反馈，补充异常状态提示。'][index === 4 ? 3 : index],
  problems: index === 2 ? '接口边界场景需要与后端进一步确认。' : null,
  plan_tomorrow: '继续推进本周迭代任务，完成关键流程验收与体验优化。', hours: 7.5,
  related_task_id: index + 12, version: 1, created_at: stamp, updated_at: stamp,
}))
logs.push({ ...logs[0], id: 8, work_date: addDays(today, -1), done_today: '梳理本周交付计划，完成任务拆解与团队同步。' })
