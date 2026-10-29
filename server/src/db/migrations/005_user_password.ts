import { sql, type Kysely } from 'kysely';

/** Optional password login: store Argon2id hash only; never plaintext. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
ALTER TABLE public.users
  ADD COLUMN password_hash text,
  ADD COLUMN password_updated_at timestamptz;

ALTER TABLE public.users
  ADD CONSTRAINT users_password_hash_check
    CHECK (password_hash IS NULL OR password_hash ~ '^\\$argon2id\\$v=19\\$m=19456,t=2,p=1\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}$');
`).execute(db);
}
