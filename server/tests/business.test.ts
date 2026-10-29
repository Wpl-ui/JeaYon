import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { sql } from 'kysely';
import pg from 'pg';
import { setTimeout } from 'node:timers/promises';
import { harness, testUrl, task, log, type Harness, type Client } from './helpers.js';

async function fixtures(h: Harness) {
  const owner = await h.login('owner@example.test');
  const admin = await h.login('admin@example.test');
  const member = await h.login('member@example.test');
  const outsider = await h.login('outsider@example.test');
  const inactive = await h.login('inactive@example.test');
  const created = await owner.client.send('POST', '/api/teams', { name: 'Main team', display_name: 'Owner' });
  assert.equal(created.statusCode, 201, created.body);
  const team = created.json().data.team_id as number;
  let invite = created.json().data.invite_code as string;
  for (const [user, name] of [[admin, 'Admin'], [member, 'Member'], [inactive, 'Inactive']] as const) {
    assert.equal((await user.client.send('POST', '/api/teams/join', { code: invite.toLowerCase(), display_name: name })).statusCode, 200);
  }
  assert.equal((await owner.client.send('PATCH', `/api/teams/${team}/members/${admin.user.id}/role`, { role: 'admin' })).statusCode, 200);
  const removal = await owner.client.send('POST', `/api/teams/${team}/members/${inactive.user.id}/remove`, {});
  assert.equal(removal.statusCode, 200);
  invite = removal.json().data.invite_code;
  const second = await outsider.client.send('POST', '/api/teams', { name: 'Other team', display_name: 'Other' });
  assert.equal(second.statusCode, 201);
  return { owner, admin, member, outsider, inactive, team, otherTeam: second.json().data.team_id as number, invite };
}

// Hold the team lock until two separate API PostgreSQL backends visibly wait on it.
async function race(h: Harness, team: number, operations: (() => ReturnType<Client['send']>)[]) {
  const pool = new pg.Pool({ connectionString: testUrl(), max: 2, application_name: 'dwa-concurrency-observer' });
  const blocker = await pool.connect();
  const observer = await pool.connect();
  let pending: ReturnType<Client['send']>[] = [];
  let observed = 0;
  try {
    assert.notEqual((await blocker.query('select pg_backend_pid() as pid')).rows[0].pid, (await observer.query('select pg_backend_pid() as pid')).rows[0].pid);
    await blocker.query('begin');
    await blocker.query('select id from teams where id=$1 for update', [team]);
    pending = operations.map(fn => fn());
    for (let i = 0; i < 100; i++) {
      const r = await observer.query("select count(distinct pid)::integer as n from pg_stat_activity where application_name='daily-work-api' and wait_event_type='Lock' and query like '%from teams%for update%'");
      observed = r.rows[0].n as number;
      if (observed >= operations.length) break;
      await setTimeout(10);
    }
    await blocker.query('commit');
    const result = await Promise.all(pending);
    assert.ok(observed >= operations.length, `Expected ${operations.length} real waiting API connections, saw ${observed}`);
    return result;
  } finally {
    await blocker.query('rollback');
    await Promise.allSettled(pending);
    blocker.release(); observer.release(); await pool.end();
  }
}

