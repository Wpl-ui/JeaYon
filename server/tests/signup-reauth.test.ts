import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { sql } from 'kysely';
import { harness, type Harness } from './helpers.js';

describe('password signup and OTP step-up', () => {
  let h: Harness;
  before(async () => { h = await harness(); });
  after(async () => { await h?.close(); });
  it('never creates an account through login OTP alone', async () => {
    const client = h.client();
    const request = await client.send('POST', '/api/auth/otp/request', { channel: 'email', target: 'bare@example.test', purpose: 'login' });
    const id = request.json().data.challenge_id;
    const result = await client.send('POST', '/api/auth/otp/verify', { challenge_id: id, code: h.codes.get(id)!.code });
    assert.equal(result.statusCode, 409);
    assert.equal(result.json().code, 'registration_required');
    assert.equal((await sql<{n: string}>`select count(*) as n from users`.execute(h.db)).rows[0]!.n, '0');
  });
  it('requires a password on registration and rejects the session-only setup shortcut', async () => {
    const client = h.client();
    const requested = await client.send('POST', '/api/auth/otp/request', { channel: 'email', target: 'signup@example.test', purpose: 'register' });
    assert.equal(requested.statusCode, 202);
    const id = requested.json().data.challenge_id;
    const body = { challenge_id: id, code: h.codes.get(id)!.code };
    assert.equal((await client.send('POST', '/api/auth/register', body)).statusCode, 400);
    assert.equal((await client.send('POST', '/api/auth/register', { ...body, password: 'signup-password' })).statusCode, 200);
    assert.equal((await client.send('POST', '/api/auth/password/set', { password: 'bypass-password' })).statusCode, 400);
  });
});

