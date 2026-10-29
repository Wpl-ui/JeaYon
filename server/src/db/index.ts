import { Kysely, PostgresDialect, type RawBuilder, type Transaction } from 'kysely';
import pg from 'pg';
// PostgreSQL date is a calendar value, not a local-midnight JavaScript Date.
pg.types.setTypeParser(1082, value => value);
export type Database = Kysely<Record<string, never>>;
export type Connection = Database | Transaction<Record<string, never>>;
export function createDb(url: string) {
  return new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool: new pg.Pool({
    connectionString: url, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000,
    application_name: 'daily-work-api',
  }) }) });
}
export async function rows<T>(db: Connection, query: RawBuilder<T>): Promise<T[]> { return (await query.execute(db)).rows; }
export async function first<T>(db: Connection, query: RawBuilder<T>): Promise<T | undefined> { return (await rows(db, query))[0]; }