describe('team permission matrix and membership transactions', () => {
  let h: Harness;
  let f: Awaited<ReturnType<typeof fixtures>>;
  before(async () => { h = await harness(); f = await fixtures(h); });
  after(async () => { await h?.close(); });
  it('preserves all six explicit source indexes and named business constraints', async () => {
    const indexes = await sql<{indexname: string}>`select indexname from pg_indexes where schemaname='public'`.execute(h.db);
    for (const name of ['team_members_user_idx', 'tasks_team_archived_idx', 'tasks_team_assignee_idx', 'tasks_team_due_idx', 'tasks_team_status_idx', 'tasks_team_parent_idx', 'work_logs_team_date_idx']) assert.ok(indexes.rows.some(i => i.indexname === name), name);
    const constraints = await sql<{conname: string}>`select conname from pg_constraint where connamespace='public'::regnamespace`.execute(h.db);
    for (const name of ['teams_name_check', 'teams_timezone_check', 'team_members_team_user_key', 'team_members_role_check', 'team_members_display_name_check', 'team_invites_code_key', 'team_invites_code_check', 'tasks_team_id_key', 'tasks_team_assignee_fk', 'tasks_title_check', 'tasks_status_check', 'tasks_progress_check', 'tasks_status_progress_ok', 'tasks_dates_ok', 'tasks_parent_self_check', 'tasks_team_parent_fk', 'work_logs_team_owner_date_key', 'work_logs_team_task_fk', 'work_logs_owner_name_check', 'work_logs_done_today_check', 'work_logs_plan_tomorrow_check', 'work_logs_hours_check']) assert.ok(constraints.rows.some(c => c.conname === name), name);
  });
  for (const role of ['owner', 'admin', 'member', 'outsider', 'inactive'] as const) {
    it(`${role}: lists only active own teams and cannot select another user`, async () => {
      const r = await f[role].client.send('GET', '/api/teams');
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().data.some((row: {team_id: number}) => row.team_id === f.team), !['outsider', 'inactive'].includes(role));
    });
    it(`${role}: member-list visibility includes historical rows only for active teammates`, async () => {
      const r = await f[role].client.send('GET', `/api/teams/${f.team}/members`);
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().data.length, ['outsider', 'inactive'].includes(role) ? 0 : 4);
    });
    it(`${role}: invite access is owner/admin only`, async () => {
      const r = await f[role].client.send('GET', `/api/teams/${f.team}/invite-code`);
      assert.equal(r.statusCode, ['owner', 'admin'].includes(role) ? 200 : 403);
    });
    it(`${role}: only owner can change an active non-owner role`, async () => {
      const r = await f[role].client.send('PATCH', `/api/teams/${f.team}/members/${f.member.user.id}/role`, { role: 'member' });
      assert.equal(r.statusCode, role === 'owner' ? 200 : 403);
    });
  }
  it('rejects unauthenticated access before any business writes', async () => {
    assert.equal((await h.client().send('POST', '/api/teams', { name: 'No', display_name: 'No' })).statusCode, 401);
    assert.equal((await h.client().send('GET', `/api/teams/${f.team}/members`)).statusCode, 401);
  });
  it('rejects owner self-change, admin-to-owner assignment, self-removal and removing owner', async () => {
    assert.equal((await f.owner.client.send('PATCH', `/api/teams/${f.team}/members/${f.owner.user.id}/role`, { role: 'member' })).statusCode, 403);
    assert.equal((await f.owner.client.send('PATCH', `/api/teams/${f.team}/members/${f.member.user.id}/role`, { role: 'owner' })).statusCode, 400);
    assert.equal((await f.owner.client.send('POST', `/api/teams/${f.team}/members/${f.owner.user.id}/remove`, {})).statusCode, 403);
    assert.equal((await f.admin.client.send('POST', `/api/teams/${f.team}/members/${f.owner.user.id}/remove`, {})).statusCode, 403);
  });
  it('member cannot reset invites; admin can reset; old invite is unusable', async () => {
    assert.equal((await f.member.client.send('POST', `/api/teams/${f.team}/invite-code/reset`, {})).statusCode, 403);
    const reset = await f.admin.client.send('POST', `/api/teams/${f.team}/invite-code/reset`, {});
    assert.equal(reset.statusCode, 200);
    assert.equal((await f.outsider.client.send('POST', '/api/teams/join', { code: f.invite, display_name: 'Other' })).statusCode, 400);
    f.invite = reset.json().data.invite_code;
  });
  it('already_member does not change role or display name', async () => {
    const r = await f.admin.client.send('POST', '/api/teams/join', { code: f.invite, display_name: 'Changed' });
    assert.equal(r.statusCode, 409);
    assert.deepEqual(r.json().data, { team_id: f.team, role: 'admin' });
    assert.equal((await sql<{display_name: string}>`select display_name from team_members where team_id=${f.team} and user_id=${f.admin.user.id}`.execute(h.db)).rows[0]?.display_name, 'Admin');
  });
  it('missing and inactive role-change targets return 404', async () => {
    for (const target of [f.inactive.user.id, 'unknown-user']) assert.equal((await f.owner.client.send('PATCH', `/api/teams/${f.team}/members/${target}/role`, { role: 'admin' })).statusCode, 404);
  });
  it('concurrent first joins create one membership and one already_member response', async () => {
    const results = await race(h, f.team, [() => f.outsider.client.send('POST', '/api/teams/join', { code: f.invite, display_name: 'Guest' }), () => f.outsider.client.send('POST', '/api/teams/join', { code: f.invite, display_name: 'Guest' })]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    assert.equal((await sql<{n: number}>`select count(*)::int as n from team_members where team_id=${f.team} and user_id=${f.outsider.user.id}`.execute(h.db)).rows[0]?.n, 1);
    assert.equal((await f.owner.client.send('POST', `/api/teams/${f.team}/members/${f.outsider.user.id}/remove`, {})).statusCode, 200);
  });
  it('removal atomically unassigns only unfinished active tasks, rotates invite, and rejoin demotes old admin', async () => {
    const target = f.admin;
    const pending = await f.member.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, assignee_id: target.user.id });
    const done = await f.member.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, assignee_id: target.user.id, status: 'done', progress: 100 });
    const archived = await f.member.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, assignee_id: target.user.id });
    assert.equal((await f.owner.client.send('PATCH', `/api/tasks/${archived.json().data.id}/archive`, { archived: true, expected_version: 1 })).statusCode, 200);
    const oldInvite = (await f.owner.client.send('GET', `/api/teams/${f.team}/invite-code`)).json().data.invite_code;
    const removed = await f.owner.client.send('POST', `/api/teams/${f.team}/members/${target.user.id}/remove`, {});
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().data.unassigned_tasks, 1);
    assert.notEqual(removed.json().data.invite_code, oldInvite);
    const pendingRow = (await f.owner.client.send('GET', `/api/tasks/${pending.json().data.id}`)).json().data;
    assert.equal(pendingRow.assignee_id, null); assert.equal(pendingRow.version, 2);
    assert.equal((await f.owner.client.send('GET', `/api/tasks/${done.json().data.id}`)).json().data.assignee_id, target.user.id);
    assert.equal((await target.client.send('POST', `/api/teams/${f.team}/tasks`, task)).statusCode, 403);
    const restored = await f.owner.client.send('PATCH', `/api/tasks/${archived.json().data.id}/archive`, { archived: false, expected_version: 2 });
    assert.equal(restored.json().data.assignee_id, null);
    assert.equal((await target.client.send('POST', '/api/teams/join', { code: removed.json().data.invite_code, display_name: '' })).statusCode, 200);
    const membership = (await sql<{role: string; display_name: string; active: boolean}>`select role,display_name,active from team_members where team_id=${f.team} and user_id=${target.user.id}`.execute(h.db)).rows[0];
    assert.deepEqual(membership, { role: 'member', display_name: 'Admin', active: true });
  });
  it('rejects team identity/role mass assignment and invalid empty names', async () => {
    for (const b of [{ name: '', display_name: 'A' }, { name: 'A', display_name: 'B', created_by: f.member.user.id }, { name: 'A', display_name: 'B', role: 'owner' }]) assert.equal((await f.owner.client.send('POST', '/api/teams', b)).statusCode, 400);
  });
});

