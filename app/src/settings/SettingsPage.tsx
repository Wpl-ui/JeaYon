import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { updateAccountName } from '../auth/api'
import { PasswordSettings } from '../auth/PasswordSettings'
import { ThemeControl } from '../components/ThemeControl'
import { Banner, Button, Field, TextInput } from '../components/ui'
import { errorMessage, isSessionExpired } from '../lib/errors'

export function SettingsPage() {
  const { user, acceptSession, expireSession } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function saveName() {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const session = await updateAccountName(name)
      acceptSession(session)
      setName(session.user.name ?? '')
      setNotice('资料已保存。')
    } catch (err) {
      if (isSessionExpired(err)) expireSession(errorMessage(err))
      else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page page-narrow personal-settings">
      <div className="page-head">
        <h1 className="page-title">设置</h1>
      </div>

      <section className="settings-section" aria-labelledby="profile-heading">
        <h2 id="profile-heading" className="section-heading">资料</h2>
        <form className="card card-body stack" onSubmit={(event) => { event.preventDefault(); void saveName() }}>
          <Field label="账号名" htmlFor="account-name" hint="1–40 个字符">
            <TextInput id="account-name" autoComplete="name" value={name}
              onChange={(event) => setName(event.target.value)} disabled={busy} />
          </Field>
          <dl className="profile-identities">
            <div><dt>手机</dt><dd>{user?.phone || '未绑定'}</dd></div>
            <div><dt>邮箱</dt><dd>{user?.email || '未绑定'}</dd></div>
          </dl>
          <p className="field-hint">各组织内的显示名在组织页成员处管理</p>
          {notice ? <Banner kind="success">{notice}</Banner> : null}
          {error ? <p className="field-error" role="alert">{error}</p> : null}
          <div className="row">
            <Button type="submit" variant="primary" loading={busy}>保存资料</Button>
          </div>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="security-heading">
        <h2 id="security-heading" className="section-heading">安全</h2>
        <PasswordSettings />
      </section>

      <section className="settings-section" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className="section-heading">外观</h2>
        <div className="card card-body"><ThemeControl /></div>
      </section>
    </div>
  )
}
