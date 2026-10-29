/**
 * Same-origin API client for the self-hosted backend.
 *
 * Cookies are httpOnly (__Secure-dwa_access / __Secure-dwa_refresh); every call
 * must use credentials:'include'. Mutating verbs also need the CSRF header and
 * a JSON content-type (see server onRequest hook).
 */
import { AppError } from './errors'

export type ApiOk<T> = { ok: true; code: 'ok'; message: string; data: T }
export type ApiFail = { ok: false; code: string; message: string; data?: unknown }

const CODE_MESSAGES: Record<string, string> = {
  unauthenticated: '登录状态已失效，请重新登录',
  registration_required: '请使用「注册 / 完成设密」，验证码与密码需一并提交',
  password_exists: '此账号已设置密码，请使用密码登录；注册不能覆盖密码',
  identity_required: '请先绑定手机号或邮箱后再修改密码',
  reauth_required: '验证已失效，请重新获取验证码并验证',
  invalid_credentials: '账号或密码不正确',
  invalid_code: '验证码错误或已失效，请重新获取',
  invalid: '请求参数不合法',
  rate_limited: '请求过于频繁，请稍后再试',
  'rate-limited': '请求过于频繁，请稍后再试',
  csrf_rejected: '请求被拒绝，请刷新页面后重试',
  delivery_unavailable: '验证码发送失败，请稍后重试',
  backend_unavailable: '服务暂时不可用，请稍后重试',
  'backend-unavailable': '服务暂时不可用，请稍后重试',
  refresh_conflict: '登录状态冲突，请重新登录',
  not_found: '资源不存在',
  already_exists: '该记录已存在',
  already_member: '你已在该团队中',
  forbidden: '没有权限执行此操作',
  conflict: '内容已被他人更新，请重新加载后再试',
  unknown: '操作失败，请稍后重试',
}

function messageFor(code: string, fallback?: string): string {
  return CODE_MESSAGES[code] ?? fallback ?? CODE_MESSAGES.unknown
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const method = (init.method ?? (init.json !== undefined ? 'POST' : 'GET')).toUpperCase()
  const headers = new Headers(init.headers)
  if (init.json !== undefined || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    headers.set('x-dwa-csrf', '1')
  }

  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      method,
      headers,
      credentials: 'include',
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    })
  } catch {
    throw new AppError('网络请求失败，请检查网络后重试', 'network')
  }

  let body: ApiOk<T> | ApiFail | null = null
  const text = await response.text()
  if (text) {
    try {
      body = JSON.parse(text) as ApiOk<T> | ApiFail
    } catch {
      body = null
    }
  }

  if (!response.ok || !body || body.ok !== true) {
    const code = body && 'code' in body ? String(body.code) : `http_${response.status}`
    const sessionExpired =
      code === 'unauthenticated' || (response.status === 401 && code !== 'invalid_credentials')
    const failData = body && 'data' in body ? body.data : undefined
    throw new AppError(
      messageFor(code, body && 'message' in body ? body.message : undefined),
      code,
      sessionExpired,
      failData,
    )
  }

  return body.data
}
