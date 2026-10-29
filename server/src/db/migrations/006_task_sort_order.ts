import { sql, type Kysely } from 'kysely';

/** Preserve legacy sibling id order; roots retain their existing due-date ordering. */
export async function up<DB>(db: Kysely<DB>): Promise<void> {
  await sql.raw(`
ALTER TABLE public.tasks ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
WITH ranked AS (
  SELECT id, (row_number() OVER (PARTITION BY team_id, parent_id ORDER BY id) - 1)::integer AS position
  FROM public.tasks WHERE parent_id IS NOT NULL
)
UPDATE public.tasks SET sort_order=ranked.position FROM ranked WHERE tasks.id=ranked.id;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_sort_order_check CHECK (sort_order >= 0);
CREATE INDEX tasks_sibling_order_idx ON public.tasks(team_id, parent_id, sort_order, id);
`).execute(db);
}
