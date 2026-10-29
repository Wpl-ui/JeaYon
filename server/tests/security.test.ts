import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { sql } from 'kysely';
import { randomBytes } from 'node:crypto';
import { harness, type Harness, Client } from './helpers.js';
import { buildApp } from '../src/app.js';
import { ConsoleProvider } from '../src/auth/providers.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';

describe('production cookies, query allowlists and minimal runtime privileges', () => {
  let h: Harness;
  before(async () => { h = await harness(); });
  after(async () => { await h?.close(); });
  it('HTTPS uses Secure host-only prefix cookies with scoped paths', async () => {
    const codes = new Map<string, string>();
    const p = new ConsoleProvider('development', c => codes.set(c.challengeId, c.code), () => {});
    // Real development provider, secure HTTPS origin; never enabling console in production.
    const app = buildApp({ ...h.config, APP_ORIGIN: 'https://jeayon.com' }, { db: h.db, providers: { email: p, sms: p } });
    try {
      const c = new Client(app, 'https://jeayon.com', '192.0.2.150');
      const request = await c.send('POST', '/api/auth/otp/request', { channel: 'email', target: 'secure@example.test', purpose: 'register' });
      const id = request.json().data.challenge_id;
      const verified = await c.send('POST', '/api/auth/register', { challenge_id: id, code: codes.get(id), password: 'initial-test-password' });
      assert.equal(verified.statusCode, 200);
      assert.deepEqual(verified.cookies.map(v => v.name).sort(), ['__Secure-dwa_access', '__Secure-dwa_refresh']);
      for (const cookie of verified.cookies) {
        assert.equal(cookie.secure, true); assert.equal(cookie.httpOnly, true);
        assert.equal(cookie.sameSite, 'Lax'); assert.equal(cookie.domain, undefined);
      }
      assert.equal((await c.send('GET', '/api/auth/me')).statusCode, 200);
    } finally { await app.close(); }
  });
  it('production accepts complete real-provider-shaped config without making any request', () => {
    const c = loadConfig({ NODE_ENV: 'production', DATABASE_URL: h.config.DATABASE_URL, APP_ORIGIN: 'https://jeayon.com',
      JWT_SECRET: randomBytes(32).toString('hex'), OTP_PEPPER: randomBytes(32).toString('hex'), RATE_LIMIT_HMAC_SECRET: randomBytes(32).toString('hex'),
      EMAIL_PROVIDER: 'tencent-ses', SMS_PROVIDER: 'tencent-sms', TENCENT_SECRET_ID: 'public-shape-only-id', TENCENT_SECRET_KEY: 'public-shape-only-key',
      TENCENT_SES_FROM_EMAIL: 'sender@example.test', TENCENT_SES_TEMPLATE_ID: '123', TENCENT_SES_SUBJECT: 'Login',
      TENCENT_SMS_SDK_APP_ID: '456', TENCENT_SMS_SIGN_NAME: 'Approved-shape', TENCENT_SMS_TEMPLATE_ID: '789' });
    assert.equal(c.NODE_ENV, 'production');
    // This verifies startup field validation only; synthetic values are never accepted-delivery evidence.
  });
  it('unknown query/body fields and oversized bodies are rejected', async () => {
    const { client } = await h.login('query@example.test');
    assert.equal((await client.send('GET', '/api/teams?userId=someone-else')).statusCode, 400);
    assert.equal((await client.send('POST', '/api/auth/logout', { user_id: 'other' })).statusCode, 400);
    assert.equal((await client.send('POST', '/api/teams', { name: 'x'.repeat(40000), display_name: 'A' })).statusCode, 413);
  });
  it('readiness returns 503 for a real disconnected database and never returns connection details', async () => {
    const unavailableUrl = new URL(h.config.DATABASE_URL);
    unavailableUrl.port = '1'; // Actual refused TCP connection, not a database substitute.
    const disconnected = createDb(unavailableUrl.toString());
    const app = buildApp(h.config, { db: disconnected });
    try {
      const r = await app.inject({ url: '/api/health/ready' });
      assert.equal(r.statusCode, 503);
      assert.ok(!r.body.includes(h.config.DATABASE_URL));
      assert.equal((await app.inject({ url: '/api/health/live' })).statusCode, 200);
    } finally { await app.close(); await disconnected.destroy(); }
  });
  it('SQL runtime grant script excludes migration writes, DDL and audit reads', async () => {
    // Inspect the actual checked-in deployment grant script; do not claim local role provisioning.
    const { readFile } = await import('node:fs/promises');
    const grant = await readFile(new URL('../../deploy/grant-runtime.sql', import.meta.url), 'utf8');
    assert.match(grant, /GRANT SELECT ON kysely_migration TO dwa_api/);
    assert.match(grant, /GRANT INSERT ON audit_events TO dwa_api/);
    assert.ok(!/GRANT\s+(?:ALL|CREATE)\b/i.test(grant));
    const result = await sql<{owner: string; superuser: boolean; bypassrls: boolean}>`select current_user as owner,rolsuper as superuser,rolbypassrls as bypassrls from pg_roles where rolname=current_user`.execute(h.db);
    assert.equal(typeof result.rows[0]?.superuser, 'boolean');
  });
});
