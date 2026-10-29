import { sql, type Kysely } from 'kysely';

export async function up<DB>(db: Kysely<DB>): Promise<void> {
  await sql.raw(`
ALTER TABLE otp_codes DROP CONSTRAINT otp_codes_purpose_check;
ALTER TABLE otp_codes DROP CONSTRAINT otp_codes_check1;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check CHECK(purpose IN ('login','register','password_change','link','reauth'));
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_binding_check CHECK(
 (purpose IN ('login','register') AND bound_user_id IS NULL AND bound_session_id IS NULL) OR
 (purpose IN ('password_change','link','reauth') AND bound_user_id IS NOT NULL AND bound_session_id IS NOT NULL));
CREATE TABLE password_reauth (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL REFERENCES users(id),
 session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, CHECK(expires_at > created_at)
);
CREATE INDEX password_reauth_user_idx ON password_reauth(user_id);
CREATE INDEX password_reauth_expiry_idx ON password_reauth(expires_at);
`).execute(db);
}