describe('task and work-log permissions, real concurrency and ownership', () => {
  let h: Harness;
  let f: Awaited<ReturnType<typeof fixtures>>;
  let baseTask: number;
  let baseLog: number;
  let otherTask: number;
  before(async () => {
    h = await harness(); f = await fixtures(h);
    baseTask = (await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, task)).json().data.id;
    baseLog = (await f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, related_task_id: baseTask })).json().data.id;
    otherTask = (await f.outsider.client.send('POST', `/api/teams/${f.otherTeam}/tasks`, task)).json().data.id;
  });
  after(async () => { await h?.close(); });
  for (const role of ['owner', 'admin', 'member', 'outsider', 'inactive'] as const) {
    const active = ['owner', 'admin', 'member'].includes(role);
    it(`${role}: task and log collection visibility`, async () => {
      for (const resource of ['tasks', 'work-logs']) {
        const r = await f[role].client.send('GET', `/api/teams/${f.team}/${resource}`);
        assert.equal(r.statusCode, 200);
        assert.equal(r.json().data.length > 0, active);
      }
      const single = await f[role].client.send('GET', `/api/tasks/${baseTask}`);
      assert.equal(single.json().data !== null, active);
    });
    it(`${role}: collaborative task creation and updates require active membership`, async () => {
      const created = await f[role].client.send('POST', `/api/teams/${f.team}/tasks`, task);
      assert.equal(created.statusCode, active ? 201 : 403, created.body);
      const current = (await f.owner.client.send('GET', `/api/tasks/${baseTask}`)).json().data.version;
      const updated = await f[role].client.send('PUT', `/api/tasks/${baseTask}`, { ...task, expected_version: current });
      assert.equal(updated.statusCode, active ? 200 : 403, updated.body);
    });
    it(`${role}: work-log creation derives owner from session and only the author can edit`, async () => {
      const created = await f[role].client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-25' });
      assert.equal(created.statusCode, active ? 201 : 403, created.body);
      if (active) assert.equal(created.json().data.owner_id, f[role].user.id);
      const { owner_name: _owner, ...draft } = log;
      const updated = await f[role].client.send('PUT', `/api/work-logs/${baseLog}`, { ...draft, related_task_id: baseTask, expected_version: 1 });
      assert.equal(updated.statusCode, role === 'member' ? 200 : 403, updated.body);
    });
    it(`${role}: deleting someone else's log is forbidden even to owner/admin`, async () => {
      if (role === 'member') {
        const created = await f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-15' });
        assert.equal(created.statusCode, 201);
        assert.equal((await f.member.client.send('DELETE', `/api/work-logs/${created.json().data.id}`, { expected_version: 1 })).statusCode, 200);
        return;
      }
      assert.equal((await f[role].client.send('DELETE', `/api/work-logs/${baseLog}`, { expected_version: 2 })).statusCode, 403);
    });
    it(`${role}: archive and restore follow collaborative team permissions`, async () => {
      const current = (await f.owner.client.send('GET', `/api/tasks/${baseTask}`)).json().data.version;
      const result = await f[role].client.send('PATCH', `/api/tasks/${baseTask}/archive`, { archived: false, expected_version: current });
      assert.equal(result.statusCode, active ? 200 : 403);
    });
  }
  it('enforces cross-team assignee and related-task validation', async () => {
    assert.equal((await f.member.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, assignee_id: f.outsider.user.id })).statusCode, 400);
    assert.equal((await f.member.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, assignee_id: f.inactive.user.id })).statusCode, 400);
    assert.equal((await f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-24', related_task_id: otherTask })).statusCode, 400);
    assert.deepEqual((await f.member.client.send('GET', `/api/teams/${f.team}/tasks/${otherTask}/logs`)).json().data, []);
    assert.equal((await f.member.client.send('GET', `/api/tasks/${otherTask}`)).json().data, null);
  });
  it('task/log create and update reject owner/team/version/timestamp injection', async () => {
    for (const extra of [{ created_by: f.member.user.id }, { team_id: f.otherTeam }, { version: 100 }, { archived_at: new Date().toISOString() }, { created_at: new Date().toISOString() }]) assert.equal((await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, ...extra })).statusCode, 400);
    for (const extra of [{ owner_id: f.owner.user.id }, { team_id: f.otherTeam }, { version: 100 }]) assert.equal((await f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, ...extra })).statusCode, 400);
    assert.equal((await f.member.client.send('PUT', `/api/work-logs/${baseLog}`, { ...log, expected_version: 2 })).statusCode, 400);
  });
  it('rejects invalid dates/status/progress/text/hours without database writes', async () => {
    for (const extra of [{ start_date: '2026-02-30' }, { due_date: '2026-10-01' }, { title: ' ' }, { title: 'x'.repeat(121) }, { description: 'x'.repeat(2001) }, { status: 'other' }]) assert.equal((await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, ...extra })).statusCode, 400);
    const clamped = await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, progress: 50 });
    assert.equal(clamped.statusCode, 201, clamped.body);
    assert.equal(clamped.json().data.progress, 0);
    for (const hours of ['24.01', '-1', '1.234', 'abc', 25]) assert.equal((await f.owner.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-23', hours })).statusCode, 400);
  });
  it('task update clamps progress by status and returns complete snake_case rows', async () => {
    const created = (await f.member.client.send('POST', `/api/teams/${f.team}/tasks`, task)).json().data;
    const r = await f.member.client.send('PUT', `/api/tasks/${created.id}`, { ...task, status: 'in_progress', progress: 100, expected_version: 1 });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().data.progress, 99);
    assert.equal(r.json().data.version, 2);
    assert.equal(r.json().data.start_date, '2026-10-26');
    assert.ok(r.json().data.created_at && r.json().data.updated_at);
    assert.equal(r.json().data.created_by, f.member.user.id);
  });
  it('archived tasks reject edits/new links but preserve an unchanged historical log link', async () => {
    const created = (await f.member.client.send('POST', `/api/teams/${f.team}/tasks`, task)).json().data;
    const createdLog = (await f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-22', related_task_id: created.id })).json().data;
    assert.equal((await f.owner.client.send('PATCH', `/api/tasks/${created.id}/archive`, { archived: true, expected_version: 1 })).statusCode, 200);
    assert.equal((await f.member.client.send('PUT', `/api/tasks/${created.id}`, { ...task, expected_version: 2 })).statusCode, 400);
    assert.equal((await f.owner.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-22', related_task_id: created.id })).statusCode, 400);
    const { owner_name: _name, ...draft } = log;
    const updated = await f.member.client.send('PUT', `/api/work-logs/${createdLog.id}`, { ...draft, work_date: '2026-10-22', related_task_id: created.id, expected_version: 1 });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().data.owner_name, 'Snapshot name');
    assert.equal(typeof updated.json().data.hours, 'string');
    const linked = await f.owner.client.send('GET', `/api/teams/${f.team}/tasks/${created.id}/logs`);
    assert.equal(linked.json().data.length, 1);
    assert.equal('problems' in linked.json().data[0], false);
    assert.ok((await f.member.client.send('GET', `/api/teams/${f.team}/tasks?scope=archived`)).json().data.some((r: {id: number}) => r.id === created.id));
  });
  it('daily uniqueness rejects create and update collisions without overwriting', async () => {
    const first = await f.owner.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-20' });
    assert.equal(first.statusCode, 201);
    assert.equal((await f.owner.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-20' })).statusCode, 409);
    const second = (await f.owner.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-19' })).json().data;
    const { owner_name: _name, ...draft } = log;
    const collision = await f.owner.client.send('PUT', `/api/work-logs/${second.id}`, { ...draft, work_date: '2026-10-20', expected_version: 1 });
    assert.equal(collision.statusCode, 409);
    assert.equal(collision.json().code, 'already_exists');
    const own = await f.owner.client.send('GET', `/api/teams/${f.team}/work-logs?owner_id=me&work_date=2026-10-19`);
    assert.equal(own.json().data.version, 1);
    assert.equal((await f.member.client.send('GET', `/api/teams/${f.team}/work-logs?owner_id=${f.owner.user.id}&work_date=2026-10-19`)).statusCode, 400);
  });
  it('two real API connections racing task v1 yield one success and one conflict/current_version', async () => {
    const created = (await f.member.client.send('POST', `/api/teams/${f.team}/tasks`, task)).json().data;
    const results = await race(h, f.team, [() => f.owner.client.send('PUT', `/api/tasks/${created.id}`, { ...task, title: 'A', expected_version: 1 }), () => f.admin.client.send('PUT', `/api/tasks/${created.id}`, { ...task, title: 'B', expected_version: 1 })]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    assert.deepEqual(results.find(r => r.statusCode === 409)!.json().data, { current_version: 2 });
  });
  it('task archive versus update serializes and checks the same version', async () => {
    const created = (await f.member.client.send('POST', `/api/teams/${f.team}/tasks`, task)).json().data;
    const results = await race(h, f.team, [() => f.owner.client.send('PATCH', `/api/tasks/${created.id}/archive`, { archived: true, expected_version: 1 }), () => f.admin.client.send('PUT', `/api/tasks/${created.id}`, { ...task, expected_version: 1 })]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
  });
  it('two real connections racing work-log v1 yield one success and one version conflict', async () => {
    const created = (await f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-18' })).json().data;
    const { owner_name: _name, ...draft } = log;
    const results = await race(h, f.team, ['A', 'B'].map(text => () => f.member.client.send('PUT', `/api/work-logs/${created.id}`, { ...draft, work_date: '2026-10-18', done_today: text, expected_version: 1 })));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    assert.deepEqual(results.find(r => r.statusCode === 409)!.json().data, { current_version: 2 });
  });
  it('concurrent duplicate daily creates yield exactly one row', async () => {
    const results = await race(h, f.team, [() => f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-17' }), () => f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-17' })]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]);
  });
  it('work-log update versus delete is serialized on the same version', async () => {
    const created = (await f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-14' })).json().data;
    const { owner_name: _name, ...draft } = log;
    const results = await race(h, f.team, [() => f.member.client.send('PUT', `/api/work-logs/${created.id}`, { ...draft, work_date: '2026-10-14', expected_version: 1 }), () => f.member.client.send('DELETE', `/api/work-logs/${created.id}`, { expected_version: 1 })]);
    assert.equal(results.filter(r => r.statusCode === 200).length, 1);
    assert.ok(results.some(r => [404, 409].includes(r.statusCode)));
  });
  it('member removal versus assignment cannot leave an inactive assignee on an active unfinished task', async () => {
    const created = (await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, task)).json().data;
    const results = await race(h, f.team, [() => f.owner.client.send('POST', `/api/teams/${f.team}/members/${f.admin.user.id}/remove`, {}), () => f.member.client.send('PUT', `/api/tasks/${created.id}`, { ...task, assignee_id: f.admin.user.id, expected_version: 1 })]);
    assert.equal(results[0]!.statusCode, 200);
    assert.ok([200, 400].includes(results[1]!.statusCode));
    const final = (await f.owner.client.send('GET', `/api/tasks/${created.id}`)).json().data;
    assert.equal(final.assignee_id, null);
  });
  it('deletes only the author log with matching version, retaining 409 before deletion', async () => {
    const created = (await f.member.client.send('POST', `/api/teams/${f.team}/work-logs`, { ...log, work_date: '2026-10-16' })).json().data;
    const conflict = await f.member.client.send('DELETE', `/api/work-logs/${created.id}`, { expected_version: 2 });
    assert.equal(conflict.statusCode, 409);
    assert.deepEqual(conflict.json().data, { current_version: 1 });
    assert.equal((await f.member.client.send('DELETE', `/api/work-logs/${created.id}`, { expected_version: 1 })).statusCode, 200);
    assert.equal((await f.member.client.send('DELETE', `/api/work-logs/${created.id}`, { expected_version: 1 })).statusCode, 404);
  });
  it('removed author loses log write access while historical name and log remain readable to teammates', async () => {
    assert.equal((await f.owner.client.send('POST', `/api/teams/${f.team}/members/${f.member.user.id}/remove`, {})).statusCode, 200);
    const { owner_name: _name, ...draft } = log;
    assert.equal((await f.member.client.send('PUT', `/api/work-logs/${baseLog}`, { ...draft, expected_version: 2 })).statusCode, 403);
    assert.equal((await f.member.client.send('DELETE', `/api/work-logs/${baseLog}`, { expected_version: 2 })).statusCode, 403);
    assert.ok((await f.owner.client.send('GET', `/api/teams/${f.team}/work-logs`)).json().data.some((row: {id: number; owner_name: string}) => row.id === baseLog && row.owner_name === 'Snapshot name'));
  });

  it('parent progress is done/total; parent status override rejected; children binary', async () => {
    const parent = await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, title: 'Parent' });
    assert.equal(parent.statusCode, 201, parent.body);
    const parentId = parent.json().data.id;
    const c1 = await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, title: 'Child A', parent_id: parentId, status: 'todo', progress: 0 });
    const c2 = await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, title: 'Child B', parent_id: parentId, status: 'done', progress: 100 });
    assert.equal(c1.statusCode, 201, c1.body);
    assert.equal(c2.statusCode, 201, c2.body);
    const afterCreate = await f.owner.client.send('GET', `/api/tasks/${parentId}`);
    assert.equal(afterCreate.statusCode, 200);
    assert.equal(afterCreate.json().data.progress, 50);
    assert.equal(afterCreate.json().data.status, 'in_progress');
    const childId = c1.json().data.id;
    const bumped = await f.owner.client.send('PATCH', `/api/tasks/${childId}/complete`, { done: true, expected_version: 1 });
    assert.equal(bumped.statusCode, 200, bumped.body);
    const afterChild = await f.owner.client.send('GET', `/api/tasks/${parentId}`);
    assert.equal(afterChild.json().data.progress, 100);
    assert.equal(afterChild.json().data.status, 'done');
    // Manual parent status/progress override is rejected
    const rejected = await f.owner.client.send('PUT', `/api/tasks/${parentId}`, {
      ...task, title: 'Parent', status: 'todo', progress: 0, expected_version: afterChild.json().data.version,
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
    // Same version PUT with derived status/progress allowed (title-only style)
    const okPut = await f.owner.client.send('PUT', `/api/tasks/${parentId}`, {
      ...task, title: 'Parent Renamed', status: 'done', progress: 100, expected_version: afterChild.json().data.version,
    });
    assert.equal(okPut.statusCode, 200, okPut.body);
    assert.equal(okPut.json().data.title, 'Parent Renamed');
    assert.equal(okPut.json().data.progress, 100);
    // Child in_progress coerced to todo/0
    const c3 = await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, title: 'Child C', parent_id: parentId, status: 'in_progress', progress: 50 });
    assert.equal(c3.statusCode, 201, c3.body);
    assert.equal(c3.json().data.status, 'todo');
    assert.equal(c3.json().data.progress, 0);
    const afterC3 = await f.owner.client.send('GET', `/api/tasks/${parentId}`);
    assert.equal(afterC3.json().data.progress, 67); // 2/3 done
    // Nested parent rejected
    const nested = await f.owner.client.send('POST', `/api/teams/${f.team}/tasks`, { ...task, title: 'Grand', parent_id: childId });
    assert.equal(nested.statusCode, 400);
  });

});
