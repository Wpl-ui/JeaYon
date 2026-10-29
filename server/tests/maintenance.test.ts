import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { harness, type Harness } from './helpers.js';
import { maintain } from '../src/db/maintenance.js';
import { tokenHash } from '../src/auth/crypto.js';
describe('explicit PostgreSQL retention maintenance', () => {
  let h: Harness;
  before(async () => { h = await harness(); });
  after(async () => { await h?.close(); });
  it('cleans expired auth chains and quotas while preserving live login, identities and audit history', async () => {
    const { client, user, challenge } = await h.login('retention@example.test');
    const expired = randomUUID();
    const oldToken = randomUUID(); const nextToken = randomUUID();
    await sql`insert into sessions(id,user_id,created_at,absolute_expires_at,idle_expires_at,created_ip_hash)
      values(${expired},${user.id},now()-interval '75 days',now()-interval '40 days',now()-interval '70 days',${Buffer.alloc(32)})`.execute(h.db);
    await sql`insert into session_refresh_tokens(id,session_id,token_hash,expires_at,used_at)
      values(${oldToken},${expired},${tokenHash('public-retention-old')},now()-interval '70 days',now()-interval '74 days')`.execute(h.db);
    await sql`insert into session_refresh_tokens(id,session_id,token_hash,expires_at)
      values(${nextToken},${expired},${tokenHash('public-retention-next')},now()-interval '65 days')`.execute(h.db);
    await sql`update session_refresh_tokens set replaced_by=${nextToken} where id=${oldToken}`.execute(h.db);
    await sql`insert into audit_events(actor_user_id,session_id,action,outcome,request_id,occurred_at)
      values(${user.id},${expired},'retained-audit','success','public-test',now()-interval '60 days'),
      (${user.id},null,'expired-audit','success','public-test',now()-interval '91 days')`.execute(h.db);
    await sql`update otp_codes set created_at=now()-interval '3 days',expires_at=now()-interval '2 days' where id=${challenge}`.execute(h.db);
    await sql`insert into auth_rate_limits(scope,key_hash,window_start,window_seconds,count,expires_at)
      values('old-retention',${Buffer.alloc(32)},now()-interval '5 days',60,1,now()-interval '4 days')`.execute(h.db);
    await sql`insert into password_reauth(user_id,session_id,token_hash,created_at,expires_at) values(${user.id},${expired},${tokenHash('retention-reauth')},now()-interval '3 days',now()-interval '2 days')`.execute(h.db);
    assert.deepEqual(await maintain(h.db), { otp: 1, reauth: 1, quota: 1, audit: 1, sessions: 1 });
    assert.equal((await client.send('GET', '/api/auth/me')).statusCode, 200);
    const audit = (await sql<{session_id: string | null}>`select session_id from audit_events where action='retained-audit'`.execute(h.db)).rows[0];
    assert.deepEqual(audit, { session_id: null });
    assert.equal((await sql<{n: number}>`select count(*)::int as n from identities where user_id=${user.id}`.execute(h.db)).rows[0]?.n, 1);
    assert.equal((await sql<{n: number}>`select count(*)::int as n from session_refresh_tokens where session_id=${expired}`.execute(h.db)).rows[0]?.n, 0);
    assert.deepEqual(await maintain(h.db), { otp: 0, reauth: 0, quota: 0, audit: 0, sessions: 0 });
  });
});
