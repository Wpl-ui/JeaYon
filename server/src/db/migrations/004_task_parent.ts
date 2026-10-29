import { sql, type Kysely } from 'kysely';

/** One-level parent/child tasks: parent progress is derived from active children. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
ALTER TABLE public.tasks
  ADD COLUMN parent_id bigint;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_parent_self_check
    CHECK (parent_id IS NULL OR parent_id <> id);

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_team_parent_fk
    FOREIGN KEY (team_id, parent_id)
    REFERENCES public.tasks (team_id, id);

CREATE INDEX tasks_team_parent_idx ON public.tasks (team_id, parent_id);
`).execute(db);
}
