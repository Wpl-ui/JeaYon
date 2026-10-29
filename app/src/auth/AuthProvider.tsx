/**
 * Login state backed by self-hosted cookie sessions (/api/auth/me).
 *
 * Statuses:
 *  - signed-in: cookie session valid
 *  - signed-out: no session
 * Initial status comes from main.tsx awaiting fetchMe (or null).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { fetchMe, logoutSession, refreshSession } from './api'
import type { AuthSession, AuthUser } from './types'
import { errorMessage, isSessionExpired } from '../lib/errors'

export type AuthStatus = 'signed-in' | 'signed-out'

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  /** All business ownership checks use this. */
  userId: string | null
  expiredNotice: string | null
  /** Bumped on sign-out / expire so data layers discard stale results. */
  dataEpoch: number
  expireSession: (message?: string) => void
  clearExpiredNotice: () => void
  signOut: () => Promise<void>
  /** Re-read session (after OTP verify, or soft recovery). */
  syncSession: () => Promise<void>
  /** Apply a session returned by OTP verify without an extra round-trip. */
  acceptSession: (session: AuthSession) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const LOCAL_KEYS_TO_CLEAR = ['dwa:selectedTeamId']

function clearLocalUiState(): void {
  for (const key of LOCAL_KEYS_TO_CLEAR) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
}

export function AuthProvider({
  initialSession,
  children,
}: {
  initialSession: AuthSession | null
  children: ReactNode
}) {
  const [session, setSession] = useState<AuthSession | null>(initialSession)
  const [expiredNotice, setExpiredNotice] = useState<string | null>(null)
  const [dataEpoch, setDataEpoch] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const expireSession = useCallback((message?: string) => {
    setSession(null)
    setExpiredNotice(message ?? '登录状态已失效，请重新登录')
    setDataEpoch((n) => n + 1)
    clearLocalUiState()
  }, [])

  const clearExpiredNotice = useCallback(() => setExpiredNotice(null), [])

  const acceptSession = useCallback((next: AuthSession) => {
    setSession(next)
    setExpiredNotice(null)
  }, [])

  const syncSession = useCallback(async () => {
    try {
      const next = await fetchMe()
      if (!mounted.current) return
      setSession(next)
      setExpiredNotice(null)
      return
    } catch (err) {
      if (!mounted.current) return
      if (!isSessionExpired(err)) {
        // Keep whatever we had on transient/non-auth failures.
        return
      }
    }

    try {
      const next = await refreshSession()
      if (!mounted.current) return
      setSession(next)
      setExpiredNotice(null)
    } catch (err) {
      if (mounted.current) expireSession(errorMessage(err))
    }
  }, [expireSession])

  const signOut = useCallback(async () => {
    setDataEpoch((n) => n + 1)
    try {
      await logoutSession()
    } catch {
      // ignore
    }
    clearLocalUiState()
    setSession(null)
    setExpiredNotice(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: session ? 'signed-in' : 'signed-out',
      user: session?.user ?? null,
      userId: session?.user.id ?? null,
      expiredNotice,
      dataEpoch,
      expireSession,
      clearExpiredNotice,
      signOut,
      syncSession,
      acceptSession,
    }),
    [session, expiredNotice, dataEpoch, expireSession, clearExpiredNotice, signOut, syncSession, acceptSession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
