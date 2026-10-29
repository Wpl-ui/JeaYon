// Runs the actual frontend API module against a real Fastify HTTP listener + PostgreSQL test DB.
import assert from 'node:assert/strict';
import { harness } from '../tests/helpers.ts';
import * as api from '../../app/src/auth/api.ts';
const h = await harness();
const originalFetch = globalThis.fetch;
const cookies = new Map();
const traffic = [];
try {
  const origin = await h.app.listen({ host: '127.0.0.1', port: 0 });
  globalThis.fetch = async (path, options) => {
    const headers = new Headers(options.headers);
    headers.set('Origin', h.config.APP_ORIGIN);
    headers.set('Cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const response = await originalFetch(new URL(path, origin), { ...options, headers });
    for (const set of response.headers.getSetCookie()) {
      const pair = set.split(';')[0];
      const i = pair.indexOf('=');
      cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    traffic.push({ path, method: options.method, credentials: options.credentials,
      csrf: headers.get('x-dwa-csrf'), status: response.status });
    return response;
  };
  const challenge = await api.requestPhoneCode('13800138030', 'register');
  const password = 'frontend-real-http-password';
  const saved = await api.registerAccount(challenge.challengeId, h.codes.get(challenge.challengeId).code, password);
  assert.equal(saved.user.has_password, true);
  assert.deepEqual((await api.fetchMe()).user, saved.user);
  await api.logoutSession();
  const loggedIn = await api.passwordLogin('phone', '13800138030', password);
  assert.deepEqual(loggedIn.user, saved.user);
  await assert.rejects(api.passwordLogin('phone', '13800138030', 'wrong-password'), error => {
    assert.equal(error.code, 'invalid_credentials');
    assert.equal(error.sessionExpired, false);
    assert.equal(error.message, '账号或密码不正确');
    return true;
  });
  const refreshed = await api.refreshSession();
  assert.deepEqual(refreshed.user, saved.user);
  await api.logoutSession();
  await assert.rejects(api.fetchMe(), error => error.code === 'unauthenticated' && error.sessionExpired);
  const emailChallenge = await api.requestEmailCode(' Email.Only+R2@Example.TEST ', 'register');
  const emailOtp = await api.registerAccount(emailChallenge.challengeId, h.codes.get(emailChallenge.challengeId).code, 'frontend-email-test-password');
  assert.equal(emailOtp.user.email, 'email.only+r2@example.test');
  assert.equal(emailOtp.user.phone, undefined);
  assert.equal(emailOtp.user.has_password, true);
  const stepUp = await api.requestPasswordReauth();
  const reauth = await api.verifyPasswordReauth(stepUp.challengeId, h.codes.get(stepUp.challengeId).code);
  const emailSaved = await api.setAccountPassword('frontend-email-changed-password', 'frontend-email-test-password', reauth.reauth_token);
  assert.equal(emailSaved.user.has_password, true);
  assert.equal(emailSaved.user.id, emailOtp.user.id);
  await api.logoutSession();
  const emailLogin = await api.passwordLogin('email', 'email.only+r2@example.test', 'frontend-email-changed-password');
  assert.deepEqual(emailLogin.user, emailSaved.user);
  await assert.rejects(api.passwordLogin('email', 'email.only+r2@example.test', 'x'), error => error.code === 'invalid_credentials');
  await api.logoutSession();
  assert.ok(traffic.every(t => t.credentials === 'include' && (t.method === 'GET' || t.csrf === '1')));
  console.log(JSON.stringify({ result: 'PASS', signup_password_and_email_stepup_change: true, transport: 'real HTTP + PostgreSQL', traffic }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  await h.close();
}
