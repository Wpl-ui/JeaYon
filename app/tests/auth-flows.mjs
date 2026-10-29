// DOM component integration: actual React components, HTTP API and PostgreSQL. No mock backend.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { harness } from '../../server/tests/helpers.ts';
const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:5183' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const h = await harness();
const originalFetch = globalThis.fetch;
const cookies = new Map();
const traffic = [];
let root;
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
    traffic.push({ path, method: options.method, status: response.status, credentials: options.credentials, csrf: headers.get('x-dwa-csrf') });
    return response;
  };
  const { LoginPage } = await vite.ssrLoadModule('/src/auth/LoginPage.tsx');
  const { PasswordSettings } = await vite.ssrLoadModule('/src/auth/PasswordSettings.tsx');
  const { AuthProvider } = await vite.ssrLoadModule('/src/auth/AuthProvider.tsx');
  const api = await vite.ssrLoadModule('/src/auth/api.ts');
  const container = document.getElementById('root');
  async function mount(Component, initialSession) {
    if (root) await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(AuthProvider, { initialSession }, createElement(Component, { bootNotice: null }))));
  }
  const button = text => {
    const result = [...container.querySelectorAll('button')].find(el => el.textContent === text);
    assert.ok(result, `Missing button: ${text}`);
    return result;
  };
  async function click(text) { await act(async () => button(text).click()); }
  async function fill(id, value) {
    const el = document.getElementById(id);
    assert.ok(el, `Missing field: ${id}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  }
  async function until(predicate) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    }
    assert.ok(predicate(), 'DOM/API transition timed out');
  }
  function latestCode() { return [...h.codes.values()].at(-1).code; }

  await mount(LoginPage, null);
  assert.ok(!container.textContent.includes('登录后可在账号密码区域设置密码'));
  await click('注册 / 完成设密');
  await fill('otp-target', '13800138901');
  await click('发送验证码');
  await until(() => !!document.getElementById('signup-password'));
  await fill('login-code', latestCode());
  await fill('signup-password', 'dom-signup-password');
  await fill('signup-confirm', 'different-password');
  await click('验证并完成注册');
  assert.ok(container.textContent.includes('两次输入的密码不一致'));
  assert.equal(traffic.filter(t => t.path === '/api/auth/register').length, 0);
  await fill('signup-confirm', 'dom-signup-password');
  await click('验证并完成注册');
  await until(() => traffic.some(t => t.path === '/api/auth/register' && t.status === 200));
  const session = await api.fetchMe();
  assert.equal(session.user.has_password, true);

  await mount(PasswordSettings, session);
  assert.equal(document.getElementById('pw-next'), null);
  await click('发送改密验证码');
  await until(() => !!document.getElementById('pw-code'));
  await fill('pw-code', latestCode());
  await click('验证验证码');
  await until(() => !!document.getElementById('pw-current'));
  await fill('pw-next', 'dom-changed-password');
  await fill('pw-confirm', 'dom-changed-password');
  await click('更新密码');
  assert.ok(container.textContent.includes('请输入当前密码'));
  assert.equal(traffic.filter(t => t.path === '/api/auth/password/change').length, 0);
  await fill('pw-current', 'dom-signup-password');
  await click('更新密码');
  await until(() => container.textContent.includes('密码已更新'));
  assert.equal(document.getElementById('pw-current'), null);
  await api.logoutSession();
  assert.equal((await api.passwordLogin('phone', '13800138901', 'dom-changed-password')).user.id, session.user.id);

  await mount(PasswordSettings, { ...session, user: { ...session.user, has_password: false } });
  assert.equal(container.querySelector('input'), null);
  assert.equal(container.querySelector('button'), null);
  assert.ok(container.textContent.includes('通过身份验证码完成'));
  assert.ok(traffic.every(t => t.credentials === 'include' && (t.method === 'GET' || t.csrf === '1')));
  console.log(JSON.stringify({ event: 'react_dom_flows', result: 'PASS', backend: 'real HTTP + PostgreSQL', browser: false, signup: true, mismatch_rejected: true, multi_step_change: true, current_password_required: true, no_initial_setup_shortcut: true, traffic }));
} finally {
  if (root) await act(async () => root.unmount());
  globalThis.fetch = originalFetch;
  await vite.close();
  await h.close();
  dom.window.close();
}
