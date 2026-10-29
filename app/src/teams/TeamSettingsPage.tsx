/**
 * 团队成员与邀请码。
 *
 * 界面只负责"显示什么、能点什么"，权限判定一律以服务端返回为准：
 * 即使这里出了 bug 让按钮可点，RPC 也会用 `auth.uid()` 重新校验角色并拒绝。
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useTeam } from './TeamProvider'
import { getInviteCode, removeMember, resetInviteCode, setMemberRole } from './api'
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  InlineLoading,
} from '../components/ui'
import { errorMessage, isSessionExpired } from '../lib/errors'
import {
  canManageInviteCode,
  canRemoveMember,
  canToggleAdmin,
  roleLabel,
  roleRank,
} from '../lib/permissions'
import { formatDateTime } from '../lib/dates'
import type { TeamMemberRow } from '../types/db'

export function TeamSettingsPage() {
  const { userId, expireSession } = useAuth()
  const { currentTeam, currentRole, members, membersLoading, membersError, reloadMembers, reloadTeams } = useTeam()

  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [codeVisible, setCodeVisible] = useState(false)
  const [codeBusy, setCodeBusy] = useState<null | 'load' | 'reset'>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [roleBusyId, setRoleBusyId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<TeamMemberRow | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const teamId = currentTeam?.team.id ?? null

  const handleError = useCallback(
    (err: unknown) => {
      if (isSessionExpired(err)) {
        expireSession(errorMessage(err))
        return
      }
      setActionError(errorMessage(err))
    },
    [expireSession],
  )

  // 切换团队时丢弃上一枚邀请码，避免把 A 团队的码显示在 B 团队页面上
  useEffect(() => {
    setInviteCode(null)
    setCodeVisible(false)
    setCodeError(null)
    setNotice(null)
    setActionError(null)
  }, [teamId])

  async function handleLoadCode() {
    if (!teamId || codeBusy) return
    if (inviteCode) {
      setCodeVisible(true)
      return
    }
    setCodeBusy('load')
    setCodeError(null)
    try {
      const code = await getInviteCode(teamId)
      setInviteCode(code)
      setCodeVisible(true)
    } catch (err) {
      if (isSessionExpired(err)) expireSession(errorMessage(err))
      else setCodeError(errorMessage(err))
    } finally {
      setCodeBusy(null)
    }
  }

  async function handleResetCode() {
    if (!teamId || codeBusy) return
    setCodeBusy('reset')
    setCodeError(null)
    setNotice(null)
    try {
      const code = await resetInviteCode(teamId)
      setInviteCode(code)
      setCodeVisible(true)
      setNotice('邀请码已重置，旧邀请码立即失效。')
    } catch (err) {
      if (isSessionExpired(err)) expireSession(errorMessage(err))
      else setCodeError(errorMessage(err))
    } finally {
      setCodeBusy(null)
    }
  }

  async function handleToggleAdmin(member: TeamMemberRow) {
    if (!teamId || roleBusyId) return
    const nextRole = member.role === 'admin' ? 'member' : 'admin'
    setRoleBusyId(member.user_id)
    setActionError(null)
    setNotice(null)
    try {
      await setMemberRole(teamId, member.user_id, nextRole)
      await Promise.all([reloadMembers(), reloadTeams()])
      setNotice(`${member.display_name} 已${nextRole === 'admin' ? '设为管理员' : '取消管理员'}。`)
    } catch (err) {
      handleError(err)
    } finally {
      setRoleBusyId(null)
    }
  }

  async function handleConfirmRemove() {
    if (!teamId || !removeTarget) return
    setRemoveBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      const result = await removeMember(teamId, removeTarget.user_id)
      setInviteCode(result.inviteCode || null)
      setRemoveTarget(null)
      await Promise.all([reloadMembers(), reloadTeams()])
      const parts = [`已移除 ${removeTarget.display_name}，邀请码已重置。`]
      if (result.unassignedTasks > 0) parts.push(`其 ${result.unassignedTasks} 个未完成任务已转为未分配。`)
      setNotice(parts.join(''))
    } catch (err) {
      handleError(err)
      setRemoveTarget(null)
    } finally {
      setRemoveBusy(false)
    }
  }

  async function copyCode() {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      setNotice('邀请码已复制到剪贴板。')
    } catch {
      setNotice('复制失败，请手动选中邀请码复制。')
    }
  }

  const sortedMembers = members.slice().sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    const byRole = roleRank(a.role) - roleRank(b.role)
    if (byRole !== 0) return byRole
    return a.joined_at.localeCompare(b.joined_at)
  })


  const activeCount = members.filter((m) => m.active).length

  if (!currentTeam) {
    return (
      <div className="page">
        <EmptyState title="还没有选择团队" description="请在右上角切换或创建一个团队。" />
      </div>
    )
  }

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">组织</h1>
          <p className="page-desc">
            {currentTeam.team.name} · 共 {activeCount} 位有效成员 · 时区 {currentTeam.team.timezone} · 创建于{' '}
            {formatDateTime(currentTeam.team.created_at)}
          </p>
        </div>
      </div>

      {actionError ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="error" onClose={() => setActionError(null)}>
            {actionError}
          </Banner>
        </div>
      ) : null}
      {notice ? (
        <div style={{ marginBottom: 12 }}>
          <Banner kind="success" onClose={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      ) : null}

      <section className="settings-section">
        <h2 className="section-heading">邀请新成员</h2>
        <div className="card">
          <div className="card-body stack">
            {canManageInviteCode(currentRole) ? (
              <>
                <div className="row">
                  {codeVisible && inviteCode ? (
                    <span className="invite-code">{inviteCode}</span>
                  ) : (
                    <Button variant="secondary" onClick={handleLoadCode} loading={codeBusy === 'load'}>
                      {inviteCode ? '显示邀请码' : '获取邀请码'}
                    </Button>
                  )}
                  {codeVisible && inviteCode ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => void copyCode()}>
                        复制
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setCodeVisible(false)}>
                        隐藏
                      </Button>
                    </>
                  ) : null}
                  <span className="grow" />
                  <Button
                    variant="secondary"
                    onClick={() => void handleResetCode()}
                    loading={codeBusy === 'reset'}
                    disabled={codeBusy !== null}
                  >
                    重置邀请码
                  </Button>
                </div>
                <p className="field-hint">
                  邀请码 10 位，只发给本团队同事。重置后旧码立即失效；移除成员时系统也会自动重置。
                </p>
                {codeError ? <p className="field-error">{codeError}</p> : null}
              </>
            ) : (
              <p className="field-hint">邀请码由群主或管理员管理，需要邀请同事时请联系他们。</p>
            )}
          </div>
        </div>

      </section>

      <section className="settings-section">
        <h2 className="section-heading">成员 <span>{activeCount} 人在岗</span></h2>
        <div className="card">
          <div className="card-body-tight">
            {membersLoading && members.length === 0 ? (
              <InlineLoading label="正在读取成员…" />
            ) : membersError ? (
              <Banner kind="error">
                <span>{membersError}</span>
                <Button size="sm" variant="ghost" onClick={() => void reloadMembers()}>
                  重试
                </Button>
              </Banner>
            ) : sortedMembers.length === 0 ? (
              <EmptyState title="暂无成员" description="通过邀请码邀请同事加入。" />
            ) : (
              sortedMembers.map((member) => {
                const isSelf = member.user_id === userId
                const removable = canRemoveMember(currentRole, userId, member)
                const toggleable = canToggleAdmin(currentRole, userId, member)
                return (
                  <div className="member-row" key={member.user_id}>
                    <span className="avatar">{member.display_name.slice(0, 1) || '?'}</span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <strong style={{ fontWeight: 600 }}>{member.display_name}</strong>
                        <span
                          className={`badge ${
                            member.role === 'owner'
                              ? 'badge-owner'
                              : member.role === 'admin'
                                ? 'badge-admin'
                                : 'badge-todo'
                          }`}
                        >
                          {roleLabel(member.role)}
                        </span>
                        {isSelf ? <span className="badge badge-muted">我</span> : null}
                        {!member.active ? <span className="badge badge-muted">已停用</span> : null}
                      </div>
                      <div className="tiny faint">
                        {member.active
                          ? `加入于 ${formatDateTime(member.joined_at)}`
                          : `已于 ${formatDateTime(member.deactivated_at)} 停用`}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      {toggleable ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={roleBusyId === member.user_id}
                          disabled={roleBusyId !== null}
                          onClick={() => void handleToggleAdmin(member)}
                        >
                          {member.role === 'admin' ? '取消管理员' : '设为管理员'}
                        </Button>
                      ) : null}
                      {removable ? (
                        <Button size="sm" variant="ghost" className="destructive-text" onClick={() => setRemoveTarget(member)}>
                          移除
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
          <div className="card-foot">
            <p className="tiny faint">
              群主可管理全部成员；管理员可移除普通成员并重置邀请码；成员只能维护任务和自己的日报。
              移除成员会停用其账号在本团队的读写权限，历史日报与署名保留。
            </p>
          </div>
        </div>

      </section>

      <ConfirmDialog
        open={removeTarget !== null}
        title={`移除 ${removeTarget?.display_name ?? ''}？`}
        description={
          <>
            <p>移除后该成员将立即失去本团队的读写权限，历史日报保留其署名。</p>
            <p style={{ marginTop: 6 }}>其未完成且未归档的任务会转为「未分配」。</p>
            <p style={{ marginTop: 6 }}>
              <strong>邀请码会同时重置</strong>，现有邀请码立即失效，需要重新分发给其他人。
            </p>
          </>
        }
        confirmText="移除成员"
        danger
        busy={removeBusy}
        onConfirm={() => void handleConfirmRemove()}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}
