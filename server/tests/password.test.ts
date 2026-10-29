import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertPasswordPolicy, hashPassword, verifyPassword, verifyPasswordOrDummy } from '../src/auth/password.js';
import { ApiError } from '../src/http.js';

describe('password hashing', () => {
  it('hashes and verifies; rejects wrong password', async () => {
    const hash = await hashPassword('correct horse battery');
    assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(await verifyPassword('correct horse battery', hash), true);
    assert.equal(await verifyPassword('wrong password!!', hash), false);
    assert.equal(await verifyPassword('correct horse battery', null), false);
  });

  it('verifyPasswordOrDummy burns cost when no hash', async () => {
    assert.equal(await verifyPasswordOrDummy('anything12', null), false);
    const hash = await hashPassword('real-password-ok');
    assert.equal(await verifyPasswordOrDummy('real-password-ok', hash), true);
  });

  it('enforces policy', () => {
    assert.throws(() => assertPasswordPolicy('short'), (e) => e instanceof ApiError);
    assert.throws(() => assertPasswordPolicy('a'.repeat(129)), (e) => e instanceof ApiError);
    assert.doesNotThrow(() => assertPasswordPolicy('longenough'));
  });
});

describe('password encoding contract', () => {
  it('uses independent random salts and exact Unicode input', async () => {
    const password = '  Kelvin-password  ';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    assert.notEqual(first, second);
    assert.equal(first.includes(password), false);
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword(password.trim(), first), false);
    assert.equal(await verifyPassword(password.normalize('NFKC'), first), false);
  });
  it('rejects malformed and unbounded records without accepting credentials', async () => {
    for (const record of ['plaintext', '$argon2id$v=19$m=999999999,t=2,p=1$x$y', 'scrypt$16384$8$1$x$y']) {
      assert.equal(await verifyPassword('anything12', record), false);
    }
    assert.throws(() => assertPasswordPolicy('password\n'), ApiError);
    assert.doesNotThrow(() => assertPasswordPolicy('a'.repeat(128)));
  });
});
