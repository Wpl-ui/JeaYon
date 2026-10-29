import type { MemberRole } from '../types/db'
export async function getInviteCode() { return 'DEMO-ONLY' }
export async function resetInviteCode() { throw new Error('预览模式：不执行团队管理操作。') }
export async function setMemberRole(_teamId: number, _userId: string, _role: MemberRole) { throw new Error('预览模式：不执行团队管理操作。') }
export async function removeMember(_teamId: number, _userId: string): Promise<{ unassignedTasks: number; inviteCode: string }> { throw new Error('预览模式：不执行团队管理操作。') }
