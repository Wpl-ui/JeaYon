import { sql, type Kysely } from 'kysely';
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE INDEX tasks_team_due_idx ON public.tasks(team_id,due_date)`.execute(db);
  await sql`CREATE INDEX tasks_team_status_idx ON public.tasks(team_id,status)`.execute(db);
}
