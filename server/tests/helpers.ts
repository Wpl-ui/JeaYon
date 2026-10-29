import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrator.js';
import { buildApp } from '../src/app.js';
import { ConsoleProvider, type CapturedCode } from '../src/auth/providers.js';
export function testUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required; no database fallback');
  const url = new URL(value);
  if (url.pathname !== '/dwa_test' || !['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Tests refuse databases other than dwa_test');
  if (process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === '/dwa_test') throw new Error('Test DB must differ from DATABASE_URL');
  return value;
}
export function unitEnv(): NodeJS.ProcessEnv {
  return { NODE_ENV: 'development', APP_ORIGIN: 'http://127.0.0.1:5183', DATABASE_URL: 'postgres://placeholder:placeholder@127.0.0.1/placeholder',
    EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console', LOG_LEVEL: 'silent',
    JWT_SECRET: randomBytes(32).toString('hex'), OTP_PEPPER: randomBytes(32).toString('hex'), RATE_LIMIT_HMAC_SECRET: randomBytes(32).toString('hex') };
}
export async function harness() {
  const db = createDb(testUrl());
  const actual = (await sql<{name: string; version: string}>`select current_database() as name,current_setting('server_version') as version`.execute(db)).rows[0];
  assert.equal(actual?.name, 'dwa_test');
  assert.match(actual.version, /^16\./);
  // Explicit user-authorized reset, only after URL and live server database-name checks.
  await sql.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;').execute(db);
  await migrate(db);
  const config = loadConfig({ ...unitEnv(), DATABASE_URL: testUrl() });
  const codes = new Map<string, CapturedCode>();
  const consoleProvider = new ConsoleProvider('development', code => codes.set(code.challengeId, code), () => {});
  const app = buildApp(config, { db, providers: { email: consoleProvider, sms: consoleProvider } });
  await app.ready();
  let nextIp = 1;
  function client() { return new Client(app, config.APP_ORIGIN, `192.0.2.${nextIp++}`); }
  async function login(target: string, channel: 'email' | 'phone' = 'email') {
    const c = client();
    const normalized = channel === 'email' ? target.trim().toLowerCase() : '+86' + target.replace(/[^0-9]/g, '').replace(/^86/, '');
    const existing = await sql`select 1 from identities where kind=${channel} and identifier_normalized=${normalized}`.execute(db);
    const registration = existing.rows.length === 0;
    const requested = await c.send('POST', '/api/auth/otp/request', { channel, target, purpose: registration ? 'register' : 'login' });
    assert.equal(requested.statusCode, 202, requested.body);
    const challenge = requested.json().data.challenge_id as string;
    const code = codes.get(challenge)?.code;
    assert.ok(code);
    const verified = await c.send('POST', registration ? '/api/auth/register' : '/api/auth/otp/verify', { challenge_id: challenge, code, ...(registration ? { password: 'initial-test-password' } : {}) });
    assert.equal(verified.statusCode, 200, verified.body);
    return { client: c, user: verified.json().data.user, challenge, code };
  }
  async function reauth(c: Client) {
    const requested = await c.send('POST', '/api/auth/reauth/request', {});
    assert.equal(requested.statusCode, 202, requested.body);
    const id = requested.json().data.challenge_id;
    const verified = await c.send('POST', '/api/auth/reauth/verify', { challenge_id: id, code: codes.get(id)!.code });
    assert.equal(verified.statusCode, 200, verified.body);
    return verified.json().data.reauth_token as string;
  }
  return { db, app, config, codes, client, login, reauth, async close() { await app.close(); await db.destroy(); } };
}
export type Harness = Awaited<ReturnType<typeof harness>>;
export class Client {
  cookies = new Map<string, string>();
  constructor(public app: FastifyInstance, public origin: string, public ip: string) {}
  cookieHeader() { return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '); }
  async send(method: HTTPMethods, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({ method, url, remoteAddress: this.ip,
      headers: { origin: this.origin, 'x-dwa-csrf': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), cookie: this.cookieHeader(), ...headers },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
    for (const c of res.cookies) this.cookies.set(c.name, c.value);
    return res;
  }
}
export const task = { title: 'Task', description: null, assignee_id: null, status: 'todo', progress: 0, start_date: '2026-10-26', due_date: '2026-10-27' };
export const log = { owner_name: 'Snapshot name', work_date: '2026-10-26', done_today: 'Done', problems: null, plan_tomorrow: 'Next', hours: '1.25', related_task_id: null };
