/**
 * App bootstrap.
 *
 * 1. Handle leftover OAuth callback params (WeChat not available on self-host).
 * 2. Read cookie session via GET /api/auth/me (401 → signed-out, not an error).
 * 3. Render.
 */
import './theme/theme'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { dispatchOAuthCallback } from './auth/callback'
import { fetchMe } from './auth/api'
import type { AuthSession } from './auth/types'
import { errorMessage, isSessionExpired, toAppError } from './lib/errors'
import './styles/global.css'

async function bootstrap(): Promise<void> {
  const callback = await dispatchOAuthCallback()
  const callbackError = callback.status === 'failed' ? callback.message : null

  let initialSession: AuthSession | null = null
  let sessionError: string | null = null
  try {
    initialSession = await fetchMe()
  } catch (err) {
    if (!isSessionExpired(err)) {
      const normalized = toAppError(err)
      if (normalized.code !== 'unauthenticated') sessionError = errorMessage(err)
    }
  }

  const container = document.getElementById('root')
  if (!container) {
    throw new Error('页面缺少 #root 挂载点')
  }

  createRoot(container).render(
    <StrictMode>
      <App initialSession={initialSession} bootNotice={callbackError ?? sessionError} />
    </StrictMode>,
  )
}

void bootstrap()
