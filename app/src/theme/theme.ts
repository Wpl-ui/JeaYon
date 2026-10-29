export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'dwa-theme'
const listeners = new Set<() => void>()

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isThemePreference(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

let preference = readPreference()
// This module runs before React mounts, including on the sign-in screen.
document.documentElement.dataset.theme = preference

export function getThemePreference(): ThemePreference {
  return preference
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setThemePreference(next: ThemePreference): void {
  preference = next
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // The preference still applies for this page if storage is unavailable.
  }
  listeners.forEach((listener) => listener())
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return
  preference = readPreference()
  document.documentElement.dataset.theme = preference
  listeners.forEach((listener) => listener())
})
