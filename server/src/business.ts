import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { first, rows, type Connection, type Database } from './db/index.js';
import { ApiError, date, id, ok, shortText, version } from './http.js';
import type { Actor } from './auth/service.js';
import { audit } from './audit.js';
import { quota, windows } from './auth/quotas.js';
import { ipKey } from './auth/crypto.js';
import type { Config } from './config.js';
import { binaryChild, progressFromChildren, parentStatusOverrideAttempt } from './tasks/hierarchy-contract.js';

type Member = { user_id: string; role: 'owner' | 'admin' | 'member'; active: boolean; display_name: string };
type Task = { id: string; team_id: string; parent_id: string | null; assignee_id: string | null; archived_at: Date | null; version: number; status?: string; progress?: number };
type Log = { id: string; team_id: string; owner_id: string; related_task_id: string | null; version: number };
const taskFields = {
  title: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).nullable(),
  assignee_id: z.string().min(1).max(200).nullable(), status: z.enum(['todo', 'in_progress', 'done']),
  progress: z.number().int().min(0).max(100), start_date: date, due_date: date,
};
const taskDraft = z.object({ ...taskFields, parent_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional() }).strict().refine(v => v.due_date >= v.start_date);
const taskUpdate = z.object({ ...taskFields, expected_version: version }).strict().refine(v => v.due_date >= v.start_date);
const taskReorder = z.object({
  children: z.array(z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), expected_version: version }).strict()).min(1),
}).strict().refine(b => new Set(b.children.map(child => child.id)).size === b.children.length);

const hours = z.union([z.string().trim(), z.number().finite(), z.null()]).transform(v => v === null || v === '' ? null : String(v))
  .refine(v => v === null || (/^\d{1,2}(\.\d{1,2})?$/.test(v) && Number(v) <= 24));
const logFields = { work_date: date, done_today: z.string().trim().min(1).max(2000), problems: z.string().trim().max(2000).nullable(),
  plan_tomorrow: z.string().trim().min(1).max(2000), hours, related_task_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable() };
