import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { harness, type Harness, Client } from './helpers.js';
import { buildApp } from '../src/app.js';
import { ConsoleProvider } from '../src/auth/providers.js';
import { hashPassword } from '../src/auth/password.js';
import { normalize, keyedHash } from '../src/auth/crypto.js';

describe('real PostgreSQL authentication lifecycle', () => {
  let h: Harness;
  before(async () => { h = await harness(); });
  after(async () => { await h?.close(); });
  let sequence = 0;
  async function challenge(target = `auth${sequence++}@example.test`, channel: 'email' | 'phone' = 'email', client = h.client()) {
    const normalized = normalize(channel, target);
    const existing = await sql`select 1 from identities where kind=${channel} and identifier_normalized=${normalized}`.execute(h.db);
    if (!existing.rows.length) {
      const hash = await hashPassword('initial-test-password');
      const user = (await sql<{id: string}>`insert into users(password_hash,password_updated_at) values(${hash},now()) returning id`.execute(h.db)).rows[0]!;
      await sql`insert into identities(user_id,kind,identifier_normalized) values(${user.id},${channel},${normalized})`.execute(h.db);
    }
    const r = await client.send('POST', '/api/auth/otp/request', { channel, target, purpose: 'login' });
    assert.equal(r.statusCode, 202, r.body);
    const id = r.json().data.challenge_id as string;
    const code = h.codes.get(id)!.code;
    return { id, code, client, target, response: r };
  }
  it('live and readiness require the real schema; latest migration is ready', async () => {
    assert.equal((await h.client().send('GET', '/api/health/live')).statusCode, 200);
    assert.equal((await h.client().send('GET', '/api/health/ready')).statusCode, 200);
  });
  it('logs an existing password account in via console OTP and httpOnly cookies', async () => {
    const c = await challenge('Mixed.Case+tag@Example.TEST');
    assert.equal(c.response.json().data.expires_in, 300);
    assert.ok(c.response.json().data.retry_after <= 60);
    const r = await c.client.send('POST', '/api/auth/otp/verify', { challenge_id: c.id, code: c.code });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().data.user.email, 'mixed.case+tag@example.test');
    assert.ok(r.cookies.every(cookie => cookie.httpOnly && cookie.sameSite === 'Lax'));
    assert.deepEqual(r.cookies.map(cookie => cookie.path).sort(), ['/api', '/api/auth']);
    assert.ok(!r.body.includes(c.code));
    assert.equal((await c.client.send('GET', '/api/auth/me')).statusCode, 200);
    const found = await sql<{state: string; length: number}>`select state,octet_length(code_hmac) as length from otp_codes where id=${c.id}`.execute(h.db);
    assert.deepEqual(found.rows[0], { state: 'consumed', length: 32 });
  });
  it('phone login normalizes to mainland E.164', async () => {
    const { user } = await h.login('138-0013-8000', 'phone');
    assert.equal(user.phone, '+8613800138000');
  });
  it('returns the same user for normalized existing email without enumeration fields', async () => {
    const first = await h.login('repeat@example.test');
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='send_cooldown' and key_hash=${keyedHash(h.config.RATE_LIMIT_HMAC_SECRET, 'repeat@example.test')}`.execute(h.db);
    const c = await challenge(' REPEAT@EXAMPLE.TEST ');
    assert.deepEqual(Object.keys(c.response.json().data).sort(), ['challenge_id', 'expires_in', 'retry_after']);
    const verified = await c.client.send('POST', '/api/auth/otp/verify', { challenge_id: c.id, code: c.code });
    assert.equal(verified.json().data.user.id, first.user.id);
  });
  it('consumes a code only once under parallel real-DB requests', async () => {
    const c = await challenge();
    const results = await Promise.all([c.client, h.client()].map(client => client.send('POST', '/api/auth/otp/verify', { challenge_id: c.id, code: c.code })));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 400]);
  });
  it('counts malformed candidate codes and closes after exactly five failed attempts', async () => {
    const c = await challenge();
    for (let i = 0; i < 5; i++) {
      const r = await c.client.send('POST', '/api/auth/otp/verify', { challenge_id: c.id, code: 'bad-format' });
      assert.equal(r.statusCode, 400);
      assert.equal(r.json().code, 'invalid_code');
    }
    assert.equal((await sql<{attempts: number}>`select attempts from otp_codes where id=${c.id}`.execute(h.db)).rows[0]!.attempts, 5);
    assert.equal((await c.client.send('POST', '/api/auth/otp/verify', { challenge_id: c.id, code: c.code })).statusCode, 400);
  });
  it('rejects expiry, unknown, pending and consumed codes with the same error', async () => {
    const c = await challenge();
    await sql`update otp_codes set created_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' where id=${c.id}`.execute(h.db);
    const expired = await c.client.send('POST', '/api/auth/otp/verify', { challenge_id: c.id, code: c.code });
    const unknown = await c.client.send('POST', '/api/auth/otp/verify', { challenge_id: randomUUID(), code: c.code });
    assert.deepEqual(expired.json(), unknown.json());
    await sql`update otp_codes set state='pending',expires_at=now()+interval '5 minutes' where id=${c.id}`.execute(h.db);
    assert.deepEqual((await c.client.send('POST', '/api/auth/otp/verify', { challenge_id: c.id, code: c.code })).json(), unknown.json());
  });
  it('supersedes the previous code when resending after cooldown', async () => {
    const c = await challenge();
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='send_cooldown' and key_hash=${keyedHash(h.config.RATE_LIMIT_HMAC_SECRET, c.target)}`.execute(h.db);
    const next = await challenge(c.target);
    assert.equal((await c.client.send('POST', '/api/auth/otp/verify', { challenge_id: c.id, code: c.code })).statusCode, 400);
    assert.equal((await next.client.send('POST', '/api/auth/otp/verify', { challenge_id: next.id, code: next.code })).statusCode, 200);
  });
  it('rotates refresh, returns a brief concurrent conflict, then revokes on replay', async () => {
    const { client } = await h.login('rotate@example.test');
    const old = client.cookieHeader();
    const refreshed = await client.send('POST', '/api/auth/refresh', {});
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    assert.notEqual(client.cookieHeader(), old);
    const conflict = await client.send('POST', '/api/auth/refresh', {}, { cookie: old });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().code, 'refresh_conflict');
    assert.equal(conflict.cookies.length, 0);
    const previousHash = [...(await sql<{token_hash: Buffer}>`select token_hash from session_refresh_tokens where used_at is not null`.execute(h.db)).rows];
    assert.ok(previousHash.length);
    await sql`update session_refresh_tokens set used_at=now()-interval '6 seconds',expires_at=now()-interval '1 second' where used_at is not null`.execute(h.db);
    assert.equal((await client.send('POST', '/api/auth/refresh', {}, { cookie: old })).statusCode, 401);
    assert.equal((await client.send('GET', '/api/auth/me')).statusCode, 401);
  });
  it('parallel refresh issues exactly one new refresh token', async () => {
    const { client } = await h.login('parallel-refresh@example.test');
    const cookie = client.cookieHeader();
    const r = await Promise.all([h.client(), h.client()].map(c => c.send('POST', '/api/auth/refresh', {}, { cookie })));
    assert.deepEqual(r.map(v => v.statusCode).sort(), [200, 409]);
    assert.equal(r.filter(v => v.cookies.length > 0).length, 1);
  });
  it('logout immediately invalidates old access and refresh cookies, and is idempotent', async () => {
    const { client } = await h.login('logout@example.test');
    const old = client.cookieHeader();
    const r = await client.send('POST', '/api/auth/logout', {});
    assert.equal(r.statusCode, 200);
    assert.ok(r.cookies.every(c => c.value === '' && c.path));
    assert.equal((await client.send('GET', '/api/auth/me', undefined, { cookie: old })).statusCode, 401);
    assert.equal((await client.send('POST', '/api/auth/refresh', {}, { cookie: old })).statusCode, 401);
    assert.equal((await h.client().send('POST', '/api/auth/logout', {})).statusCode, 200);
  });
  it('disabled users and expired sessions cannot use previously valid JWTs', async () => {
    const { client, user } = await h.login('disabled@example.test');
    await sql`update users set status='disabled' where id=${user.id}`.execute(h.db);
    assert.equal((await client.send('GET', '/api/auth/me')).statusCode, 401);
    assert.equal((await client.send('POST', '/api/auth/refresh', {})).statusCode, 401);
    const second = await h.login('expired-session@example.test');
    await sql`update sessions set created_at=now()-interval '2 days',idle_expires_at=now()-interval '1 day' where user_id=${second.user.id}`.execute(h.db);
    assert.equal((await second.client.send('GET', '/api/auth/me')).statusCode, 401);
  });
  it('tampered JWT cannot authenticate', async () => {
    const { client } = await h.login('tampered@example.test');
    client.cookies.set('dwa_access', `${client.cookies.get('dwa_access')!}x`);
    assert.equal((await client.send('GET', '/api/auth/me')).statusCode, 401);
  });
  it('unimplemented purposes and client identity injection are rejected', async () => {
    const c = h.client();
    assert.equal((await c.send('POST', '/api/auth/otp/request', { channel: 'email', target: 'a@example.test', purpose: 'link' })).statusCode, 400);
    assert.equal((await c.send('POST', '/api/auth/otp/request', { channel: 'email', target: 'a@example.test', purpose: 'login', user_id: 'forged' })).statusCode, 400);
  });
});

describe('CSRF, durable quotas, delivery failures and readiness', () => {
  let h: Harness;
  before(async () => { h = await harness(); });
  after(async () => { await h?.close(); });
  for (const headers of [{ origin: '' }, { origin: 'null' }, { origin: 'https://evil.example' }, { 'x-dwa-csrf': '' }, { 'content-type': 'text/plain' }] as Record<string, string>[]) it(`rejects CSRF ${JSON.stringify(headers)}`, async () => {
    const r = await h.client().send('POST', '/api/auth/otp/request', { channel: 'email', target: 'csrf@example.test', purpose: 'login' }, headers);
    assert.equal(r.statusCode, 403);
    assert.equal(r.json().code, 'csrf_rejected');
  });
  it('rejects untrusted preflight without CORS allow headers', async () => {
    const r = await h.client().send('OPTIONS', '/api/auth/otp/request', undefined, { origin: 'https://evil.example' });
    assert.ok(r.statusCode >= 400);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });
  it('enforces exact target cooldown across IPs and a process restart', async () => {
    const b = { channel: 'email', target: 'quota@example.test', purpose: 'login' };
    assert.equal((await h.client().send('POST', '/api/auth/otp/request', b)).statusCode, 202);
    const denied = await h.client().send('POST', '/api/auth/otp/request', b);
    assert.equal(denied.statusCode, 429);
    assert.ok(Number(denied.headers['retry-after']) > 0);
    const provider = new ConsoleProvider('development', undefined, () => {});
    const restarted = buildApp(h.config, { db: h.db, providers: { email: provider, sms: provider } });
    try { assert.equal((await new Client(restarted, h.config.APP_ORIGIN, '198.51.100.1').send('POST', '/api/auth/otp/request', b)).statusCode, 429); }
    finally { await restarted.close(); }
  });
  it('enforces per-IP sends and ignores forged X-Forwarded-For', async () => {
    const c = h.client();
    let accepted = 0;
    for (let i = 0; i <= 20; i++) {
      const r = await c.send('POST', '/api/auth/otp/request', { channel: 'email', target: `ip${i}@example.test`, purpose: 'login' }, { 'x-forwarded-for': `203.0.113.${i + 1}` });
      if (r.statusCode === 429) break;
      assert.equal(r.statusCode, 202); accepted++;
    }
    assert.ok(accepted >= 10 && accepted < 20); // May cross one fixed minute boundary.
    const buckets = await sql<{count: number}>`select count from auth_rate_limits where scope='send_ip' and window_seconds=60`.execute(h.db);
    assert.ok(buckets.rows.every(r => r.count <= 10));
  });
  it('enforces the daily provider budget in real DB', async () => {
    const provider = new ConsoleProvider('development', undefined, () => {});
    const capped = buildApp({ ...h.config, OTP_SMS_DAILY_CAP: 1 }, { db: h.db, providers: { email: provider, sms: provider } });
    try {
      const c = new Client(capped, h.config.APP_ORIGIN, '198.51.100.2');
      assert.equal((await c.send('POST', '/api/auth/otp/request', { channel: 'phone', target: '13900139000', purpose: 'login' })).statusCode, 202);
      assert.equal((await c.send('POST', '/api/auth/otp/request', { channel: 'phone', target: '13900139001', purpose: 'login' })).statusCode, 429);
    } finally { await capped.close(); }
  });
  it('reports provider rejection as 503 and leaves the challenge unusable', async () => {
    const unavailable = { async sendCode(): Promise<never> { throw new Error('stubbed delivery outage'); } };
    const app = buildApp(h.config, { db: h.db, providers: { email: unavailable, sms: unavailable } });
    try {
      const r = await new Client(app, h.config.APP_ORIGIN, '198.51.100.3').send('POST', '/api/auth/otp/request', { channel: 'email', target: 'failed@example.test', purpose: 'login' });
      assert.equal(r.statusCode, 503);
      assert.equal(r.json().code, 'delivery_unavailable');
      const row = (await sql<{state: string}>`select state from otp_codes where target_normalized='failed@example.test'`.execute(h.db)).rows[0];
      assert.equal(row?.state, 'failed');
    } finally { await app.close(); }
  });
  it('does not revive a superseded challenge on a late provider receipt', async () => {
    const delayed = { async sendCode(input: { challengeId: string }) {
      await sql`update otp_codes set state='superseded' where id=${input.challengeId}`.execute(h.db);
      return { providerRequestId: 'late' };
    } };
    const app = buildApp(h.config, { db: h.db, providers: { email: delayed, sms: delayed } });
    try {
      const r = await new Client(app, h.config.APP_ORIGIN, '198.51.100.4').send('POST', '/api/auth/otp/request', { channel: 'email', target: 'late@example.test', purpose: 'login' });
      assert.equal(r.statusCode, 503);
      assert.equal((await sql<{state: string}>`select state from otp_codes where target_normalized='late@example.test'`.execute(h.db)).rows[0]?.state, 'superseded');
    } finally { await app.close(); }
  });
  it('readiness fails if the latest migration is absent, while liveness remains available', async () => {
    await sql`update kysely_migration set name='missing_test_version' where name='005_user_password'`.execute(h.db);
    try {
      assert.equal((await h.client().send('GET', '/api/health/ready')).statusCode, 503);
      assert.equal((await h.client().send('GET', '/api/health/live')).statusCode, 200);
    } finally { await sql`update kysely_migration set name='005_user_password' where name='missing_test_version'`.execute(h.db); }
  });
});
