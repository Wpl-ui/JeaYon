import { sql } from 'kysely';
import type { Database } from './index.js';
// Explicit owner/migrator maintenance only; never called from API handlers or startup.
export async function maintain(db: Database) {
  return db.transaction().execute(async tx => {
    const otp = await sql`delete from otp_codes where expires_at < now()-interval '24 hours' returning id`.execute(tx);
    const reauth = await sql`delete from password_reauth where expires_at < now()-interval '24 hours' returning id`.execute(tx);
    const quota = await sql`delete from auth_rate_limits where expires_at < now()-interval '48 hours' returning scope`.execute(tx);
    const audit = await sql`delete from audit_events where occurred_at < now()-interval '90 days' returning id`.execute(tx);
    const expired = await sql<{id: string}>`select id from sessions where absolute_expires_at < now()-interval '30 days' order by id for update skip locked`.execute(tx);
    const ids = expired.rows.map(r => r.id);
    if (ids.length) {
      const list = sql.join(ids);
      await sql`update audit_events set session_id=null where session_id in (${list})`.execute(tx);
      // All members of a refresh chain are removed together, satisfying its self-reference FK.
      await sql`delete from session_refresh_tokens where session_id in (${list})`.execute(tx);
      await sql`delete from sessions where id in (${list})`.execute(tx);
    }
    return { otp: otp.rows.length, reauth: reauth.rows.length, quota: quota.rows.length, audit: audit.rows.length, sessions: ids.length };
  });
}