const logDraft = z.object({ owner_name: shortText, ...logFields }).strict();
const logUpdate = z.object({ ...logFields, expected_version: version }).strict();
const empty = z.object({}).strict();
function teamId(params: unknown) { return z.object({ teamId: id }).parse(params).teamId; }
function resourceId(params: unknown, name: 'taskId' | 'logId') { return z.object({ [name]: id }).parse(params)[name]!; }
function checkVersion(row: { version: number }, expected: number) { if (row.version !== expected) throw new ApiError(409, 'conflict', { current_version: row.version }); }
export class BusinessService {
  constructor(private db: Database) {}
  async team<T>(team: number | string, actor: Actor, write: boolean, fn: (tx: Connection, member: Member | undefined) => Promise<T>) {
    return this.db.transaction().execute(async tx => {
      await (write ? sql`select id from teams where id=${team} for update` : sql`select id from teams where id=${team} for share`).execute(tx);
      const member = await first(tx, sql<Member>`select * from team_members where team_id=${team} and user_id=${actor.userId} and active`);
      if (write && !member) throw new ApiError(403, 'forbidden');
      return fn(tx, member);
    });
  }
  async invite(tx: Connection, team: number | string, actor: Actor) {
    for (let attempt = 0; attempt < 21; attempt++) {
      const code = randomBytes(5).toString('hex').toUpperCase();
      // ON CONFLICT avoids poisoning the transaction on a rare global collision.
      const claim = await first(tx, sql<{code: string}>`insert into team_invites(team_id,code,updated_by)
        values(${team},${code},${actor.userId}) on conflict(code) do nothing returning code`);
      if (claim) return code;
    }
    throw new ApiError(503, 'backend-unavailable');
  }
  async resetInvite(tx: Connection, team: number | string, actor: Actor) {
    // Team lock serializes reset/join. Savepoint-free collision handling retains the old row until a new code is available.
    for (let attempt = 0; attempt < 21; attempt++) {
      const code = randomBytes(5).toString('hex').toUpperCase();
      await sql`savepoint invite_collision`.execute(tx);
      try {
        await sql`insert into team_invites(team_id,code,updated_by) values(${team},${code},${actor.userId})
          on conflict(team_id) do update set code=excluded.code,updated_by=excluded.updated_by,updated_at=now()`.execute(tx);
        await sql`release savepoint invite_collision`.execute(tx);
        return code;
      } catch (e) {
        await sql`rollback to savepoint invite_collision`.execute(tx);
        await sql`release savepoint invite_collision`.execute(tx);
        if (!(e && typeof e === 'object' && 'code' in e && e.code === '23505')) throw e;
      }
    }
    throw new ApiError(503, 'backend-unavailable');
  }
  async assignee(tx: Connection, team: number | string, user: string | null) {
    if (user && !(await first(tx, sql`select 1 from team_members where team_id=${team} and user_id=${user} and active`))) throw new ApiError(400, 'invalid');
  }
  async related(tx: Connection, team: number | string, task: number | null, previous?: string | null) {
    if (task === null) return;
    const found = await first(tx, sql<Task>`select * from tasks where team_id=${team} and id=${task}`);
    if (!found || (found.archived_at && String(task) !== previous)) throw new ApiError(400, 'invalid');
  }
  async task<T>(task: number, actor: Actor, write: boolean, fn: (tx: Connection, row: Task | undefined) => Promise<T>) {
    const located = await first(this.db, sql<Task>`select team_id from tasks where id=${task}`);
    if (!located) { if (write) throw new ApiError(404, 'not_found'); return fn(this.db, undefined); }
    return this.team(located.team_id, actor, write, async (tx, member) => {
      if (!member) return fn(tx, undefined);
      const row = await first(tx, write ? sql<Task>`select * from tasks where id=${task} for update` : sql<Task>`select * from tasks where id=${task}`);
      return fn(tx, row);
    });
  }
  async log<T>(log: number, actor: Actor, fn: (tx: Connection, row: Log) => Promise<T>) {
    const located = await first(this.db, sql<Log>`select team_id from work_logs where id=${log}`);
    if (!located) throw new ApiError(404, 'not_found');
    return this.team(located.team_id, actor, true, async tx => {
      const row = await first(tx, sql<Log>`select * from work_logs where id=${log} for update`);
      if (!row) throw new ApiError(404, 'not_found');
      if (row.owner_id !== actor.userId) throw new ApiError(403, 'forbidden');
      return fn(tx, row);
    });
  }
  async assertParent(tx: Connection, team: number | string, parentId: number | null | undefined) {
    if (parentId == null) return null;
    const parent = await first(tx, sql<Task>`select * from tasks where team_id=${team} and id=${parentId} for update`);
    if (!parent || parent.archived_at) throw new ApiError(400, 'invalid');
    if (parent.parent_id) throw new ApiError(400, 'invalid'); // one level only
    return parent;
  }
  async recomputeParent(tx: Connection, team: number | string, parentId: string | number | null | undefined) {
    if (parentId == null) return null;
    await sql`select id from tasks where id=${parentId} for update`.execute(tx);
    const kids = await rows(tx, sql<{status: string; progress: number}>`select status, progress from tasks
      where team_id=${team} and parent_id=${parentId} and archived_at is null order by sort_order,id`);
    const next = progressFromChildren(kids);
    if (!next) return null;
    return first(tx, sql`update tasks set status=${next.status}, progress=${next.progress}, version=version+1, updated_at=now()
      where id=${parentId} and team_id=${team} returning *`);
  }
  async activeChildCount(tx: Connection, team: number | string, taskId: string | number) {
    const row = await first(tx, sql<{n: string}>`select count(*)::text as n from tasks where team_id=${team} and parent_id=${taskId} and archived_at is null`);
    return Number(row?.n ?? 0);
  }
}
function requireAdmin(member?: Member) { if (!member || !['owner', 'admin'].includes(member.role)) throw new ApiError(403, 'forbidden'); }
export function businessRoutes(app: FastifyInstance, db: Database, c: Config) {
  const s = new BusinessService(db);
  app.get('/api/teams', async req => ok(await rows(db, sql`select m.team_id,m.role,m.display_name,m.joined_at,json_build_object('id',t.id::text,'name',t.name,'timezone',t.timezone,'created_by',t.created_by,'created_at',t.created_at,'updated_at',t.updated_at) as teams
    from team_members m join teams t on t.id=m.team_id where m.user_id=${req.actor!.userId} and m.active order by m.joined_at,m.id`)));
  app.post('/api/teams', async (req, reply) => {
    const b = z.object({ name: shortText, display_name: shortText }).strict().parse(req.body);
    const a = req.actor!;
    const data = await db.transaction().execute(async tx => {
      const team = await first(tx, sql<{id: string}>`insert into teams(name,created_by) values(${b.name},${a.userId}) returning id`);
      if (!team) throw new Error('Team insert failed');
      await sql`insert into team_members(team_id,user_id,role,display_name) values(${team.id},${a.userId},'owner',${b.display_name})`.execute(tx);
      const invite = await s.invite(tx, team.id, a);
      await audit(tx, 'team.create', req.id, a, team.id);
      return { team_id: team.id, name: b.name, role: 'owner', invite_code: invite };
    });
    return reply.code(201).send(ok(data));
  });
  app.post('/api/teams/join', async req => {
    const b = z.object({ code: z.string().trim().toUpperCase().min(1).max(100), display_name: z.string().trim().max(40) }).strict().parse(req.body);
    const a = req.actor!;
    await quota(db, c.RATE_LIMIT_HMAC_SECRET, [...windows('join_user', a.userId, [[60, 10], [86400, 100]]), ...windows('join_ip', ipKey(req.ip), [[60, 30], [86400, 300]])]);
    const located = await first(db, sql<{team_id: string}>`select team_id from team_invites where code=${b.code}`);
    if (!located) throw new ApiError(400, 'invalid_code');
    return db.transaction().execute(async tx => {
      const team = await first(tx, sql<{id: string; name: string}>`select * from teams where id=${located.team_id} for update`);
      const invite = await first(tx, sql`select 1 from team_invites where team_id=${located.team_id} and code=${b.code}`);
      if (!invite || !team) throw new ApiError(400, 'invalid_code');
      const member = await first(tx, sql<Member>`select * from team_members where team_id=${team.id} and user_id=${a.userId} for update`);
      if (member?.active) throw new ApiError(409, 'already_member', { team_id: team.id, role: member.role });
      if (!member && !b.display_name) throw new ApiError(400, 'invalid');
      if (member) await sql`update team_members set active=true,role='member',deactivated_at=null,joined_at=now(),display_name=${b.display_name || member.display_name} where team_id=${team.id} and user_id=${a.userId}`.execute(tx);
      else await sql`insert into team_members(team_id,user_id,display_name) values(${team.id},${a.userId},${b.display_name})`.execute(tx);
      await audit(tx, 'team.join', req.id, a, team.id);
      return ok({ team_id: team.id, name: team.name, role: 'member' });
    });
  });
  app.get('/api/teams/:teamId/members', async req => s.team(teamId(req.params), req.actor!, false, async (tx, member) => ok(member ? await rows(tx, sql`select * from team_members where team_id=${teamId(req.params)} order by joined_at,id`) : [])));
  app.get('/api/teams/:teamId/invite-code', async req => s.team(teamId(req.params), req.actor!, false, async (tx, member) => {
    requireAdmin(member);
    const found = await first(tx, sql<{code: string}>`select code from team_invites where team_id=${teamId(req.params)}`);
    if (!found) throw new ApiError(404, 'not_found');
    return ok({ team_id: teamId(req.params), invite_code: found.code });
  }));
  app.post('/api/teams/:teamId/invite-code/reset', async req => {
    empty.parse(req.body);
    return s.team(teamId(req.params), req.actor!, true, async (tx, member) => {
      requireAdmin(member);
      const invite = await s.resetInvite(tx, teamId(req.params), req.actor!);
      await audit(tx, 'team.invite_reset', req.id, req.actor!, teamId(req.params));
      return ok({ team_id: teamId(req.params), invite_code: invite });
    });
  });
  app.patch('/api/teams/:teamId/members/:userId/role', async req => {
    const b = z.object({ role: z.enum(['admin', 'member']) }).strict().parse(req.body);
    const p = z.object({ teamId: id, userId: z.string().min(1).max(200) }).parse(req.params);
    return s.team(p.teamId, req.actor!, true, async (tx, member) => {
      if (member?.role !== 'owner' || p.userId === req.actor!.userId) throw new ApiError(403, 'forbidden');
      const target = await first(tx, sql<Member>`select * from team_members where team_id=${p.teamId} and user_id=${p.userId} for update`);
      if (!target?.active) throw new ApiError(404, 'not_found');
      if (target.role === 'owner') throw new ApiError(403, 'forbidden');
      if (target.role !== b.role) await sql`update team_members set role=${b.role} where team_id=${p.teamId} and user_id=${p.userId}`.execute(tx);
      await audit(tx, 'team.role', req.id, req.actor!, p.teamId);
      return ok({ user_id: p.userId, role: b.role });
    });
  });
  app.post('/api/teams/:teamId/members/:userId/remove', async req => {
    empty.parse(req.body);
    const p = z.object({ teamId: id, userId: z.string().min(1).max(200) }).parse(req.params);
    return s.team(p.teamId, req.actor!, true, async (tx, member) => {
      requireAdmin(member);
      if (p.userId === req.actor!.userId) throw new ApiError(403, 'forbidden');
      const target = await first(tx, sql<Member>`select * from team_members where team_id=${p.teamId} and user_id=${p.userId} for update`);
      if (!target?.active) throw new ApiError(404, 'not_found');
      if (target.role === 'owner' || (member?.role === 'admin' && target.role !== 'member')) throw new ApiError(403, 'forbidden');
      await sql`update team_members set active=false,deactivated_at=now() where team_id=${p.teamId} and user_id=${p.userId}`.execute(tx);
      // Lock affected tasks in stable id order, including historical rows retained unchanged.
      await sql`select id from tasks where team_id=${p.teamId} and assignee_id=${p.userId} order by id for update`.execute(tx);
      const unassigned = await rows(tx, sql`update tasks set assignee_id=null,version=version+1,updated_at=now()
        where team_id=${p.teamId} and assignee_id=${p.userId} and status<>'done' and archived_at is null returning id`);
      const invite = await s.resetInvite(tx, p.teamId, req.actor!);
      await audit(tx, 'team.remove', req.id, req.actor!, p.teamId);
      return ok({ user_id: p.userId, unassigned_tasks: unassigned.length, invite_code: invite });
    });
  });
  app.get('/api/teams/:teamId/tasks', async req => {
    const q = z.object({ scope: z.enum(['active', 'archived']).default('active') }).strict().parse(req.query);
    return s.team(teamId(req.params), req.actor!, false, async (tx, member) => ok(!member ? [] : await rows(tx, q.scope === 'active'
      ? sql`select * from tasks where team_id=${teamId(req.params)} and archived_at is null
          order by case when parent_id is null then due_date end,case when parent_id is null then id end,sort_order,id`
      : sql`select * from tasks where team_id=${teamId(req.params)} and archived_at is not null
          order by case when parent_id is null then archived_at end desc,case when parent_id is null then id end desc,sort_order,id`)));
  });
  app.post('/api/teams/:teamId/tasks', async (req, reply) => {
    const b = taskDraft.parse(req.body);
    const data = await s.team(teamId(req.params), req.actor!, true, async tx => {
      await s.assignee(tx, teamId(req.params), b.assignee_id);
      const parentId = b.parent_id ?? null;
      await s.assertParent(tx, teamId(req.params), parentId);
      let status = b.status;
      let progress = b.status === 'todo' ? 0 : b.status === 'done' ? 100 : Math.min(99, Math.max(1, b.progress));
      if (parentId != null) {
        const bin = binaryChild(b.status, b.progress);
        status = bin.status;
        progress = bin.progress;
      }
      const tail = parentId == null ? undefined : await first(tx, sql<{position: number}>`select coalesce(max(sort_order),-1)+1 as position
        from tasks where team_id=${teamId(req.params)} and parent_id=${parentId}`);
      const row = await first(tx, sql`insert into tasks(team_id,created_by,title,description,assignee_id,status,progress,start_date,due_date,parent_id,sort_order)
        values(${teamId(req.params)},${req.actor!.userId},${b.title},${b.description},${b.assignee_id},${status},${progress},${b.start_date},${b.due_date},${parentId},${tail?.position ?? 0}) returning *`);
      if (parentId != null) await s.recomputeParent(tx, teamId(req.params), parentId);
      await audit(tx, 'task.create', req.id, req.actor!, teamId(req.params));
      return row;
    });
    return reply.code(201).send(ok(data));
  });
  app.get('/api/tasks/:taskId', async req => s.task(resourceId(req.params, 'taskId'), req.actor!, false, async (_tx, row) => ok(row ?? null)));
  app.patch('/api/tasks/:taskId/children/reorder', async req => {
    const b = taskReorder.parse(req.body);
    return s.task(resourceId(req.params, 'taskId'), req.actor!, true, async (tx, parent) => {
      if (!parent) throw new ApiError(404, 'not_found');
      if (parent.parent_id != null || parent.archived_at) throw new ApiError(400, 'invalid');
      const kids = await rows(tx, sql<Task>`select * from tasks where team_id=${parent.team_id}
        and parent_id=${parent.id} and archived_at is null order by sort_order,id for update`);
      const byId = new Map(kids.map(child => [Number(child.id), child]));
      // Foreign/archived rows are never moved; a changed sibling set is a conflict.
      if (b.children.some(child => !byId.has(child.id))) throw new ApiError(400, 'invalid');
      if (b.children.length !== kids.length) throw new ApiError(409, 'conflict');
      for (const child of b.children) checkVersion(byId.get(child.id)!, child.expected_version);
      const positions = b.children.map((child, index) => sql`(${child.id}::bigint,${index}::integer)`);
      await sql`update tasks t set sort_order=v.position,version=t.version+1,updated_at=now()
        from (values ${sql.join(positions)}) as v(id,position) where t.id=v.id and t.team_id=${parent.team_id}`.execute(tx);
      await audit(tx, 'task.reorder', req.id, req.actor!, parent.team_id);
      return ok(await rows(tx, sql`select * from tasks where team_id=${parent.team_id}
        and parent_id=${parent.id} and archived_at is null order by sort_order,id`));
    });
  });
  app.put('/api/tasks/:taskId', async req => {
    const b = taskUpdate.parse(req.body);
    return s.task(resourceId(req.params, 'taskId'), req.actor!, true, async (tx, row) => {
      if (!row) throw new ApiError(404, 'not_found');
      checkVersion(row, b.expected_version);
      if (row.archived_at) throw new ApiError(400, 'invalid');
      await s.assignee(tx, row.team_id, b.assignee_id);
      const childCount = await s.activeChildCount(tx, row.team_id, row.id);
      let status = b.status;
      let progress = b.status === 'todo' ? 0 : b.status === 'done' ? 100 : Math.min(99, Math.max(1, b.progress));
      if (childCount > 0) {
        const kids = await rows(tx, sql<{status: string; progress: number}>`select status, progress from tasks
          where team_id=${row.team_id} and parent_id=${row.id} and archived_at is null order by sort_order,id`);
        const derived = progressFromChildren(kids);
        if (!derived) throw new ApiError(400, 'invalid');
        // Contract: parent status/progress are read-only — reject overrides.
        if (parentStatusOverrideAttempt(b, derived)) throw new ApiError(400, 'invalid');
        status = derived.status;
        progress = derived.progress;
      } else if (row.parent_id) {
        // Child completion only via PATCH /complete; PUT keeps (and converges) binary state.
        const bin = binaryChild(String(row.status ?? 'todo'), Number(row.progress ?? 0));
        status = bin.status;
        progress = bin.progress;
      }
      const updated = await first(tx, sql`update tasks set title=${b.title},description=${b.description},assignee_id=${b.assignee_id},status=${status},progress=${progress},start_date=${b.start_date},due_date=${b.due_date},version=version+1,updated_at=now() where id=${row.id} returning *`);
      if (row.parent_id) await s.recomputeParent(tx, row.team_id, row.parent_id);
      await audit(tx, 'task.update', req.id, req.actor!, row.team_id);
      return ok(updated);
    });
  });
  app.patch('/api/tasks/:taskId/complete', async req => {
    const b = z.object({ done: z.boolean(), expected_version: version }).strict().parse(req.body);
    return s.task(resourceId(req.params, 'taskId'), req.actor!, true, async (tx, row) => {
      if (!row) throw new ApiError(404, 'not_found');
      checkVersion(row, b.expected_version);
      if (row.archived_at) throw new ApiError(400, 'invalid');
      if (await s.activeChildCount(tx, row.team_id, row.id) > 0) throw new ApiError(400, 'invalid'); // parents not toggled
      const status = b.done ? 'done' : 'todo';
      const progress = b.done ? 100 : 0;
      const updated = await first(tx, sql`update tasks set status=${status},progress=${progress},version=version+1,updated_at=now() where id=${row.id} returning *`);
      if (row.parent_id) await s.recomputeParent(tx, row.team_id, row.parent_id);
      await audit(tx, 'task.complete', req.id, req.actor!, row.team_id);
      return ok(updated);
    });
  });
  app.patch('/api/tasks/:taskId/archive', async req => {
    const b = z.object({ archived: z.boolean(), expected_version: version }).strict().parse(req.body);
    return s.task(resourceId(req.params, 'taskId'), req.actor!, true, async (tx, row) => {
      if (!row) throw new ApiError(404, 'not_found');
      checkVersion(row, b.expected_version);
      if (b.archived && await s.activeChildCount(tx, row.team_id, row.id) > 0) throw new ApiError(400, 'invalid');
      const updated = await first(tx, sql`update tasks set archived_at=${b.archived ? new Date() : null},version=version+1,updated_at=now(),
        assignee_id=case when ${!b.archived} and not exists(select 1 from team_members m where m.team_id=tasks.team_id and m.user_id=tasks.assignee_id and m.active) then null else assignee_id end where id=${row.id} returning *`);
      if (row.parent_id) await s.recomputeParent(tx, row.team_id, row.parent_id);
      await audit(tx, 'task.archive', req.id, req.actor!, row.team_id);
      return ok(updated);
    });
  });
  app.get('/api/teams/:teamId/tasks/:taskId/logs', async req => {
    const p = z.object({ teamId: id, taskId: id }).parse(req.params);
    return s.team(p.teamId, req.actor!, false, async (tx, member) => ok(!member ? [] : await rows(tx, sql`select id,owner_id,owner_name,work_date,done_today,version from work_logs
      where team_id=${p.teamId} and related_task_id=${p.taskId} order by work_date desc,id desc`)));
  });
  app.get('/api/teams/:teamId/work-logs', async req => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(300).default(300), owner_id: z.literal('me').optional(), work_date: date.optional() }).strict().refine(v => !!v.owner_id === !!v.work_date).parse(req.query);
    return s.team(teamId(req.params), req.actor!, false, async (tx, member) => {
      if (q.owner_id) return ok(!member ? null : (await first(tx, sql`select * from work_logs where team_id=${teamId(req.params)} and owner_id=${req.actor!.userId} and work_date=${q.work_date}`)) ?? null);
      return ok(!member ? [] : await rows(tx, sql`select * from work_logs where team_id=${teamId(req.params)} order by work_date desc,updated_at desc,id desc limit ${q.limit}`));
    });
  });
  app.post('/api/teams/:teamId/work-logs', async (req, reply) => {
    const b = logDraft.parse(req.body);
    const data = await s.team(teamId(req.params), req.actor!, true, async tx => {
      await s.related(tx, teamId(req.params), b.related_task_id);
      const row = await first(tx, sql`insert into work_logs(team_id,owner_id,owner_name,work_date,done_today,problems,plan_tomorrow,hours,related_task_id)
        values(${teamId(req.params)},${req.actor!.userId},${b.owner_name},${b.work_date},${b.done_today},${b.problems},${b.plan_tomorrow},${b.hours},${b.related_task_id}) returning *`);
      await audit(tx, 'log.create', req.id, req.actor!, teamId(req.params));
      return row;
    });
    return reply.code(201).send(ok(data));
  });
  app.put('/api/work-logs/:logId', async req => {
    const b = logUpdate.parse(req.body);
    return s.log(resourceId(req.params, 'logId'), req.actor!, async (tx, row) => {
      checkVersion(row, b.expected_version);
      await s.related(tx, row.team_id, b.related_task_id, row.related_task_id);
      const updated = await first(tx, sql`update work_logs set work_date=${b.work_date},done_today=${b.done_today},problems=${b.problems},plan_tomorrow=${b.plan_tomorrow},hours=${b.hours},related_task_id=${b.related_task_id},version=version+1,updated_at=now() where id=${row.id} returning *`);
      await audit(tx, 'log.update', req.id, req.actor!, row.team_id);
      return ok(updated);
    });
  });
  app.delete('/api/work-logs/:logId', async req => {
    const b = z.object({ expected_version: version }).strict().parse(req.body);
    return s.log(resourceId(req.params, 'logId'), req.actor!, async (tx, row) => {
      checkVersion(row, b.expected_version);
      await sql`delete from work_logs where id=${row.id}`.execute(tx);
      await audit(tx, 'log.delete', req.id, req.actor!, row.team_id);
      return ok({ id: row.id });
    });
  });
}
