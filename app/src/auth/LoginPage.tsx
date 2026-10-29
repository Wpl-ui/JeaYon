/**
 * Login — OTP (phone|email) and password (phone|email), same cookie session.
 * WeChat unavailable on self-host.
 */
import { useEffect, useState } from 'react'
import { useAuth } from './AuthProvider'
import { passwordLogin, registerAccount, requestEmailCode, requestPhoneCode, startWechatLogin, verifyOtpCode } from './api'
import type { OtpChallenge } from './types'
import { Banner, Button, Field, TextInput } from '../components/ui'
import brandIcon from '../assets/brand-icon.png'
import { errorMessage } from '../lib/errors'

type Busy = null | 'send' | 'verify' | 'wechat' | 'password'
type Mode = 'otp' | 'password' | 'register'

export function LoginPage({ bootNotice }: { bootNotice: string | null }) {
  const { expiredNotice, clearExpiredNotice, acceptSession } = useAuth()

  const [mode, setMode] = useState<Mode>('password')
  const [otpChannel, setOtpChannel] = useState<'phone' | 'email'>('phone')
  const [otpTarget, setOtpTarget] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  const [signupPassword, setSignupPassword] = useState('')
  const [signupConfirm, setSignupConfirm] = useState('')

  const [pwChannel, setPwChannel] = useState<'phone' | 'email'>('phone')
  const [pwTarget, setPwTarget] = useState('')
  const [pwPassword, setPwPassword] = useState('')

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((n) => n - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  useEffect(() => {
    if (error) setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpTarget, otpChannel, code, pwTarget, pwPassword, mode, pwChannel])

  async function handleSend() {
    if (busy) return
    setError(null)
    setBusy('send')
    try {
      const next = await (otpChannel === 'phone' ? requestPhoneCode(otpTarget, mode === 'register' ? 'register' : 'login') : requestEmailCode(otpTarget, mode === 'register' ? 'register' : 'login'))
      setChallenge(next)
      setCode('')
      setCooldown(Math.max(60, next.retryAfter || 0))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function handleVerify() {
    if (busy || !challenge) return
    setError(null)
    if (mode === 'register' && signupPassword !== signupConfirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy('verify')
    try {
      const session = mode === 'register'
        ? await registerAccount(challenge.challengeId, code, signupPassword)
        : await verifyOtpCode(challenge.challengeId, code)
      acceptSession(session)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  async function handlePasswordLogin() {
    if (busy) return
    setError(null)
    setBusy('password')
    try {
      const session = await passwordLogin(pwChannel, pwTarget, pwPassword)
      acceptSession(session)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  async function handleWechat() {
    if (busy) return
    setError(null)
    setBusy('wechat')
    try {
      await startWechatLogin()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(null)
    }
  }

  function handleChangeTarget() {
    setChallenge(null)
    setCode('')
    setCooldown(0)
  }

  const notice = error ?? bootNotice ?? expiredNotice

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <img src={brandIcon} alt="JeaYon" className="brand-mark-img" />
          </span>
          <h1 className="visually-hidden">JeaYon</h1>
        </div>

        {notice ? (
          <div className="auth-notice">
            <Banner
              kind={error ? 'error' : expiredNotice ? 'warn' : 'error'}
              onClose={() => {
                setError(null)
                clearExpiredNotice()
              }}
            >
              {notice}
            </Banner>
          </div>
        ) : null}

        <div className="auth-body">
          <div className="auth-mode-tabs" role="tablist" aria-label="登录方式">
            <button
              type="button"
              role="tab"
              className={mode === 'otp' ? 'auth-mode active' : 'auth-mode'}
              aria-selected={mode === 'otp'}
              disabled={busy !== null}
              onClick={() => { setMode('otp'); handleChangeTarget() }}
            >
              验证码登录
            </button>
            <button
              type="button"
              role="tab"
              className={mode === 'password' ? 'auth-mode active' : 'auth-mode'}
              aria-selected={mode === 'password'}
              disabled={busy !== null}
              onClick={() => { setMode('password'); handleChangeTarget(); setSignupPassword(''); setSignupConfirm('') }}
            >
              密码登录
            </button>
            <button type="button" role="tab" className={mode === 'register' ? 'auth-mode active' : 'auth-mode'} aria-selected={mode === 'register'} disabled={busy !== null} onClick={() => { setMode('register'); handleChangeTarget() }}>
              注册 / 完成设密
            </button>
          </div>

          {mode !== 'password' ? (
            <>
              <Field label="账号类型" htmlFor="otp-channel">
                <select
                  id="otp-channel"
                  className="select"
                  value={otpChannel}
                  disabled={busy !== null}
                  onChange={(e) => {
                    setOtpChannel(e.target.value as 'phone' | 'email')
                    setOtpTarget('')
                    handleChangeTarget()
                  }}
                >
                  <option value="phone">手机号</option>
                  <option value="email">邮箱</option>
                </select>
              </Field>
              <Field label={otpChannel === 'phone' ? '手机号' : '邮箱'} htmlFor="otp-target" hint={otpChannel === 'phone' ? '中国大陆 11 位手机号' : '请输入邮箱地址'}>
                <div className="code-row">
                  <TextInput
                    id="otp-target"
                    inputMode={otpChannel === 'phone' ? 'tel' : 'email'}
                    autoComplete={otpChannel === 'phone' ? 'tel' : 'email'}
                    placeholder={otpChannel === 'phone' ? '请输入手机号' : '请输入邮箱'}
                    value={otpTarget}
                    disabled={challenge !== null || busy !== null}
                    onChange={(e) => setOtpTarget(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleSend()}
                  />
                  {challenge === null ? (
                    <Button variant="primary" onClick={() => void handleSend()} loading={busy === 'send'} disabled={busy !== null}>
                      发送验证码
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={handleChangeTarget} disabled={busy !== null}>
                      {otpChannel === 'phone' ? '换号码' : '换邮箱'}
                    </Button>
                  )}
                </div>
              </Field>

              {challenge !== null ? (
                <>
                  <Field
                    label="验证码"
                    htmlFor="login-code"
                    hint={cooldown > 0 ? `${cooldown} 秒后可重新发送` : '验证码有效期较短，请及时输入'}
                  >
                    <TextInput
                      id="login-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="请输入验证码"
                      value={code}
                      maxLength={8}
                      autoFocus
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={(e) => e.key === 'Enter' && void handleVerify()}
                    />
                  </Field>
                  {mode === 'register' ? (
                    <>
                      <Field label="设置密码" htmlFor="signup-password" hint="8–128 位；验证码验证与设密一次完成">
                        <TextInput id="signup-password" type="password" autoComplete="new-password" maxLength={128} value={signupPassword} disabled={busy !== null} onChange={(e) => setSignupPassword(e.target.value)} />
                      </Field>
                      <Field label="确认密码" htmlFor="signup-confirm">
                        <TextInput id="signup-confirm" type="password" autoComplete="new-password" maxLength={128} value={signupConfirm} disabled={busy !== null} onChange={(e) => setSignupConfirm(e.target.value)} />
                      </Field>
                    </>
                  ) : null}
                  <Button
                    variant="primary"
                    onClick={() => void handleVerify()}
                    loading={busy === 'verify'}
                    disabled={busy !== null || code.length !== 6 || (mode === 'register' && signupPassword.length < 8)}
                  >
                    {mode === 'register' ? '验证并完成注册' : '登录'}
                  </Button>
                  {cooldown === 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => void handleSend()} disabled={busy !== null}>
                      重新发送验证码
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="field-hint">{mode === 'register' ? '新账号或历史未设密账号：验证码与密码一并提交，完成注册。已有密码请使用密码登录。' : '验证码仅供已有密码的账号备用登录；新用户请选择「注册 / 完成设密」。'}</p>
              )}
            </>
          ) : (
            <>
              <Field label="账号类型" htmlFor="pw-channel">
                <select
                  id="pw-channel"
                  className="select"
                  value={pwChannel}
                  disabled={busy !== null}
                  onChange={(e) => setPwChannel(e.target.value as 'phone' | 'email')}
                >
                  <option value="phone">手机号</option>
                  <option value="email">邮箱</option>
                </select>
              </Field>
              <Field
                label={pwChannel === 'phone' ? '手机号' : '邮箱'}
                htmlFor="pw-target"
                hint={pwChannel === 'phone' ? '中国大陆 11 位手机号' : '已绑定邮箱'}
              >
                <TextInput
                  id="pw-target"
                  autoComplete={pwChannel === 'phone' ? 'username' : 'email'}
                  placeholder={pwChannel === 'phone' ? '请输入手机号' : '请输入邮箱'}
                  value={pwTarget}
                  disabled={busy !== null}
                  onChange={(e) => setPwTarget(e.target.value)}
                />
              </Field>
              <Field label="密码" htmlFor="pw-password" hint="历史未设密账号请选择「注册 / 完成设密」">
                <TextInput
                  id="pw-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="请输入密码"
                  value={pwPassword}
                  disabled={busy !== null}
                  onChange={(e) => setPwPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handlePasswordLogin()}
                />
              </Field>
              <Button
                variant="primary"
                onClick={() => void handlePasswordLogin()}
                loading={busy === 'password'}
                disabled={busy !== null || pwTarget.trim() === '' || pwPassword.length > 256}
              >
                登录
              </Button>
            </>
          )}

          <p className="field-hint">忘记密码：自助重置暂未开放。</p>
          <div className="auth-divider">或</div>
          <Button
            className="auth-wechat"
            variant="secondary"
            onClick={() => void handleWechat()}
            loading={busy === 'wechat'}
            disabled={busy !== null}
          >
            微信扫码登录
          </Button>
          <p className="field-hint">自建部署暂未接入微信登录。</p>
        </div>
      </div>
    </div>
  )
}
