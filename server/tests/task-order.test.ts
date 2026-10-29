import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { sql } from 'kysely';
import { harness, task, type Harness } from './helpers.js';
import { up as addSortOrder } from '../src/db/migrations/006_task_sort_order.js';

describe('persistent sibling task ordering', () => {
  let h: Harness;
  let owner: Awaited<ReturnType<Harness['login']>>;
  let outsider: Awaited<ReturnType<Harness['login']>>;
  let team: number;
  type Row = { id: number; version: number; sort_order: number; parent_id: number | null; progress: number; status: string };
  async function create(title: string, parent?: number) {
    const r = await owner.client.send('POST', `/api/teams/${team}/tasks`, { ...task, title, ...(parent ? { parent_id: parent } : {}) });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().data as Row;
  }
  async function siblings(parent: number): Promise<Row[]> {
    const r = await owner.client.send('GET', `/api/teams/${team}/tasks`);
    assert.equal(r.statusCode, 200);
    return r.json().data.filter((row: Row) => row.parent_id === parent);
  }
  function reorder(parent: number, rows: Row[], client = owner.client) {
    return client.send('PATCH', `/api/tasks/${parent}/children/reorder`, {
      children: rows.map(row => ({ id: row.id, expected_version: row.version })),
    });
  }
  before(async () => {
    h = await harness();
    owner = await h.login('task-order@example.test');
    outsider = await h.login('task-order-outsider@example.test');
    const r = await owner.client.send('POST', '/api/teams', { name: 'Order tests', display_name: 'Owner' });
    team = r.json().data.team_id;
  });
  after(async () => { await h?.close(); });

  it('persists order across reads, appends new children, and preserves derived parent state', async () => {
    const parent = await create('Parent');
    const a = await create('A', parent.id);
    const b = await create('B', parent.id);
    const c = await create('C', parent.id);
    assert.equal((await owner.client.send('PATCH', `/api/tasks/${b.id}/complete`, { done: true, expected_version: b.version })).statusCode, 200);
    const before = (await owner.client.send('GET', `/api/tasks/${parent.id}`)).json().data;
    const initial = await siblings(parent.id);
    const ordered = [initial[2]!, initial[0]!, initial[1]!];
    const saved = await reorder(parent.id, ordered);
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().data.map((r: Row) => r.id), [c.id, a.id, b.id]);
    assert.deepEqual((await siblings(parent.id)).map(r => r.id), [c.id, a.id, b.id]);
    const after = (await owner.client.send('GET', `/api/tasks/${parent.id}`)).json().data;
    assert.equal(after.progress, 33);
    assert.equal(after.status, 'in_progress');
    assert.equal(after.version, before.version);
    const d = await create('D', parent.id);
    assert.deepEqual((await siblings(parent.id)).map(r => r.id), [c.id, a.id, b.id, d.id]);
    assert.equal((await reorder(parent.id, ordered)).statusCode, 409); // stale membership + versions
  });

  it('rejects incomplete, duplicate, foreign, archived, nested and unauthorized input atomically', async () => {
    const p = await create('Boundary parent');
    const a = await create('A', p.id);
    const b = await create('B', p.id);
    const other = await create('Other parent');
    const foreign = await create('Other child', other.id);
    assert.equal((await reorder(p.id, [a])).statusCode, 409);
    assert.equal((await reorder(p.id, [a, a])).statusCode, 400);
    assert.equal((await reorder(p.id, [a, foreign])).statusCode, 400);
    assert.equal((await reorder(a.id, [a, b])).statusCode, 400);
    assert.equal((await reorder(p.id, [b, a], outsider.client)).statusCode, 403);
    assert.deepEqual((await siblings(p.id)).map(r => r.id), [a.id, b.id]);
    assert.equal((await owner.client.send('POST', `/api/teams/${team}/tasks`, { ...task, parent_id: a.id })).statusCode, 400);
    assert.equal((await owner.client.send('PATCH', `/api/tasks/${b.id}/archive`, { archived: true, expected_version: b.version })).statusCode, 200);
    assert.equal((await reorder(p.id, [b, a])).statusCode, 400);
    assert.equal((await reorder(p.id, [a])).statusCode, 200);
  });

  it('allows one concurrent writer and rejects stale child edits without partial updates', async () => {
    const p = await create('Race parent');
    const a = await create('A', p.id);
    const b = await create('B', p.id);
    const results = await Promise.all([reorder(p.id, [b, a]), reorder(p.id, [b, a])]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    const saved = await siblings(p.id);
    assert.deepEqual(saved.map(r => r.id), [b.id, a.id]);
    assert.ok(saved.every(r => r.version === 2));
    const edited = await owner.client.send('PUT', `/api/tasks/${a.id}`, { ...task, title: 'Edited', expected_version: 2 });
    assert.equal(edited.statusCode, 200);
    assert.equal((await reorder(p.id, [...saved].reverse())).statusCode, 409);
    assert.deepEqual((await siblings(p.id)).map(r => r.id), [b.id, a.id]);
    const raw = (await sql<{sort_order: number}>`select sort_order from tasks where parent_id=${p.id} order by sort_order,id`.execute(h.db)).rows;
    assert.deepEqual(raw.map(r => r.sort_order), [0, 1]);
  });

  it('backfills legacy sibling id order without changing versions or derived progress', async () => {
    const p = await create('Migration parent');
    const a = await create('Earlier id, later due date', p.id);
    const b = await create('Later id, earlier due date', p.id);
    await sql`update tasks set due_date='2026-10-30' where id=${a.id}`.execute(h.db);
    const before = (await owner.client.send('GET', `/api/tasks/${p.id}`)).json().data;
    await h.db.transaction().execute(async tx => {
      // Recreate the exact pre-006 shape in the disposable test database only.
      await sql`alter table tasks drop column sort_order`.execute(tx);
      await addSortOrder(tx);
    });
    assert.deepEqual((await siblings(p.id)).map(r => [r.id, r.sort_order, r.version]), [[a.id, 0, 1], [b.id, 1, 1]]);
    const after = (await owner.client.send('GET', `/api/tasks/${p.id}`)).json().data;
    assert.equal(after.version, before.version);
    assert.equal(after.progress, before.progress);
  });
});