describe('registration atomicity and step-up boundaries', () => {
  let h: Harness;
  const password = 'initial-test-password';
  const changed = 'changed-test-password';
  before(async () => { h = await harness(); });
  after(async () => { await h?.close(); });
  async function challenge(client: ReturnType<Harness['client']>, target: string, purpose: 'register' | 'login' = 'register') {
    const result = await client.send('POST', '/api/auth/otp/request', { channel: 'email', target, purpose });
    assert.equal(result.statusCode, 202, result.body);
    const id = result.json().data.challenge_id;
    return { challenge_id: id, code: h.codes.get(id)!.code };
  }
  const change = (client: ReturnType<Harness['client']>, token: string, current = password) =>
    client.send('POST', '/api/auth/password/change', { password: changed, current_password: current, reauth_token: token });

  it('requires policy-compliant passwords without consuming the registration challenge', async () => {
    const client = h.client();
    const body = await challenge(client, 'policy@example.test');
    for (const candidate of ['short', 'x'.repeat(129), 'bad-password\n']) {
      assert.equal((await client.send('POST', '/api/auth/register', { ...body, password: candidate })).statusCode, 400);
    }
    assert.equal((await client.send('POST', '/api/auth/otp/verify', body)).statusCode, 400);
    const result = await client.send('POST', '/api/auth/register', { ...body, password });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().data.user.has_password, true);
    const records = await sql<{state: string; has_password: boolean; n: number}>`select o.state,u.password_hash is not null as has_password,(select count(*)::int from sessions s where s.user_id=u.id) as n from otp_codes o join identities i on i.identifier_normalized=o.target_normalized join users u on u.id=i.user_id where o.id=${body.challenge_id}`.execute(h.db);
    assert.deepEqual(records.rows[0], { state: 'consumed', has_password: true, n: 1 });
  });
  it('cannot overwrite an existing password via registration and preserves old login', async () => {
    const { user } = await h.login('existing@example.test');
    const client = h.client();
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='register_send_cooldown'`.execute(h.db);
    const body = await challenge(client, user.email);
    const result = await client.send('POST', '/api/auth/register', { ...body, password: changed });
    assert.equal(result.statusCode, 409);
    assert.equal(result.json().code, 'password_exists');
    assert.equal((await client.send('POST', '/api/auth/password/login', { channel: 'email', target: user.email, password })).statusCode, 200);
    assert.equal((await h.client().send('POST', '/api/auth/password/login', { channel: 'email', target: user.email, password: changed })).statusCode, 401);
  });
  it('legacy accounts require fresh identity OTP, complete once, and revoke old sessions', async () => {
    const legacy = await h.login('legacy@example.test');
    await sql`update users set password_hash=null,password_updated_at=null where id=${legacy.user.id}`.execute(h.db);
    assert.equal((await legacy.client.send('POST', '/api/auth/password/set', { password })).statusCode, 400);
    const client = h.client();
    const loginCode = await challenge(client, legacy.user.email, 'login');
    assert.equal((await client.send('POST', '/api/auth/otp/verify', loginCode)).json().code, 'registration_required');
    assert.equal((await client.send('POST', '/api/auth/register', { ...loginCode, password })).statusCode, 400);
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='register_send_cooldown'`.execute(h.db);
    const body = await challenge(client, legacy.user.email);
    const result = await client.send('POST', '/api/auth/register', { ...body, password });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().data.user.id, legacy.user.id);
    assert.equal(result.json().data.user.has_password, true);
    assert.equal((await legacy.client.send('GET', '/api/auth/me')).statusCode, 401);
    assert.equal((await client.send('POST', '/api/auth/register', { ...body, password: changed })).statusCode, 400);
  });
  it('rolls back OTP consumption, identity, hash and session together on session issuance failure', async () => {
    const client = h.client();
    const body = await challenge(client, 'rollback@example.test');
    await sql`alter table sessions add constraint test_block_new_sessions check (false) not valid`.execute(h.db);
    try {
      assert.equal((await client.send('POST', '/api/auth/register', { ...body, password })).statusCode, 400);
      assert.equal((await sql`select 1 from identities where identifier_normalized='rollback@example.test'`.execute(h.db)).rows.length, 0);
      assert.equal((await sql<{state: string}>`select state from otp_codes where id=${body.challenge_id}`.execute(h.db)).rows[0]!.state, 'sent');
    } finally { await sql`alter table sessions drop constraint test_block_new_sessions`.execute(h.db); }
    assert.equal((await client.send('POST', '/api/auth/register', { ...body, password })).statusCode, 200);
  });
  it('serializes concurrent registration and consumes the code once', async () => {
    const client = h.client();
    const body = await challenge(client, 'race@example.test');
    const results = await Promise.all([client, h.client()].map(c => c.send('POST', '/api/auth/register', { ...body, password })));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 400]);
    assert.equal((await sql`select 1 from identities where identifier_normalized='race@example.test'`.execute(h.db)).rows.length, 1);
  });
  it('isolates login/register/change purposes and prioritizes the bound phone', async () => {
    const account = await h.login('priority@example.test');
    await sql`insert into identities(user_id,kind,identifier_normalized) values(${account.user.id},'phone','+8613800138999')`.execute(h.db);
    const sent = await account.client.send('POST', '/api/auth/reauth/request', {});
    assert.equal(sent.statusCode, 202);
    const id = sent.json().data.challenge_id;
    assert.equal(h.codes.get(id)!.target, '+8613800138999');
    const body = { challenge_id: id, code: h.codes.get(id)!.code };
    assert.equal((await account.client.send('POST', '/api/auth/otp/verify', body)).statusCode, 400);
    assert.equal((await account.client.send('POST', '/api/auth/register', { ...body, password })).statusCode, 400);
    assert.equal((await account.client.send('POST', '/api/auth/reauth/verify', body)).statusCode, 200);
    const loginOtp = await challenge(account.client, account.user.email, 'login');
    assert.equal((await account.client.send('POST', '/api/auth/reauth/verify', loginOtp)).statusCode, 400);
    const registerOtp = await challenge(account.client, 'isolated@example.test');
    const loginSameTarget = await challenge(account.client, 'isolated@example.test', 'login');
    assert.equal((await account.client.send('POST', '/api/auth/register', { ...registerOtp, password })).statusCode, 200);
    assert.equal((await account.client.send('POST', '/api/auth/otp/verify', loginSameTarget)).statusCode, 200);
  });
  it('rejects missing, expired, foreign-session and replayed reauth; current password is mandatory', async () => {
    const account = await h.login('stepup@example.test');
    const other = h.client();
    assert.equal((await other.send('POST', '/api/auth/password/login', { channel: 'email', target: account.user.email, password })).statusCode, 200);
    assert.equal((await account.client.send('POST', '/api/auth/password/change', { password: changed, current_password: password })).statusCode, 400);
    assert.equal((await change(account.client, 'invalid-token')).statusCode, 403);
    const sent = await account.client.send('POST', '/api/auth/reauth/request', {});
    const id = sent.json().data.challenge_id;
    const otpBody = { challenge_id: id, code: h.codes.get(id)!.code };
    assert.equal((await other.send('POST', '/api/auth/reauth/verify', otpBody)).statusCode, 400);
    const verified = await account.client.send('POST', '/api/auth/reauth/verify', otpBody);
    const token = verified.json().data.reauth_token;
    assert.equal((await account.client.send('POST', '/api/auth/reauth/verify', otpBody)).statusCode, 400);
    assert.equal((await change(other, token)).statusCode, 403);
    assert.equal((await account.client.send('POST', '/api/auth/password/change', { password: changed, reauth_token: token })).statusCode, 400);
    assert.equal((await change(account.client, token, 'wrong-password')).statusCode, 401);
    await sql`update password_reauth set created_at=now()-interval '10 minutes',expires_at=now()-interval '1 minute' where user_id=${account.user.id}`.execute(h.db);
    assert.equal((await change(account.client, token)).statusCode, 403);
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='password_change_send_cooldown'`.execute(h.db);
    await sql`update auth_rate_limits set expires_at=now()-interval '1 second' where scope='password_change_user' and window_seconds=60`.execute(h.db);
    const fresh = await h.reauth(account.client);
    assert.equal((await change(account.client, fresh)).statusCode, 200);
    assert.equal((await change(account.client, fresh, changed)).statusCode, 403);
    assert.equal((await other.send('GET', '/api/auth/me')).statusCode, 401);
    assert.equal((await other.send('POST', '/api/auth/refresh', {})).statusCode, 401);
    assert.equal((await account.client.send('GET', '/api/auth/me')).statusCode, 200);
    assert.equal((await h.client().send('POST', '/api/auth/password/login', { channel: 'email', target: account.user.email, password: changed })).statusCode, 200);
    const stored = (await sql<{token_hash: Buffer}>`select token_hash from password_reauth where user_id=${account.user.id}`.execute(h.db)).rows;
    assert.ok(stored.every(row => row.token_hash.length === 32 && row.token_hash.toString() !== fresh));
  });
  it('rejects OTP failures after five tries, expiry, revoked sessions and client-chosen destinations', async () => {
    const account = await h.login('otp-boundary@example.test');
    assert.equal((await account.client.send('POST', '/api/auth/reauth/request', { target: 'attacker@example.test' })).statusCode, 400);
    const sent = await account.client.send('POST', '/api/auth/reauth/request', {});
    const id = sent.json().data.challenge_id;
    const body = { challenge_id: id, code: h.codes.get(id)!.code };
    for (let n = 0; n < 5; n++) assert.equal((await account.client.send('POST', '/api/auth/reauth/verify', { ...body, code: 'wrong' })).statusCode, 400);
    assert.equal((await account.client.send('POST', '/api/auth/reauth/verify', body)).statusCode, 400);
    await sql`update otp_codes set attempts=0,created_at=now()-interval '10 minutes',expires_at=now()-interval '1 minute' where id=${id}`.execute(h.db);
    assert.equal((await account.client.send('POST', '/api/auth/reauth/verify', body)).statusCode, 400);
    await account.client.send('POST', '/api/auth/logout', {});
    assert.equal((await account.client.send('POST', '/api/auth/reauth/verify', body)).statusCode, 401);
  });
  it('refuses step-up when neither phone nor email is bound', async () => {
    const account = await h.login('no-identity@example.test');
    // Model a legacy account whose OTP identities were removed by an operator.
    await sql`delete from identities where user_id=${account.user.id}`.execute(h.db);
    const result = await account.client.send('POST', '/api/auth/reauth/request', {});
    assert.equal(result.statusCode, 409);
    assert.equal(result.json().code, 'identity_required');
  });
});
