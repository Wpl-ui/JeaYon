import { sql } from 'kysely';
import type { Connection, Database } from '../db/index.js';
import { first } from '../db/index.js';
import { ApiError } from '../http.js';
import { keyedHash } from './crypto.js';
export type Quota = { scope: string; key: string; seconds: number; max: number; cooldown?: boolean };
// All callers supply stable scope order. Transactional reservations persist across processes/restarts.
export async function reserve(tx: Connection, secret: string, quotas: Quota[]) {
  const now = Date.now();
  for (const q of quotas) {
    const offset = q.seconds === 86400 ? 8 * 3600 : 0;
    const bucket = q.cooldown ? 0 : (Math.floor((now / 1000 + offset) / q.seconds) * q.seconds - offset) * 1000;
    const expires = new Date((q.cooldown ? now : bucket) + q.seconds * 1000);
    const key = keyedHash(secret, q.key);
    const row = await first(tx, sql<{count: number; expires_at: Date}>`
      insert into auth_rate_limits(scope,key_hash,window_start,window_seconds,count,expires_at)
      values(${q.scope},${key},${new Date(bucket)},${q.seconds},1,${expires})
      on conflict(scope,key_hash,window_start,window_seconds) do update set
        count=case when auth_rate_limits.expires_at <= ${new Date(now)} then 1 else auth_rate_limits.count+1 end,
        expires_at=case when auth_rate_limits.expires_at <= ${new Date(now)} then ${expires} else auth_rate_limits.expires_at end
      returning count,expires_at`);
    if (row && row.count > q.max) throw new ApiError(429, 'rate-limited', undefined, Math.max(1, Math.ceil((row.expires_at.getTime() - now) / 1000)));
  }
}
export function quota(db: Database, secret: string, quotas: Quota[]) { return db.transaction().execute(tx => reserve(tx, secret, quotas)); }
export const windows = (scope: string, key: string, caps: [number, number][]): Quota[] => caps.map(([seconds, max]) => ({ scope, key, seconds, max }));
