/**
 * Self-hosted login actions (OTP against /api/auth/*).
 * WeChat OAuth is not available on the self-hosted stack yet — never fake success.
 */
import { apiFetch } from '../lib/apiClient'
import { AppError } from '../lib/errors'
import type { AuthSession, OtpChallenge } from './types'

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '')
  if (/^1\d{10}$/.test(digits)) return `+86${digits}`
  if (/^\+861\d{10}$/.test(digits)) return digits
  return null
}

export function normalizeEmail(input: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(input)) return null
  const email = input.trim().toLowerCase()
  const [local, domain] = email.split('@')
  if (email.length > 254 || !local || local.length > 64 || !domain ||
      !/^[a-z0-9!#$%&'*+\/=?^_`{|}~.-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      domain.split('.').some(s => !s || s.length > 63 || s.startsWith('-') || s.endsWith('-'))) return null
  return email
}

type OtpRequestData = {
  challenge_id: string
  expires_in: number
  retry_after: number
}

type MeData = AuthSession

function toChallenge(data: OtpRequestData): OtpChallenge {
  return {
    challengeId: data.challenge_id,
    expiresIn: data.expires_in,
    retryAfter: data.retry_after,
  }
}

/** Request a phone OTP. Staging prints the code to API container logs (console provider). */
export async function requestPhoneCode(phoneInput: string, purpose: 'login' | 'register' = 'login'): Promise<OtpChallenge> {
  const phone = normalizePhone(phoneInput)
  if (!phone) throw new AppError('请输入正确的 11 位手机号', 'invalid')

  const data = await apiFetch<OtpRequestData>('/api/auth/otp/request', {
    method: 'POST',
    json: { channel: 'phone', target: phone, purpose },
  })
  return toChallenge(data)
}

/** Request an email OTP (same console provider on staging). */
export async function requestEmailCode(emailInput: string, purpose: 'login' | 'register' = 'login'): Promise<OtpChallenge> {
  const email = normalizeEmail(emailInput)
  if (!email) throw new AppError('请输入正确的邮箱地址', 'invalid')

  const data = await apiFetch<OtpRequestData>('/api/auth/otp/request', {
    method: 'POST',
    json: { channel: 'email', target: email, purpose },
  })
  return toChallenge(data)
}

/** Verify OTP and establish cookie session. Returns the me() payload. */
export async function verifyOtpCode(challengeId: string, token: string): Promise<AuthSession> {
  const trimmed = token.replace(/\s/g, '')
  if (!/^\d{4,8}$/.test(trimmed)) throw new AppError('请输入收到的验证码', 'invalid')

  return apiFetch<MeData>('/api/auth/otp/verify', {
    method: 'POST',
    json: { challenge_id: challengeId, code: trimmed },
  })
}

/** @deprecated Prefer verifyOtpCode — kept name for LoginPage compatibility. */
export async function verifyPhoneCode(challengeId: string, token: string): Promise<AuthSession> {
  return verifyOtpCode(challengeId, token)
}

export async function fetchMe(): Promise<AuthSession> {
  return apiFetch<MeData>('/api/auth/me')
}

export async function updateAccountName(name: string): Promise<AuthSession> {
  const normalized = name.replace(/^ +| +$/g, '')
  const length = Array.from(normalized).length
  if (length < 1 || length > 40 || /^\s*$/.test(normalized) || normalized.includes('\0')) throw new AppError('账号名需为 1–40 个字符', 'invalid')
  return apiFetch<MeData>('/api/auth/me', { method: 'PATCH', json: { name: normalized } })
}

export async function refreshSession(): Promise<AuthSession> {
  return apiFetch<MeData>('/api/auth/refresh', { method: 'POST', json: {} })
}

export async function logoutSession(): Promise<void> {
  try {
    await apiFetch<null>('/api/auth/logout', { method: 'POST', json: {} })
  } catch {
    // Local sign-out must succeed even if the server call fails.
  }
}

/** WeChat is not wired on self-host; never redirect or fake success. */
export async function startWechatLogin(): Promise<void> {
  throw new AppError('自建部署暂未接入微信登录，请使用手机验证码登录', 'invalid')
}

/** Password login (phone or email). Same cookie session as OTP. */
export async function passwordLogin(
  channel: 'phone' | 'email',
  targetInput: string,
  password: string,
): Promise<AuthSession> {
  const target = channel === 'phone' ? normalizePhone(targetInput) : normalizeEmail(targetInput)
  if (!target) throw new AppError(channel === 'phone' ? '请输入正确的 11 位手机号' : '请输入正确的邮箱地址', 'invalid')
  if (password.length > 256) throw new AppError('登录密码不能超过 256 位', 'invalid')
  return apiFetch<MeData>('/api/auth/password/login', {
    method: 'POST',
    json: { channel, target, password },
  })
}

function checkNewPassword(password: string) {
  if (password.length < 8 || password.length > 128) throw new AppError('密码需为 8–128 位', 'invalid')
  if (/[\u0000-\u001f\u007f]/.test(password)) throw new AppError('密码不能包含控制字符', 'invalid')
}

/** Signup also completes legacy passwordless accounts after identity OTP. */
export async function registerAccount(challengeId: string, code: string, password: string): Promise<AuthSession> {
  checkNewPassword(password)
  return apiFetch<MeData>('/api/auth/register', { method: 'POST', json: { challenge_id: challengeId, code, password } })
}

export async function requestPasswordReauth(): Promise<OtpChallenge> {
  return toChallenge(await apiFetch<OtpRequestData>('/api/auth/reauth/request', { method: 'POST', json: {} }))
}

export async function verifyPasswordReauth(challengeId: string, code: string): Promise<{ reauth_token: string; expires_in: number }> {
  return apiFetch('/api/auth/reauth/verify', { method: 'POST', json: { challenge_id: challengeId, code } })
}

/** Password changes always require current password and a one-use OTP step-up. */
export async function setAccountPassword(password: string, currentPassword: string, reauthToken: string): Promise<AuthSession> {
  checkNewPassword(password)
  if (!currentPassword) throw new AppError('请输入当前密码', 'invalid')
  if (!reauthToken) throw new AppError('请先完成验证码验证', 'reauth_required')
  return apiFetch<MeData>('/api/auth/password/change', {
    method: 'POST', json: { password, current_password: currentPassword, reauth_token: reauthToken },
  })
}
