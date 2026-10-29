/** Self-hosted auth user (from GET /api/auth/me and OTP/password login). */
export type AuthUser = {
  id: string
  name: string | null
  email?: string
  phone?: string
  isAnonymous?: boolean
  /** True when a password hash is stored for this account. */
  has_password?: boolean
}

export type AuthSession = {
  user: AuthUser
  expiresAt: number
}

export type OtpChallenge = {
  challengeId: string
  expiresIn: number
  retryAfter: number
}
