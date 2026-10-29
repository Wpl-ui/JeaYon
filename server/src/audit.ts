import { sql } from 'kysely';
import type { Connection } from './db/index.js';
export async function audit(tx: Connection, action: string, requestId: string, actor?: { userId: string; sessionId: string }, teamId?: number | string, outcome: 'success' | 'denied' | 'failure' = 'success') {
  await sql`insert into audit_events(action,request_id,actor_user_id,session_id,team_id,outcome)
    values(${action},${requestId},${actor?.userId ?? null},${actor?.sessionId ?? null},${teamId ?? null},${outcome})`.execute(tx);
}
