// Dev module loading smoke; no browser rendering or login is claimed.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const entry = await server.transformRequest('/src/dev-preview/main.tsx');
  assert.ok(entry.code.includes('LoginPage.tsx?visual-preview'));
  const login = await server.transformRequest('/src/auth/LoginPage.tsx?visual-preview');
  const settings = await server.transformRequest('/src/auth/PasswordSettings.tsx?visual-preview');
  assert.match(login.code, /dev-preview\/auth-api.ts/);
  assert.match(settings.code, /dev-preview\/auth-api.ts/);
  const stub = await fetch(new URL('/src/dev-preview/auth-api.ts', origin));
  assert.equal(stub.status, 200);
  const code = await stub.text();
  for (const name of ['passwordLogin', 'setAccountPassword', 'requestEmailCode', 'verifyOtpCode', 'registerAccount', 'requestPasswordReauth', 'verifyPasswordReauth']) {
    assert.match(code, new RegExp(`export (?:async )?function ${name}\\b`));
  }
  console.log(JSON.stringify({ result: 'PASS', event: 'preview_module_smoke', named_exports_valid: true, browser_rendering: 'unavailable: CUA inventory contains no browsers' }));
} finally { await server.close(); }
