import { sql } from 'kysely';
import { loadConfig } from './config.js';
import { createDb, first } from './db/index.js';
import { BusinessService } from './business.js';
const c = loadConfig(process.env);
if (c.NODE_ENV !== 'development') throw new Error('Seed requires NODE_ENV=development');
const db = createDb(c.DATABASE_URL);
try {
  const result = await db.transaction().execute(async tx => {
    await sql`select pg_advisory_xact_lock(hashtextextended('daily-work-demo-seed',0))`.execute(tx);
    const existing = await first(tx, sql<{id: string}>`select id from teams where name='Demo team'`);
    if (existing) return 'Demo team already exists; unchanged';
    const user = await first(tx, sql<{id: string}>`insert into users(name) values('Demo owner') returning id`);
    if (!user) throw new Error('Seed user insert failed');
    await sql`insert into identities(user_id,kind,identifier_normalized) values(${user.id},'email','demo@example.test')`.execute(tx);
    const team = await first(tx, sql<{id: string}>`insert into teams(name,created_by) values('Demo team',${user.id}) returning id`);
    if (!team) throw new Error('Seed team insert failed');
    await sql`insert into team_members(team_id,user_id,role,display_name) values(${team.id},${user.id},'owner','Demo owner')`.execute(tx);
    await new BusinessService(db).invite(tx, team.id, { userId: user.id, sessionId: '', expiresAt: 0 });
    await sql`insert into tasks(team_id,created_by,title,start_date,due_date) values(${team.id},${user.id},'First task',current_date,current_date)`.execute(tx);
    return 'Demo created; development console OTP login: demo@example.test';
  });
  console.log(result);
} finally { await db.destroy(); }
