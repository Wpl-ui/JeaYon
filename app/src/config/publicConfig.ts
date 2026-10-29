/**
 * Public frontend config for JeaYon (self-hosted).
 *
 * Auth + data all go same-origin to /api/* on APP_ORIGIN (https://jeayon.com).
 * No WorkBuddy endpoint / publishable key in the production path.
 */
const env = import.meta.env

export const publicConfig = {
  /** Product English name */
  appName: 'JeaYon',
  /** Canonical origin (informational; API is always same-origin `/api`) */
  appOrigin: (env.VITE_APP_ORIGIN as string | undefined) ?? 'https://jeayon.com',
} as const
