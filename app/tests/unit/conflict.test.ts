/**
 * 并发冲突与错误分类单测。
 *
 * 界面上的"保留我的输入 / 改用最新版本"分支完全依赖这里的分类：
 * 一旦把 `conflict` 判成成功，就会用它自己的输入静默覆盖别人的修改；
 * 一旦把 `conflict` 判成会话失效，就会把用户踢回登录页。
 * 所以这几个判定必须钉死。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError, errorMessage, isSessionExpired, toAppError } from '../../src/lib/errors'

test('版本冲突：保留 conflict 码，不被当成成功、也不当成会话失效', () => {
  const err = toAppError({ code: 'conflict', message: '任务已被他人修改，请重新加载' })
  assert.equal(err.code, 'conflict')
  assert.equal(err.message, '任务已被他人修改，请重新加载')
  assert.equal(err.sessionExpired, false)
  assert.equal(isSessionExpired({ code: 'conflict' }), false)
})

test('会话失效：只有未认证/401 才算，需要回登录页', () => {
  assert.equal(isSessionExpired({ kind: 'unauthenticated' }), true)
  assert.equal(isSessionExpired({ status: 401 }), true)
  assert.equal(toAppError({ status: 401 }).code, 'unauthenticated')
  assert.equal(isSessionExpired({ kind: 'network' }), false, '网络失败不该把用户踢出去')
  assert.equal(isSessionExpired({ kind: 'permission-denied' }), false, '被移出团队应提示无权限')
})

test('被移除成员 / 无权限：给出可理解的中文提示', () => {
  const denied = toAppError({ kind: 'permission-denied' })
  assert.equal(denied.code, 'permission-denied')
  assert.match(denied.message, /权限/)

  const forbidden = toAppError({ code: 'forbidden', message: '只有群主可以修改成员角色' })
  assert.equal(forbidden.code, 'forbidden')
  assert.equal(forbidden.message, '只有群主可以修改成员角色')
})

test('重复日报：唯一约束被翻译成"已存在"，便于引导去编辑原稿', () => {
  const dup = toAppError({ code: '23505' })
  assert.equal(dup.code, 'already_exists')
  assert.ok(dup.message.length > 0)
})

test('其余数据库错误码都有确定归类', () => {
  assert.equal(toAppError({ code: '23503' }).code, 'invalid', '外键不存在')
  assert.equal(toAppError({ code: '23514' }).code, 'invalid', '违反 CHECK 约束')
  assert.equal(toAppError({ code: 'PGRST116' }).code, 'not_found')
  assert.equal(toAppError({ kind: 'credits-exhausted' }).code, 'credits-exhausted')
  assert.equal(toAppError({ kind: 'rate-limited' }).code, 'rate-limited')
  assert.equal(toAppError({ kind: 'network' }).code, 'network')
  assert.equal(toAppError({ kind: 'backend-unavailable' }).code, 'backend-unavailable')
})

test('未知错误也要有可显示的文案，不能是空字符串或 undefined', () => {
  const err = toAppError({})
  assert.equal(err.code, 'unknown')
  assert.ok(err.message.trim().length > 0)
  assert.equal(errorMessage(null), '操作失败，请稍后重试')
  // 非 Error 的裸字符串/对象不会原样漏到界面上（避免出现 "[object Object]" 或技术栈信息）
  assert.equal(errorMessage('随便一段文本'), '操作失败，请稍后重试')
  assert.equal(errorMessage(new Error('真实错误')), '真实错误', '标准 Error 的 message 照常显示')
})

test('AppError 原样透传，不重复包装', () => {
  const original = new AppError('自定义失败', 'invalid')
  assert.equal(toAppError(original), original)
})

/**
 * 乐观并发规格：服务端只接受 `expected_version === current` 的写入，
 * 成功时版本 +1。两个客户端都基于 version=1 提交时，第二个必须被拒绝，
 * 而不是覆盖第一个的结果。
 */
test('乐观并发规格：后提交者基于旧版本必须被拒绝', () => {
  const row = { version: 1, title: '原始标题' }

  function update(expectedVersion: number, title: string) {
    if (expectedVersion !== row.version) {
      return { ok: false as const, code: 'conflict' as const }
    }
    row.version += 1
    row.title = title
    return { ok: true as const, code: 'ok' as const }
  }

  assert.equal(update(1, '客户端 A 的修改').ok, true)
  assert.equal(row.version, 2)

  const second = update(1, '客户端 B 的修改')
  assert.equal(second.ok, false, 'B 拿着旧版本提交必须被拒')
  assert.equal(second.code, 'conflict')
  assert.equal(row.title, '客户端 A 的修改', '不能覆盖 A 已经成功的修改')
  assert.equal(row.version, 2, '被拒绝的写入不推进版本')

  assert.equal(update(2, '客户端 B 重新加载后再提交').ok, true)
  assert.equal(row.version, 3)
})
