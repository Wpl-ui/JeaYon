import { useState } from 'react'
import { useAuth } from './AuthProvider'
import { requestPasswordReauth, setAccountPassword, verifyPasswordReauth } from './api'
import { Banner, Button, Field, TextInput } from '../components/ui'
import { AppError, errorMessage, isSessionExpired } from '../lib/errors'
import type { OtpChallenge } from './types'

export function PasswordSettings() {
  const { user, expireSession, acceptSession } = useAuth()
  const [notice, setNotice] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null)
  const [retryAt, setRetryAt] = useState(0)
  const [code, setCode] = useState('')
  const [reauth, setReauth] = useState<{ token: string; expiresAt: number } | null>(null)
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNext, setPwNext] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  async function perform(action: () => Promise<void>) {
    if (pwBusy) return
    setPwError(null)
    setNotice(null)
    setPwBusy(true)
    try { await action() }
    catch (err) {
      if (isSessionExpired(err)) expireSession(errorMessage(err))
      else {
        setPwError(errorMessage(err))
        if (err instanceof AppError && err.code === 'reauth_required') {
          setReauth(null)
          setChallenge(null)
          setCode('')
        }
      }
    } finally { setPwBusy(false) }
  }

  async function sendCode() {
    if (Date.now() < retryAt) throw new AppError('请等待 60 秒后重新发送验证码', 'rate-limited')
    const next = await requestPasswordReauth()
    setChallenge(next)
    setRetryAt(Date.now() + next.retryAfter * 1000)
    setCode('')
    setReauth(null)
  }

  async function verifyCode() {
    if (!challenge) return
    const result = await verifyPasswordReauth(challenge.challengeId, code)
    setReauth({ token: result.reauth_token, expiresAt: Date.now() + result.expires_in * 1000 })
    setCode('')
  }

  async function changePassword() {
    if (!reauth || Date.now() >= reauth.expiresAt) throw new AppError('验证已失效，请重新获取验证码并验证', 'reauth_required')
    if (pwNext !== pwConfirm) throw new AppError('两次输入的新密码不一致', 'invalid')
    const session = await setAccountPassword(pwNext, pwCurrent, reauth.token)
    acceptSession(session)
    setPwCurrent('')
    setPwNext('')
    setPwConfirm('')
    setReauth(null)
    setChallenge(null)
    setNotice('密码已更新；其他设备上的登录已失效，当前会话保留。')
  }

  const canChange = !!user?.has_password && !!(user.phone || user.email)
  return (
    <section className="settings-section" aria-label="账号密码">
      <h2 className="section-heading">修改密码</h2>
      <div className="card">
        <div className="card-body stack">
          <p className="field-hint">
            {!user?.has_password
              ? '历史未设密账号请退出后，在登录页选择「注册 / 完成设密」，通过身份验证码完成。'
              : !canChange
                ? '请先绑定手机号或邮箱后再修改密码。'
                : `先验证已绑定${user.phone ? '手机' : '邮箱'}，再输入当前密码与新密码。验证有效期 5 分钟；修改后其他设备上的会话会立即失效。`}
          </p>
          {canChange && !reauth ? (
            <>
              <Button variant="primary" onClick={() => void perform(sendCode)} loading={pwBusy} disabled={pwBusy}>
                {challenge ? '重新发送验证码（间隔 60 秒）' : '发送改密验证码'}
              </Button>
              {challenge ? (
                <>
                  <Field label="验证码" htmlFor="pw-code">
                    <TextInput id="pw-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} disabled={pwBusy} />
                  </Field>
                  <Button variant="primary" onClick={() => void perform(verifyCode)} loading={pwBusy} disabled={pwBusy || code.length !== 6}>验证验证码</Button>
                </>
              ) : null}
            </>
          ) : null}
          {canChange && reauth ? (
            <>
              <Field label="当前密码" htmlFor="pw-current">
                <TextInput id="pw-current" maxLength={256} type="password" autoComplete="current-password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} disabled={pwBusy} />
              </Field>
              <Field label="新密码" htmlFor="pw-next" hint="8–128 位">
                <TextInput id="pw-next" type="password" autoComplete="new-password" maxLength={128} value={pwNext} onChange={(e) => setPwNext(e.target.value)} disabled={pwBusy} />
              </Field>
              <Field label="确认新密码" htmlFor="pw-confirm">
                <TextInput id="pw-confirm" type="password" autoComplete="new-password" maxLength={128} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} disabled={pwBusy} />
              </Field>
              <Button variant="primary" onClick={() => void perform(changePassword)} loading={pwBusy} disabled={pwBusy}>更新密码</Button>
              <Button variant="ghost" onClick={() => { setReauth(null); setChallenge(null); setPwCurrent(''); setPwNext(''); setPwConfirm('') }} disabled={pwBusy}>重新验证</Button>
            </>
          ) : null}
          {notice ? <Banner kind="success">{notice}</Banner> : null}
          {pwError ? <p className="field-error" role="alert">{pwError}</p> : null}
        </div>
      </div>
    </section>
  )
}
