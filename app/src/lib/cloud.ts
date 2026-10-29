/**
 * WorkBuddy Cloud client removed — JeaYon uses the self-hosted /api/* backend.
 * Kept as a stub so accidental imports fail loudly at runtime instead of calling WorkBuddy.
 */
export const cloud: never = (() => {
  throw new Error('WorkBuddy Cloud is no longer used; call /api/* via apiClient')
})() as never

export type CloudClient = never
