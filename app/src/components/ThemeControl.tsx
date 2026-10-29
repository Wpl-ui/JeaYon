import { useSyncExternalStore } from 'react'
import { getThemePreference, setThemePreference, subscribeTheme } from '../theme/theme'

export function ThemeControl() {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference)

  return (
    <div className="theme-control" role="group" aria-label="外观">
      <span className="theme-control-label">外观</span>
      <div className="tabs">
        {([['system', '自动'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={preference === value ? 'tab active' : 'tab'}
            aria-pressed={preference === value}
            onClick={() => setThemePreference(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
