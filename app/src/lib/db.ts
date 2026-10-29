/**
 * Legacy WorkBuddy PostgREST helpers — retired.
 * Business modules use apiFetch against /api/teams|tasks|work-logs.
 */
import { AppError } from './errors'

function retired(): never {
  throw new AppError('自建 API 已取代 WorkBuddy 数据层', 'backend-unavailable')
}

export function fromTable(_table: string): never {
  return retired()
}

export function callRpc(_fn: string, _args?: Record<string, unknown>): never {
  return retired()
}

export async function expectRows<T>(_query: unknown): Promise<T[]> {
  return retired()
}

export async function expectMaybe<T>(_query: unknown): Promise<T | null> {
  return retired()
}

export async function expectOne<T>(_query: unknown, _missingMessage?: string): Promise<T> {
  return retired()
}

export async function expectOk(_query: unknown): Promise<void> {
  return retired()
}

export async function callRpcEnvelope<T = unknown>(
  _fn: string,
  _args?: Record<string, unknown>,
): Promise<{ ok: boolean; code: string; message: string; data?: T }> {
  return retired()
}

export async function expectRpc<T = unknown>(
  _fn: string,
  _args?: Record<string, unknown>,
): Promise<T | undefined> {
  return retired()
}
