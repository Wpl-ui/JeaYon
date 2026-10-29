import { sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { Database } from './index.js';
import * as auth from './migrations/001_auth.js';
import * as business from './migrations/002_business.js';
import * as indexes from './migrations/003_task_indexes.js';
import * as parent from './migrations/004_task_parent.js';
import * as password from './migrations/005_user_password.js';
import * as taskOrder from './migrations/006_task_sort_order.js';
import * as signupReauth from './migrations/007_password_signup_reauth.js';
export const latestMigration = '007_password_signup_reauth';
export function migrator(db: Database) {
  return new Migrator({
    db,
    provider: {
      async getMigrations() {
        return {
          '001_auth': auth,
          '002_business': business,
          '003_task_indexes': indexes,
          '004_task_parent': parent,
          '005_user_password': password,
          '006_task_sort_order': taskOrder,
          '007_password_signup_reauth': signupReauth,
        };
      },
    },
  });
}
export async function migrate(db: Database) {
  const result = await migrator(db).migrateToLatest();
  if (result.error) throw result.error;
  return result.results ?? [];
}
export async function ready(db: Database): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    const r = await sql<{name: string}>`select name from kysely_migration order by name desc limit 1`.execute(db);
    return r.rows[0]?.name === latestMigration;
  } catch { return false; }
}
