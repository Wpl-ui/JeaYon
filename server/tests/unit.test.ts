import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { normalize, otpHash, otpMatches, otpUsable, ipKey } from '../src/auth/crypto.js';
import { ConsoleProvider, signTc3, TencentProvider } from '../src/auth/providers.js';
import { date, dto } from '../src/http.js';
import { testUrl, unitEnv } from './helpers.js';

describe('normalization and OTP primitives', () => {
  for (const input of ['13800138000', '+86 138-0013-8000', ' 13800138000 ', '12345678901']) it(`normalizes mainland phone ${input}`, () => assert.match(normalize('phone', input), /^\+861\d{10}$/));
  for (const input of ['8613800138000', '+1 2125550100', '23800138000', '138001380001', '1380013800', '13800138000ext1']) it(`rejects invalid phone ${input}`, () => assert.throws(() => normalize('phone', input)));
  it('lowercases email, preserving plus tags and dots', () => assert.equal(normalize('email', ' A.B+Tag@Example.COM '), 'a.b+tag@example.com'));
  for (const value of ['a@b.com\n', 'a@b.com\r\nBcc:x@y.com', 'a@b.com,c@d.com', '中@b.com', 'a..b@x.com', 'a@-x.com', 'a@b..com', `${'a'.repeat(65)}@b.com`]) it(`rejects invalid email ${JSON.stringify(value).slice(0, 45)}`, () => assert.throws(() => normalize('email', value)));
  it('HMAC is bound to challenge, purpose, identity, channel and key version', () => {
    const pepper = randomBytes(32).toString('hex');
    const row = { id: 'challenge', purpose: 'login', channel: 'email', target_normalized: 'a@b.com', key_version: 1 };
    const hashed = { ...row, code_hmac: otpHash(pepper, row, '123456') };
    assert.equal(hashed.code_hmac.length, 32);
    assert.ok(otpMatches(pepper, hashed, '123456'));
    assert.ok(!otpMatches(pepper, hashed, '123457'));
    for (const change of [{ id: 'other' }, { purpose: 'link' }, { channel: 'phone' }, { target_normalized: 'x@b.com' }, { bound_user_id: 'user' }, { bound_session_id: 'session' }, { key_version: 2 }]) assert.ok(!otpMatches(pepper, { ...hashed, ...change }, '123456'));
  });
  it('expires at the exact boundary and closes after five attempts', () => {
    assert.ok(otpUsable({ state: 'sent', attempts: 4, expires_at: new Date(301000) }, 300999));
    assert.ok(!otpUsable({ state: 'sent', attempts: 4, expires_at: new Date(301000) }, 301000));
    assert.ok(!otpUsable({ state: 'sent', attempts: 5, expires_at: new Date(301000) }, 300999));
    assert.ok(!otpUsable({ state: 'pending', attempts: 0, expires_at: new Date(301000) }, 300999));
  });
  it('uses IPv6 /64 buckets and collapses IPv4 mapped addresses', () => {
    assert.equal(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:2::ffff'));
    assert.equal(ipKey('::ffff:192.0.2.1'), '192.0.2.1');
  });
  it('validates real calendar dates and guards unsafe IDs', () => {
    assert.ok(date.safeParse('2024-02-29').success);
    for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '0000-01-01']) assert.ok(!date.safeParse(value).success);
    assert.throws(() => dto({ id: '9007199254740993' }));
    assert.deepEqual(dto({ user: { id: '123456' } }), { user: { id: '123456' } });
  });
});
describe('startup and destructive test guard', () => {
  it('accepts only explicit development console configuration', () => assert.equal(loadConfig(unitEnv()).NODE_ENV, 'development'));
  for (const env of ['test', 'production']) it(`refuses console in ${env}`, () => {
    assert.throws(() => loadConfig({ ...unitEnv(), NODE_ENV: env, APP_ORIGIN: 'https://jeayon.com' }), /DEV ONLY/);
    assert.throws(() => new ConsoleProvider(env), /DEV ONLY/);
  });
  it('refuses missing production providers and weak secrets', () => {
    const env = { ...unitEnv(), NODE_ENV: 'production', APP_ORIGIN: 'https://jeayon.com', EMAIL_PROVIDER: 'tencent-ses', SMS_PROVIDER: 'tencent-sms' };
    assert.throws(() => loadConfig(env), /Missing provider/);
    assert.throws(() => loadConfig({ ...env, JWT_SECRET: 'short' }), /Invalid configuration/);
    assert.throws(() => loadConfig({ ...env, JWT_SECRET: 'a'.repeat(64) }), /strong random/);
  });
  it('refuses unsafe origins and identical secrets', () => {
    assert.throws(() => loadConfig({ ...unitEnv(), APP_ORIGIN: 'http://evil.example' }), /HTTPS/);
    assert.throws(() => loadConfig({ ...unitEnv(), APP_ORIGIN: 'http://127.0.0.1:5183/' }), /exact origin/);
    const env = unitEnv();
    assert.throws(() => loadConfig({ ...env, JWT_SECRET: env.OTP_PEPPER }), /independent/);
  });
  it('refuses test database omission or a non-dwa_test database', () => {
    const old = process.env.TEST_DATABASE_URL;
    try {
      delete process.env.TEST_DATABASE_URL;
      assert.throws(testUrl, /required/);
      process.env.TEST_DATABASE_URL = 'postgres://placeholder@127.0.0.1/dwa_dev';
      assert.throws(testUrl, /refuse/);
    } finally { if (old === undefined) delete process.env.TEST_DATABASE_URL; else process.env.TEST_DATABASE_URL = old; }
  });
});
describe('Tencent TC3 and request adapters (no network)', () => {
  it('matches an independent Python hashlib/hmac vector using the official canonical example', () => {
    // Public synthetic key, not a credential. Independent generator: tests/tc3-vector.py.
    const signed = signTc3({ secretId: 'public-unit-test-id', secretKey: 'public-unit-test-key-not-a-credential', service: 'cvm', action: 'DescribeInstances', timestamp: 1551113065,
      body: '{"Limit": 1, "Filters": [{"Values": ["未命名"], "Name": "instance-name"}]}' });
    assert.equal(signed.Authorization, 'TC3-HMAC-SHA256 Credential=public-unit-test-id/2019-02-25/cvm/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=36566d8cacc5e0d95143798c19970cef17272ae14468ae683a92d0d026971f13');
  });
  const config = () => loadConfig({ ...unitEnv(), EMAIL_PROVIDER: 'tencent-ses', SMS_PROVIDER: 'tencent-sms', TENCENT_SECRET_ID: 'public-stub-id', TENCENT_SECRET_KEY: 'public-stub-key', TENCENT_SES_FROM_EMAIL: 'sender@example.test', TENCENT_SES_TEMPLATE_ID: '123', TENCENT_SES_SUBJECT: 'Login', TENCENT_SMS_SDK_APP_ID: '456', TENCENT_SMS_SIGN_NAME: 'Test', TENCENT_SMS_TEMPLATE_ID: '789' });
  it('sends exact SES template fields and validates the receipt', async () => {
    const stub: typeof fetch = async (url, init) => {
      assert.equal(url, 'https://ses.tencentcloudapi.com/');
      assert.equal((init!.headers as Record<string, string>)['X-TC-Version'], '2020-10-02');
      assert.deepEqual(JSON.parse(String(init!.body)), { FromEmailAddress: 'sender@example.test', Destination: ['a@example.test'], Subject: 'Login', Template: { TemplateID: 123, TemplateData: '{"code":"123456","expiresMinutes":"5"}' } });
      return Response.json({ Response: { RequestId: 'request', MessageId: 'message' } });
    };
    assert.deepEqual(await new TencentProvider(config(), stub).sendCode({ to: 'a@example.test', code: '123456', expiresMinutes: 5, challengeId: 'id' }), { providerRequestId: 'request', messageId: 'message' });
  });
  it('sends SmsSdkAppId, ordered params and validates per-number acceptance', async () => {
    const stub: typeof fetch = async (url, init) => {
      assert.equal(url, 'https://sms.tencentcloudapi.com/');
      assert.equal((init!.headers as Record<string, string>)['X-TC-Region'], 'ap-guangzhou');
      assert.deepEqual(JSON.parse(String(init!.body)), { SmsSdkAppId: '456', SignName: 'Test', TemplateId: '789', PhoneNumberSet: ['+8613800138000'], TemplateParamSet: ['123456', '5'] });
      return Response.json({ Response: { RequestId: 'request', SendStatusSet: [{ Code: 'Ok', PhoneNumber: '+8613800138000', SerialNo: 'serial' }] } });
    };
    assert.equal((await new TencentProvider(config(), stub).sendCode({ toE164: '+8613800138000', code: '123456', expiresMinutes: 5, challengeId: 'id' })).messageId, 'serial');
  });
  for (const [name, response] of [ ['HTTP error', new Response('{}', { status: 503 })], ['API error', Response.json({ Response: { RequestId: 'r', Error: { Code: 'Rejected' } } })], ['SMS status failure', Response.json({ Response: { RequestId: 'r', SendStatusSet: [{ Code: 'Failed' }] } })], ['missing receipt', Response.json({ Response: {} })] ] as const) it(`rejects ${name}`, async () => {
    await assert.rejects(new TencentProvider(config(), async () => response.clone()).sendCode({ toE164: '+8613800138000', code: '123456', expiresMinutes: 5, challengeId: 'id' }));
  });
});
