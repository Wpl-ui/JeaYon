/**
 * 统一错误归一。
 *
 * Self-hosted API 返回 `{ ok, code, message, data? }`；传输失败也会收成 AppError。
 * 绝不把失败当成成功。
 */
export class AppError extends Error {
  readonly code: string
  /** 会话是否已失效（需要回到登录页） */
  readonly sessionExpired: boolean
  /** 失败响应里的 data（例如 already_member 的 team_id） */
  readonly data?: unknown

  constructor(message: string, code = 'unknown', sessionExpired = false, data?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.sessionExpired = sessionExpired
    this.data = data
  }
}

type LooseError = {
  kind?: string
  code?: string
  status?: number
  message?: string
  hint?: string
  details?: string
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  const e = (err ?? {}) as LooseError
  const kind = e.kind ?? ''
  const code = String(e.code ?? '')
  const status = Number(e.status ?? 0)

  if (code === 'registration_required') return new AppError('请使用「注册 / 完成设密」，验证码与密码需一并提交', 'registration_required')
  if (code === 'password_exists') return new AppError('此账号已设置密码，请使用密码登录；注册不能覆盖密码', 'password_exists')
  if (code === 'identity_required') return new AppError('请先绑定手机号或邮箱后再修改密码', 'identity_required')
  if (code === 'reauth_required') return new AppError('验证已失效，请重新获取验证码并验证', 'reauth_required')
  if (code === 'invalid_credentials') {
    return new AppError('账号或密码不正确', 'invalid_credentials')
  }
  if (kind === 'unauthenticated' || code === 'unauthenticated' || (status === 401 && code !== 'invalid_credentials')) {
    return new AppError('登录状态已失效，请重新登录', 'unauthenticated', true)
  }
  if (code === 'invalid_code') {
    return new AppError('验证码错误或已失效，请重新获取', 'invalid_code')
  }
  if (code === 'csrf_rejected') {
    return new AppError('请求被拒绝，请刷新页面后重试', 'csrf_rejected')
  }
  if (code === 'delivery_unavailable') {
    return new AppError('验证码发送失败，请稍后重试', 'delivery_unavailable')
  }
  if (code === 'refresh_conflict') {
    return new AppError('登录状态冲突，请重新登录', 'refresh_conflict', true)
  }
  if (kind === 'permission-denied' || code === '42501') {
    return new AppError('没有权限执行此操作（可能已被移出团队）', 'permission-denied')
  }
  if (code === 'forbidden') {
    return new AppError(e.message || '没有权限执行此操作（可能已被移出团队）', 'forbidden')
  }
  if (code === 'conflict') {
    return new AppError(e.message || '内容已被他人更新，请重新加载后再试', 'conflict')
  }
  if (code === 'already_member') {
    return new AppError('你已在该团队中', 'already_member')
  }
  if (kind === 'credits-exhausted') {
    return new AppError('云服务额度不足，写入已停止，请联系团队管理员', 'credits-exhausted')
  }
  if (kind === 'rate-limited' || code === 'rate_limited' || code === 'rate-limited') {
    return new AppError('请求过于频繁，请稍后再试', 'rate-limited')
  }
  if (kind === 'network' || code === 'network') {
    return new AppError('网络请求失败，请检查网络后重试', 'network')
  }
  if (kind === 'invalid-request' || code === 'invalid') {
    return new AppError(e.message || '请求参数不合法', 'invalid')
  }
  if (kind === 'backend-unavailable' || code === 'backend-unavailable' || code === 'backend_unavailable') {
    return new AppError('服务暂时不可用，请稍后重试', 'backend-unavailable')
  }
  if (code === '23505' || code === 'already_exists') {
    return new AppError('该记录已存在', 'already_exists')
  }
  if (code === '23503') {
    return new AppError('关联的数据不存在或已被移除', 'invalid')
  }
  if (code === '23514') {
    return new AppError('数据不符合校验规则，请检查填写内容', 'invalid')
  }
  if (code === 'PGRST116' || code === 'not_found') {
    return new AppError('记录不存在或无权访问', 'not_found')
  }
  return new AppError(e.message || '操作失败，请稍后重试', code || 'unknown')
}

/** 把错误转成可直接显示的一行文本（不吞掉原始信息）。 */
export function errorMessage(err: unknown): string {
  return toAppError(err).message
}

/** 是否为"会话失效"类错误。 */
export function isSessionExpired(err: unknown): boolean {
  return toAppError(err).sessionExpired
}
