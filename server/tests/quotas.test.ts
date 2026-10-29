import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { sql } from 'kysely';
import { harness, type Harness } from './helpers.js';
import { keyedHash } from '../src/auth/crypto.js';
import { quota } from '../src/auth/quotas.js';
describe('real PostgreSQL quota boundaries', () => {
  let h: Harness;
  before(async () => { h = await harness(); });
  after(async () => { await h?.close(); });
  it('target sends stop at five per hour even when cooldown has elapsed', async () => {
    const target = 'hourly@example.test';
    for (let i = 0; i < 5; i++) {
      assert.equal((await h.client().send('POST', '/api/auth/otp/request', { channel: 'email', target, purpose: 'login' })).statusCode, 202);
      await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='send_cooldown' and key_hash=${keyedHash(h.config.RATE_LIMIT_HMAC_SECRET, target)}`.execute(h.db);
    }
    const r = await h.client().send('POST', '/api/auth/otp/request', { channel: 'email', target, purpose: 'login' });
    assert.equal(r.statusCode, 429);
    assert.ok(Number(r.headers['retry-after']) <= 3600);
  });
  it('daily target and IP reservations use Asia/Shanghai midnight buckets', async () => {
    const now = Date.now();
    const start = new Date((Math.floor((now / 1000 + 28800) / 86400) * 86400 - 28800) * 1000);
    await quota(h.db, h.config.RATE_LIMIT_HMAC_SECRET, [{ scope: 'daily_boundary', key: 'public-test-target', seconds: 86400, max: 1 }]);
    const found = (await sql<{window_start: Date; expires_at: Date}>`select window_start,expires_at from auth_rate_limits where scope='daily_boundary'`.execute(h.db)).rows[0]!;
    assert.equal(found.window_start.getTime(), start.getTime());
    assert.equal(found.expires_at.getTime(), start.getTime() + 86400000);
    await assert.rejects(quota(h.db, h.config.RATE_LIMIT_HMAC_SECRET, [{ scope: 'daily_boundary', key: 'public-test-target', seconds: 86400, max: 1 }]));
  });
  it('target failure budget stops even a correct code after twenty failures', async () => {
    const target = 'verify-budget@example.test';
    let last = '';
    for (let i = 0; i < 4; i++) {
      const c = h.client();
      const request = await c.send('POST', '/api/auth/otp/request', { channel: 'email', target, purpose: 'login' });
      assert.equal(request.statusCode, 202);
      last = request.json().data.challenge_id;
      for (let attempt = 0; attempt < 5; attempt++) assert.equal((await c.send('POST', '/api/auth/otp/verify', { challenge_id: last, code: 'wrong' })).statusCode, 400);
      await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='send_cooldown' and key_hash=${keyedHash(h.config.RATE_LIMIT_HMAC_SECRET, target)}`.execute(h.db);
    }
    const c = h.client();
    const request = await c.send('POST', '/api/auth/otp/request', { channel: 'email', target, purpose: 'login' });
    assert.equal(request.statusCode, 202);
    last = request.json().data.challenge_id;
    assert.equal((await c.send('POST', '/api/auth/otp/verify', { challenge_id: last, code: h.codes.get(last)!.code })).statusCode, 429);
  });
  it('verify IP budget limits unknown challenges to thirty per fixed minute', async () => {
    const c = h.client();
    let accepted = 0;
    for (let i = 0; i <= 60; i++) {
      const r = await c.send('POST', '/api/auth/otp/verify', { challenge_id: '00000000-0000-4000-8000-000000000000', code: '000000' });
      if (r.statusCode === 429) break;
      assert.equal(r.statusCode, 400); accepted++;
    }
    assert.ok(accepted >= 30 && accepted < 60);
    const buckets = await sql<{count: number}>`select count from auth_rate_limits where scope='verify_ip' and window_seconds=60`.execute(h.db);
    assert.ok(buckets.rows.every(r => r.count <= 30));
  });
  it('authenticated general API budget stops at 120 calls per fixed window', async () => {
    const { client } = await h.login('api-budget@example.test');
    let accepted = 0;
    let denied = false;
    // Allow one real wall-clock minute boundary during this loop; never assume a rolling window.
    for (let i = 0; i <= 240; i++) {
      const r = await client.send('GET', '/api/auth/me');
      if (r.statusCode === 429) { denied = true; break; }
      assert.equal(r.statusCode, 200);
      accepted++;
    }
    assert.ok(denied && accepted >= 120 && accepted < 240);
    const buckets = await sql<{count: number}>`select count from auth_rate_limits where scope='api_user'`.execute(h.db);
    assert.ok(buckets.rows.every(r => r.count <= 120));
    assert.ok(buckets.rows.some(r => r.count === 120));
  });
  it('join quota limits guessing to ten per fixed minute', async () => {
    const { client } = await h.login('join-budget@example.test');
    let accepted = 0;
    for (let i = 0; i <= 20; i++) {
      const r = await client.send('POST', '/api/teams/join', { code: 'UNKNOWN123', display_name: 'Guest' });
      if (r.statusCode === 429) break;
      assert.equal(r.statusCode, 400); accepted++;
    }
    assert.ok(accepted >= 10 && accepted < 20);
    const buckets = await sql<{count: number}>`select count from auth_rate_limits where scope='join_user' and window_seconds=60`.execute(h.db);
    assert.ok(buckets.rows.every(r => r.count <= 10));
  });
  it('multi-dimensional quota reservations roll back together', async () => {
    const a = { scope: 'atomic_a', key: 'a', seconds: 3600, max: 10 };
    const b = { scope: 'atomic_b', key: 'b', seconds: 3600, max: 1 };
    await quota(h.db, h.config.RATE_LIMIT_HMAC_SECRET, [b]);
    await assert.rejects(quota(h.db, h.config.RATE_LIMIT_HMAC_SECRET, [a, b]));
    assert.equal((await sql<{n: number}>`select count(*)::int as n from auth_rate_limits where scope='atomic_a'`.execute(h.db)).rows[0]?.n, 0);
  });
});
