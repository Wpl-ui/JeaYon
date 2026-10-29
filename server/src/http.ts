import { z } from 'zod';
export class ApiError extends Error {
  constructor(public status: number, public code: string, public data?: unknown, public retryAfter?: number) { super(code); }
}
export function ok<T>(data: T) { return { ok: true, code: 'ok', message: 'ok', data }; }
export const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const version = z.number().int().positive();
export const shortText = z.string().trim().min(1).max(40);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= '0001-01-01';
});
export function dto(value: unknown, parentKey = ''): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(item => dto(item, parentKey));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => {
    if (!(parentKey === 'user' && k === 'id') && ['id', 'team_id', 'related_task_id', 'parent_id'].includes(k) && typeof v === 'string' && /^\d+$/.test(v)) {
      const n = Number(v);
      if (!Number.isSafeInteger(n)) throw new ApiError(500, 'id_overflow');
      return [k, n];
    }
    return [k, dto(v, k)];
  }));
  return value;
}
