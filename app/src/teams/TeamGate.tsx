/**
 * 团队入口：还没有任何团队时显示。
 *
 * 两条路：创建团队（自己成为 owner）或用邀请码加入（只能是 member）。
 * 两条路都要求填「展示姓名」—— 成员列表与日报署名都用它，服务端不提供时由这里补齐。
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useTeam } from './TeamProvider'
import { createTeam, joinTeam } from './api'
import { Banner, Button, Field, TextInput } from '../components/ui'
import { PasswordSettings } from '../auth/PasswordSettings'
import { errorMessage } from '../lib/errors'

type Busy = null | 'create' | 'join'

export function TeamGate() {
  const { user, signOut } = useAuth()
  const { reloadTeams, selectTeam } = useTeam()
  const navigate = useNavigate()

  const [displayName, setDisplayName] = useState(user?.name ?? '')
  const [teamName, setTeamName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (busy) return
    const name = teamName.trim()
    const person = displayName.trim()
    if (!person) return setError('请先填写你的姓名，团队成员会看到它')
    if (name.length < 1 || name.length > 40) return setError('团队名称需为 1-40 个字符')

    setError(null)
    setBusy('create')
    try {
      const { teamId } = await createTeam(name, person)
      await reloadTeams()
      selectTeam(teamId)
      navigate('/team')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleJoin() {
    if (busy) return
    const person = displayName.trim()
    const code = inviteCode.replace(/\s+/g, '').toUpperCase()
    if (!person) return setError('请先填写你的姓名，团队成员会看到它')
    if (code.length !== 10) return setError('邀请码为 10 位字母数字')

    setError(null)
    setBusy('join')
    try {
      const result = await joinTeam(code, person)
      await reloadTeams()
      selectTeam(result.teamId)
      navigate('/tasks')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page page-narrow">
      <div className="spread" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title">加入或创建团队</h1>
          <p className="page-desc">当前账号还没有加入任何团队。团队成员之间共享任务与日报。</p>
        </div>
        <Button variant="ghost" onClick={() => void signOut()}>
          退出登录
        </Button>
      </div>

      {error ? (
        <div style={{ marginBottom: 14 }}>
          <Banner kind="error" onClose={() => setError(null)}>
            {error}
          </Banner>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body">
          <Field label="你的姓名" htmlFor="gate-name" required hint="显示在成员列表与日报署名上，只用于展示，不影响权限">
            <TextInput
              id="gate-name"
              value={displayName}
              maxLength={30}
              placeholder="例如：张三"
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <PasswordSettings />

      <div className="gate-grid">
        <div className="card">
          <div className="card-head">
            <span className="card-title">创建团队</span>
          </div>
          <div className="card-body stack">
            <Field label="团队名称" htmlFor="gate-team-name" required hint="1-40 个字符，可随时保持简洁">
              <TextInput
                id="gate-team-name"
                value={teamName}
                maxLength={40}
                placeholder="例如：装配一车间"
                onChange={(e) => setTeamName(e.target.value)}
              />
            </Field>
            <p className="field-hint">创建后你是群主，可获取邀请码邀请同事，也可授予管理员。</p>
            <div>
              <Button variant="primary" onClick={handleCreate} loading={busy === 'create'} disabled={busy !== null}>
                创建团队
              </Button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="card-title">用邀请码加入</span>
          </div>
          <div className="card-body stack">
            <Field label="邀请码" htmlFor="gate-code" required hint="向团队群主或管理员索取，10 位">
              <TextInput
                id="gate-code"
                value={inviteCode}
                maxLength={10}
                placeholder="例如：7KQ2M9XZ4B"
                className="invite-input"
                style={{ letterSpacing: 2, textTransform: 'uppercase' }}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              />
            </Field>
            <p className="field-hint">通过邀请码加入的身份固定为「成员」。</p>
            <div>
              <Button variant="secondary" onClick={handleJoin} loading={busy === 'join'} disabled={busy !== null}>
                加入团队
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
