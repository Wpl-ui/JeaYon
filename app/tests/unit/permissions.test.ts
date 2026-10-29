/**
 * 权限判定单测（界面层）。
 *
 * 注意：这里只验证"按钮该不该出现"。真正的授权在数据库 RLS 与 RPC 里，
 * 那份权限矩阵需要在真实会话下验证，不能用这份测试代替。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canChangeRoles,
  canEditWorkLog,
  canMaintainTasks,
  canManageInviteCode,
  canRemoveMember,
  canToggleAdmin,
  roleLabel,
  roleRank,
} from '../../src/lib/permissions'
import type { MemberRole } from '../../src/types/db'

const OWNER = 'u_owner'
const ADMIN = 'u_admin'
const MEMBER = 'u_member'

function member(userId: string, role: MemberRole, active = true) {
  return { user_id: userId, role, active }
}

test('邀请码：仅 owner 与 admin 可查看/重置', () => {
  assert.equal(canManageInviteCode('owner'), true)
  assert.equal(canManageInviteCode('admin'), true)
  assert.equal(canManageInviteCode('member'), false)
  assert.equal(canManageInviteCode(null), false, '非成员不可访问')
})

test('改角色：仅 owner', () => {
  assert.equal(canChangeRoles('owner'), true)
  assert.equal(canChangeRoles('admin'), false)
  assert.equal(canChangeRoles('member'), false)
  assert.equal(canChangeRoles(null), false)
})

test('移除成员：owner 可移除除 owner 外的任何人，admin 只能移除 member', () => {
  assert.equal(canRemoveMember('owner', OWNER, member(MEMBER, 'member')), true)
  assert.equal(canRemoveMember('owner', OWNER, member(ADMIN, 'admin')), true)
  assert.equal(canRemoveMember('owner', OWNER, member(OWNER, 'owner')), false, '禁止移除唯一 owner')

  assert.equal(canRemoveMember('admin', ADMIN, member(MEMBER, 'member')), true)
  assert.equal(canRemoveMember('admin', ADMIN, member(ADMIN, 'admin')), false, 'admin 不能移除同级')
  assert.equal(canRemoveMember('admin', ADMIN, member(OWNER, 'owner')), false)

  assert.equal(canRemoveMember('member', MEMBER, member(MEMBER, 'member')), false)
  assert.equal(canRemoveMember(null, null, member(MEMBER, 'member')), false)
})

test('移除成员：不能移除自己，也不能重复移除已停用成员', () => {
  assert.equal(canRemoveMember('owner', OWNER, member(OWNER, 'owner')), false)
  assert.equal(canRemoveMember('owner', OWNER, member(MEMBER, 'member', false)), false)
})

test('授予/取消管理员：仅 owner，且不能对自己或已停用成员操作', () => {
  assert.equal(canToggleAdmin('owner', OWNER, member(MEMBER, 'member')), true)
  assert.equal(canToggleAdmin('owner', OWNER, member(ADMIN, 'admin')), true)
  assert.equal(canToggleAdmin('owner', OWNER, member(OWNER, 'owner')), false, '不改 owner 自己的角色')
  assert.equal(canToggleAdmin('admin', ADMIN, member(MEMBER, 'member')), false)
  assert.equal(canToggleAdmin('owner', OWNER, member(MEMBER, 'member', false)), false)
})

test('任务维护：只要还是有效成员就可以', () => {
  assert.equal(canMaintainTasks('member'), true)
  assert.equal(canMaintainTasks('admin'), true)
  assert.equal(canMaintainTasks('owner'), true)
  assert.equal(canMaintainTasks(null), false, '被移出团队后角色为 null')
})

test('日报改删：只能动自己的，且必须仍是有效成员', () => {
  assert.equal(canEditWorkLog('member', MEMBER, MEMBER), true)
  assert.equal(canEditWorkLog('owner', OWNER, MEMBER), false, '管理员也不能改别人的日报')
  assert.equal(canEditWorkLog(null, MEMBER, MEMBER), false, '被移除后连自己的也不能改')
  assert.equal(canEditWorkLog('member', null, MEMBER), false)
})

test('角色文案与排序', () => {
  assert.equal(roleLabel('owner'), '群主')
  assert.equal(roleLabel('admin'), '管理员')
  assert.equal(roleLabel('member'), '成员')
  assert.deepEqual((['member', 'owner', 'admin'] as MemberRole[]).sort((a, b) => roleRank(a) - roleRank(b)), [
    'owner',
    'admin',
    'member',
  ])
})
