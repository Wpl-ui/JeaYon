/**
 * 团队范围内的数据查询 hook。
 *
 * 一次性解决四件事，避免每个页面各写一遍：
 *  - **旧响应不回填**：每次查询领一张 `ticket`，只有仍是最新的才允许写状态；
 *    切团队、退出登录、卸载都会让在途请求作废。
 *  - **会话失效上抛**：捕获到 401 直接 `expireSession`，由登录页接管。
 *  - **手动刷新**：返回 `reload()`；页面重新获得焦点时也会自动重查（首版无实时推送）。
 *  - **可写回**：返回 `mutate()`，供乐观更新与"失败后重新拉取服务端状态"使用。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { errorMessage, isSessionExpired } from '../lib/errors'
import { RequestGuard } from '../lib/request-guard'

export interface TeamQueryState<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** 手动重新查询（服务端为准）。 */
  reload: () => void
  /** 直接替换本地数据（乐观更新 / 回滚 / 局部合并）。 */
  mutate: (next: T | null | ((prev: T | null) => T | null)) => void
}

/**
 * @param teamId  当前团队；为 null 时不发请求并清空数据
 * @param loader  真正的查询函数（内部通过 ref 持有，不需要 useCallback 包裹）
 * @param options `enabled: false` 可暂停查询（例如抽屉未打开时）
 */
export function useTeamQuery<T>(
  teamId: number | null,
  loader: (teamId: number) => Promise<T>,
  options: { enabled?: boolean } = {},
): TeamQueryState<T> {
  const enabled = options.enabled !== false
  const { dataEpoch, expireSession } = useAuth()

  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const guard = useRef(new RequestGuard())
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    if (teamId === null || !enabled) {
      guard.current.invalidate()
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    const ticket = guard.current.next()
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const result = await loaderRef.current(teamId)
        if (!guard.current.isCurrent(ticket)) return
        setData(result)
      } catch (err) {
        if (!guard.current.isCurrent(ticket)) return
        if (isSessionExpired(err)) {
          expireSession(errorMessage(err))
          return
        }
        setError(errorMessage(err))
      } finally {
        if (guard.current.isCurrent(ticket)) setLoading(false)
      }
    })()

    // 依赖变化或卸载时作废这一轮请求：旧团队 / 旧会话的响应不得写进当前状态
    return () => {
      guard.current.invalidate()
    }
  }, [teamId, enabled, dataEpoch, nonce, expireSession])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const mutate = useCallback((next: T | null | ((prev: T | null) => T | null)) => {
    setData((prev) => (typeof next === 'function' ? (next as (p: T | null) => T | null)(prev) : next))
  }, [])

  // 回到页面时重新查询，避免看到过期数据（首版不做实时推送）
  useEffect(() => {
    if (!enabled || teamId === null) return
    const onFocus = () => reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, teamId, reload])

  return { data, loading, error, reload, mutate }
}
