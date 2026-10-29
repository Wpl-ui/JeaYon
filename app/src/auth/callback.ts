/**
 * OAuth callback handler.
 *
 * WeChat OAuth is not available on the self-hosted stack. If legacy callback
 * query params appear, clear them and surface a clear failure — never fake login.
 */

const AUTH_PARAM_KEYS = [
  'code',
  'state',
  'provider',
  'provider_id',
  'error',
  'error_description',
  'error_uri',
] as const

export type CallbackOutcome =
  | { status: 'none' }
  | { status: 'signed-in' }
  | { status: 'failed'; message: string }

function cleanAuthParams(): void {
  const url = new URL(window.location.href)
  let changed = false
  for (const key of AUTH_PARAM_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (!changed) return
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(window.history.state, '', next || '/')
}

export async function dispatchOAuthCallback(): Promise<CallbackOutcome> {
  const search = window.location.search
  if (!search || search.length < 2) return { status: 'none' }

  const params = new URLSearchParams(search)
  if (!params.has('code') && !params.has('error') && !params.has('error_description')) {
    return { status: 'none' }
  }

  cleanAuthParams()
  return {
    status: 'failed',
    message: '自建部署暂未接入微信登录，请使用手机验证码登录',
  }
}
