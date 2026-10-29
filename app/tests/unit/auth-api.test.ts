import assert from 'node:assert/strict'
import { it } from 'node:test'
import { normalizeEmail, normalizePhone, setAccountPassword, updateAccountName } from '../../src/auth/api'
import { passwordLogin as previewLogin, setAccountPassword as previewSet } from '../../src/dev-preview/auth-api'

it('matches server phone and email normalization, including rejected edge cases', () => {
  assert.equal(normalizePhone(' 123-4567-8901 '), '+8612345678901')
  assert.equal(normalizeEmail(' A.B+Tag@Example.COM '), 'a.b+tag@example.com')
  for (const value of ['a@b.com\n', 'a@b.com\r\nBcc:x@y.com', 'a@b.com,c@d.com', '中@b.com', 'a..b@x.com', 'a@-x.com', 'a@b..com', `${'a'.repeat(65)}@b.com`]) {
    assert.equal(normalizeEmail(value), null)
  }
})

it('explains password control characters separately from password length', async () => {
  await assert.rejects(setAccountPassword('password\n', 'current', 'reauth'), { message: '密码不能包含控制字符' })
  await assert.rejects(setAccountPassword('short', 'current', 'reauth'), { message: '密码需为 8–128 位' })
})

it('preview password exports reject without making authentication requests', async () => {
  await assert.rejects(previewLogin('email', 'preview@example.test', 'unused'), /预览模式/)
  await assert.rejects(previewSet('unused'), /预览模式/)
})

it('rejects invalid account names before making a request', async () => {
  for (const name of ['', '   ', '\t', '\0', 'a'.repeat(41), '😀'.repeat(41)]) {
    await assert.rejects(updateAccountName(name), { message: '账号名需为 1–40 个字符' })
  }
})
