import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { sql } from 'kysely';
import { harness, type Harness } from './helpers.js';

describe('authenticated account profile', () => {
  let h: Harness;
  before(async () => { h = await harness(); });
  after(async () => { await h?.close(); });

  it('requires a session and the existing CSRF protection', async () => {
    assert.equal((await h.client().send('PATCH', '/api/auth/me', { name: 'Name' })).statusCode, 401);
    const { client } = await h.login('profile-csrf@example.test');
    for (const headers of [{ origin: 'https://evil.test' }, { 'x-dwa-csrf': '' }] as Record<string, string>[]) {
      assert.equal((await client.send('PATCH', '/api/auth/me', { name: 'Name' }, headers)).statusCode, 403);
    }
  });

  it('validates trimmed 1–40 Unicode characters and only accepts name', async () => {
    const { client } = await h.login('profile-validation@example.test');
    for (const body of [{}, { name: null }, { name: 7 }, { name: '' }, { name: '   ' }, { name: '\0' },
      { name: 'a'.repeat(41) }, { name: '😀'.repeat(41) }, { name: 'Name', email: 'other@example.test' },
      { name: 'Name', user_id: 'someone-else' }]) {
      assert.equal((await client.send('PATCH', '/api/auth/me', body)).statusCode, 400);
    }
    for (const name of ['A', '中'.repeat(40), '😀'.repeat(40)]) {
      const response = await client.send('PATCH', '/api/auth/me', { name: `  ${name}  ` });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().data.user.name, name);
    }
  });

  it('persists only the caller name, preserves identity, membership, password and session', async () => {
    const { client, user } = await h.login('profile-update@example.test');
    const other = await h.login('profile-other@example.test');
    const created = await client.send('POST', '/api/teams', { name: 'Profile team', display_name: 'Organization name' });
    assert.equal(created.statusCode, 201);
    const original = (await client.send('GET', '/api/auth/me')).json().data;
    const cookies = client.cookieHeader();
    const response = await client.send('PATCH', '/api/auth/me', { name: '  Account name  ' });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().data, { ...original, user: { ...original.user, name: 'Account name' } });
    assert.equal(response.cookies.length, 0);
    assert.equal(client.cookieHeader(), cookies);
    assert.equal((await client.send('GET', '/api/auth/me')).json().data.user.name, 'Account name');
    const stored = (await sql<{name: string}>`select name from users where id=${user.id}`.execute(h.db)).rows[0]!;
    assert.equal(stored.name, 'Account name');
    assert.equal((await other.client.send('GET', '/api/auth/me')).json().data.user.name, other.user.name);
    const members = (await client.send('GET', `/api/teams/${created.json().data.team_id}/members`)).json().data;
    assert.equal(members.find((m: {user_id: string}) => m.user_id === user.id).display_name, 'Organization name');
  });
});
