import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { sql } from 'kysely';
import { buildApp } from '../src/app.js';
import { ConsoleProvider } from '../src/auth/providers.js';
import { keyedHash } from '../src/auth/crypto.js';
import { harness, Client, type Harness } from './helpers.js';

const password = 'initial-test-password';
const changed = 'changed-test-password';
const loginPath = '/api/auth/password/login';
const setPath = '/api/auth/password/set';

describe('real PostgreSQL password credential and session contract', () => {
  let h: Harness;
  before(async () => { h = await harness(); });
  after(async () => { await h?.close(); });
  const login = (client: Client, target: string, candidate = password, channel: 'phone' | 'email' = 'phone') =>
    client.send('POST', loginPath, { channel, target, password: candidate });

  it('does not create accounts and returns identical errors for missing, unset, disabled and wrong credentials', async () => {
    const unset = await h.login('13800138011', 'phone');
    await sql`update users set password_hash=null,password_updated_at=null where id=${unset.user.id}`.execute(h.db);
    const disabled = await h.login('13800138012', 'phone');
    const enabled = await h.login('13800138013', 'phone');
    await sql`update users set status='disabled' where id=${disabled.user.id}`.execute(h.db);
    const before = (await sql<{count: string}>`select count(*) from users`.execute(h.db)).rows[0]!.count;
    const failures = await Promise.all([
      login(h.client(), '13800138099'), login(h.client(), unset.user.phone),
      login(h.client(), disabled.user.phone), login(h.client(), enabled.user.phone, 'wrong'),
    ]);
    for (const r of failures) {
      assert.equal(r.statusCode, 401, r.body);
      assert.equal(r.cookies.length, 0);
      assert.deepEqual(r.json(), { ok: false, code: 'invalid_credentials', message: 'invalid_credentials' });
    }
    assert.equal((await sql<{count: string}>`select count(*) from users`.execute(h.db)).rows[0]!.count, before);
  });

  it('requires authenticated CSRF-protected setup, stores only PHC Argon2id, and DB rejects plaintext/scrypt', async () => {
    assert.equal((await h.client().send('POST', setPath, { password })).statusCode, 401);
    const otp = await h.login('13800138014', 'phone');
    assert.equal(otp.user.has_password, true);
    for (const headers of [{ origin: 'https://evil.test' }, { 'x-dwa-csrf': '' }, { 'content-type': 'text/plain' }] as Record<string, string>[]) {
      assert.equal((await otp.client.send('POST', setPath, { password }, headers)).statusCode, 403);
      assert.equal((await h.client().send('POST', loginPath, { channel: 'phone', target: otp.user.phone, password }, headers)).statusCode, 403);
    }
    for (const candidate of ['short', 'a'.repeat(129), 'password\n']) {
      assert.equal((await otp.client.send('POST', setPath, { password: candidate })).statusCode, 400);
    }
    const token = await h.reauth(otp.client);
    const saved = await otp.client.send('POST', setPath, { password, current_password: password, reauth_token: token });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().data.user.has_password, true);
    assert.equal(saved.cookies.length, 0);
    assert.equal(saved.body.includes('password_hash'), false);
    const stored = (await sql<{password_hash: string; password_updated_at: Date}>`select password_hash,password_updated_at from users where id=${otp.user.id}`.execute(h.db)).rows[0]!;
    assert.match(stored.password_hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.notEqual(stored.password_hash, password);
    assert.ok(stored.password_updated_at instanceof Date);
    for (const invalid of [password, 'scrypt$16384$8$1$xxxxxxxxxxxxxxxxxxxxxx$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx']) {
      await assert.rejects(sql`update users set password_hash=${invalid} where id=${otp.user.id}`.execute(h.db), { code: '23514' });
    }
  });

  it('phone and email password logins share OTP me payload, session durations, rotation and logout', async () => {
    for (const [target, channel] of [['13800138015', 'phone'], ['Password.Mixed@Example.TEST', 'email']] as const) {
      const otp = await h.login(target, channel);
      const client = h.client();
      const response = await login(client, target, password, channel);
      assert.equal(response.statusCode, 200, response.body);
      const me = await otp.client.send('GET', '/api/auth/me');
      assert.deepEqual(response.json().data.user, me.json().data.user);
      assert.deepEqual((await client.send('GET', '/api/auth/me')).json().data.user, me.json().data.user);
      assert.deepEqual(response.cookies.map(c => [c.name, c.path, c.httpOnly, c.sameSite]), [
        ['dwa_access', '/api', true, 'Lax'], ['dwa_refresh', '/api/auth', true, 'Lax'],
      ]);
      assert.ok(Number(response.cookies[0]!.maxAge) <= 900, JSON.stringify(response.cookies.map(({ name, maxAge }) => ({ name, maxAge }))));
      assert.ok(Number(response.cookies[1]!.maxAge) <= 604800, JSON.stringify(response.cookies.map(({ name, maxAge }) => ({ name, maxAge }))));
      const sessions = (await sql<{absolute: number; idle: number}>`select extract(epoch from (absolute_expires_at-created_at))::int as absolute,
        extract(epoch from (idle_expires_at-created_at))::int as idle from sessions where user_id=${otp.user.id}`.execute(h.db)).rows;
      assert.ok(sessions.every(s => s.absolute === 2592000 && s.idle === 604800));
      const original = client.cookieHeader();
      assert.equal((await client.send('POST', '/api/auth/refresh', {})).statusCode, 200);
      assert.notEqual(client.cookieHeader(), original);
      const conflict = await client.send('POST', '/api/auth/refresh', {}, { cookie: original });
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.cookies.length, 0);
      const rotated = client.cookieHeader();
      assert.equal((await client.send('POST', '/api/auth/logout', {})).statusCode, 200);
      assert.equal((await client.send('GET', '/api/auth/me', undefined, { cookie: rotated })).statusCode, 401);
      assert.equal((await client.send('POST', '/api/auth/refresh', {}, { cookie: rotated })).statusCode, 401);
    }
  });

  it('HTTPS password and OTP use identical Secure cookie names and attributes', async () => {
    const provider = new ConsoleProvider('development', entry => h.codes.set(entry.challengeId, entry), () => {});
    const config = { ...h.config, APP_ORIGIN: 'https://jeayon.com' };
    const app = buildApp(config, { db: h.db, providers: { email: provider, sms: provider } });
    await app.ready();
    try {
      const otp = new Client(app, config.APP_ORIGIN, '192.0.2.230');
      const request = await otp.send('POST', '/api/auth/otp/request', { channel: 'phone', target: '13800138016', purpose: 'register' });
      const id = request.json().data.challenge_id;
      const verified = await otp.send('POST', '/api/auth/register', { challenge_id: id, code: h.codes.get(id)!.code, password });
      assert.equal(verified.statusCode, 200, verified.body);
      const response = await login(new Client(app, config.APP_ORIGIN, '192.0.2.231'), '13800138016');
      assert.equal(response.statusCode, 200, response.body);
      const attrs = (r: typeof response) => r.cookies.map(c => [c.name, c.path, c.httpOnly, c.secure, c.sameSite, c.domain]);
      assert.deepEqual(attrs(response), attrs(verified));
      assert.deepEqual(attrs(response), [
        ['__Secure-dwa_access', '/api', true, true, 'Lax', undefined],
        ['__Secure-dwa_refresh', '/api/auth', true, true, 'Lax', undefined],
      ]);
    } finally { await app.close(); }
  });

  it('OTP step-up changes revoke other access/refresh sessions while preserving caller', async () => {
    const target = '13800138017';
    const otp = await h.login(target, 'phone');
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='send_cooldown' and key_hash=${keyedHash(h.config.RATE_LIMIT_HMAC_SECRET, otp.user.phone)}`.execute(h.db);
    const otherOtp = await h.login(target, 'phone');
    const otherCookie = otherOtp.client.cookieHeader();
    const initialToken = await h.reauth(otp.client);
    assert.equal((await otp.client.send('POST', setPath, { password, current_password: password, reauth_token: initialToken })).statusCode, 200);
    assert.equal((await otherOtp.client.send('GET', '/api/auth/me')).statusCode, 401);
    assert.equal((await otherOtp.client.send('POST', '/api/auth/refresh', {}, { cookie: otherCookie })).statusCode, 401);
    const other = h.client();
    assert.equal((await login(other, target)).statusCode, 200);
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='password_change_send_cooldown'`.execute(h.db);
    const token = await h.reauth(otp.client);
    assert.equal((await otp.client.send('POST', setPath, { password: changed, reauth_token: token })).statusCode, 400);
    for (const current of ['wrong-password', 'x'.repeat(256)]) {
      const r = await otp.client.send('POST', setPath, { password: changed, current_password: current, reauth_token: token });
      assert.equal(r.statusCode, 401);
      assert.equal(r.json().code, 'invalid_credentials');
      assert.equal((await other.send('GET', '/api/auth/me')).statusCode, 200);
    }
    assert.equal((await otp.client.send('POST', setPath, { password: changed, current_password: 'x'.repeat(257), reauth_token: token })).statusCode, 400);
    const old = other.cookieHeader();
    assert.equal((await otp.client.send('POST', setPath, { password: changed, current_password: password, reauth_token: token })).statusCode, 200);
    assert.equal((await otp.client.send('GET', '/api/auth/me')).statusCode, 200);
    assert.equal((await otp.client.send('POST', '/api/auth/refresh', {})).statusCode, 200);
    assert.equal((await other.send('GET', '/api/auth/me', undefined, { cookie: old })).statusCode, 401);
    assert.equal((await other.send('POST', '/api/auth/refresh', {}, { cookie: old })).statusCode, 401);
    assert.equal((await login(h.client(), target)).statusCode, 401);
    assert.equal((await login(h.client(), target, changed)).statusCode, 200);
    const denied = await sql<{count: string}>`select count(*) from audit_events where action='auth.password_change' and actor_user_id=${otp.user.id} and outcome='denied'`.execute(h.db);
    assert.equal(denied.rows[0]!.count, '2');
  });

  it('serializes concurrent changes so a just-revoked caller cannot overwrite the password', async () => {
    const target = '13800138018';
    const otp = await h.login(target, 'phone');
    const other = h.client();
    await login(other, target);
    const firstToken = await h.reauth(otp.client);
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='password_change_send_cooldown'`.execute(h.db);
    const secondToken = await h.reauth(other);
    const results = await Promise.all([[otp.client, firstToken], [other, secondToken]].map(([c, token]) => (c as Client).send('POST', setPath, { password: changed, current_password: password, reauth_token: token }))); 
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 401]);
    assert.equal((await login(h.client(), target, changed)).statusCode, 200);
  });

  it('limits target attempts across IPs concurrently, locks correct passwords, and preserves OTP', async () => {
    const target = '13800138019';
    const otp = await h.login(target, 'phone');
    const results = await Promise.all(Array.from({ length: 6 }, () => login(h.client(), target, 'wrong-password')));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [401, 401, 401, 401, 401, 429]);
    const locked = await login(h.client(), target);
    assert.equal(locked.statusCode, 429);
    assert.ok(Number(locked.headers['retry-after']) >= 1 && Number(locked.headers['retry-after']) <= 60);
    assert.equal(locked.cookies.length, 0);
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='send_cooldown' and key_hash=${keyedHash(h.config.RATE_LIMIT_HMAC_SECRET, otp.user.phone)}`.execute(h.db);
    const repeat = await h.login(target, 'phone');
    assert.equal(repeat.user.id, otp.user.id);
    assert.equal(repeat.user.has_password, true);
    // Expire only this test subject's minute bucket; no clock sleeps or production quota changes.
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='password_login_target' and window_seconds=60 and key_hash=${keyedHash(h.config.RATE_LIMIT_HMAC_SECRET, `phone:${otp.user.phone}`)}`.execute(h.db);
    assert.equal((await login(h.client(), target)).statusCode, 200);
  });

  it('keeps trusted proxy XFF clients in independent IP buckets at the 20/min boundary', async () => {
    const provider = new ConsoleProvider('development', entry => h.codes.set(entry.challengeId, entry), () => {});
    const config = { ...h.config, TRUST_PROXY_CIDR: '172.30.240.2/32' };
    const app = buildApp(config, { db: h.db, providers: { email: provider, sms: provider } });
    await app.ready();
    const proxy = new Client(app, config.APP_ORIGIN, '172.30.240.2');
    const now = Date.now;
    const frozen = now();
    Date.now = () => frozen;
    try {
      for (let i = 0; i < 20; i++) {
        const r = await proxy.send('POST', loginPath, { channel: 'email', target: `trusted-${i}@example.test`, password: 'wrong' }, { 'x-forwarded-for': '198.51.100.21' });
        assert.equal(r.statusCode, 401, r.body);
      }
      const locked = await proxy.send('POST', loginPath, { channel: 'email', target: 'trusted-locked@example.test', password: 'wrong' }, { 'x-forwarded-for': '198.51.100.21' });
      assert.equal(locked.statusCode, 429, locked.body);
      assert.ok(Number(locked.headers['retry-after']) > 0);
      const independent = await proxy.send('POST', loginPath, { channel: 'email', target: 'trusted-independent@example.test', password: 'wrong' }, { 'x-forwarded-for': '198.51.100.22' });
      assert.equal(independent.statusCode, 401, independent.body);
      for (const [ip, count] of [['198.51.100.21', 20], ['198.51.100.22', 1]] as const) {
        const rows = await sql<{ count: number }>`select count from auth_rate_limits where scope='password_login_ip' and key_hash=${keyedHash(config.RATE_LIMIT_HMAC_SECRET, ip)} and window_seconds=60`.execute(h.db);
        assert.deepEqual(rows.rows.map(r => r.count), [count]);
      }
    } finally { Date.now = now; await app.close(); }
  });

  it('ignores forged XFF from an untrusted peer even with a trusted proxy configured', async () => {
    const provider = new ConsoleProvider('development', entry => h.codes.set(entry.challengeId, entry), () => {});
    const config = { ...h.config, TRUST_PROXY_CIDR: '172.30.240.2/32' };
    const app = buildApp(config, { db: h.db, providers: { email: provider, sms: provider } });
    await app.ready();
    const peer = new Client(app, config.APP_ORIGIN, '192.0.2.243');
    const now = Date.now;
    const frozen = now();
    Date.now = () => frozen;
    try {
      for (let i = 0; i < 21; i++) {
        const r = await peer.send('POST', loginPath, { channel: 'email', target: `untrusted-${i}@example.test`, password: 'wrong' }, { 'x-forwarded-for': `203.0.113.${i + 1}` });
        assert.equal(r.statusCode, i < 20 ? 401 : 429, r.body);
      }
      const rows = await sql<{ count: number }>`select count from auth_rate_limits where scope='password_login_ip' and key_hash=${keyedHash(config.RATE_LIMIT_HMAC_SECRET, peer.ip)} and window_seconds=60`.execute(h.db);
      assert.deepEqual(rows.rows.map(r => r.count), [20]);
      const forged = await sql<{ count: string }>`select count(*) from auth_rate_limits where scope='password_login_ip' and key_hash=${keyedHash(config.RATE_LIMIT_HMAC_SECRET, '203.0.113.1')}`.execute(h.db);
      assert.equal(forged.rows[0]!.count, '0');
    } finally { Date.now = now; await app.close(); }
  });

  it('limits password changes per user across sessions and persists denied attempts', async () => {
    const otp = await h.login('13800138020', 'phone');
    const token = await h.reauth(otp.client);
    for (let i = 0; i < 5; i++) assert.equal((await otp.client.send('POST', setPath, { password: changed, current_password: 'wrong', reauth_token: token })).statusCode, 401);
    const locked = await otp.client.send('POST', setPath, { password: changed, current_password: password, reauth_token: token });
    assert.equal(locked.statusCode, 429);
    assert.ok(Number(locked.headers['retry-after']) > 0);
    assert.equal((await login(h.client(), otp.user.phone)).statusCode, 200);
  });
});
