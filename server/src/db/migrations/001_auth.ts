import { sql, type Kysely } from 'kysely';
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`
CREATE TABLE users (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, name text,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','unclaimed','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 40)
);
CREATE TABLE identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK (kind IN ('email','phone')), identifier_normalized text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,identifier_normalized), UNIQUE(user_id,kind),
 CHECK (kind <> 'phone' OR identifier_normalized ~ '^\\+861[0-9]{10}$')
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 auth_time timestamptz NOT NULL DEFAULT now(), absolute_expires_at timestamptz NOT NULL,
 idle_expires_at timestamptz NOT NULL, revoked_at timestamptz, revoke_reason text,
 created_ip_hash bytea NOT NULL, user_agent_hash bytea,
 CHECK(absolute_expires_at > created_at AND idle_expires_at > created_at)
);
CREATE INDEX sessions_user_revoked_idx ON sessions(user_id,revoked_at);
CREATE INDEX sessions_absolute_idx ON sessions(absolute_expires_at);
CREATE INDEX sessions_idle_idx ON sessions(idle_expires_at);
CREATE TABLE otp_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), channel text NOT NULL CHECK(channel IN ('email','phone')),
 target_normalized text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('login','link','reauth')),
 bound_user_id text REFERENCES users(id), bound_session_id uuid REFERENCES sessions(id),
 code_hmac bytea NOT NULL CHECK(octet_length(code_hmac)=32), key_version smallint NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','sent','consumed','superseded','failed')),
 attempts smallint NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 sent_at timestamptz, consumed_at timestamptz, request_ip_hash bytea NOT NULL, provider_request_id text,
 CHECK(expires_at > created_at),
 CHECK((purpose='login' AND bound_user_id IS NULL AND bound_session_id IS NULL) OR
       (purpose IN ('link','reauth') AND bound_user_id IS NOT NULL AND bound_session_id IS NOT NULL))
);
CREATE INDEX otp_expiry_idx ON otp_codes(expires_at);
CREATE INDEX otp_target_idx ON otp_codes(channel,target_normalized,purpose,created_at DESC);
CREATE UNIQUE INDEX otp_active_target_key ON otp_codes(channel,target_normalized,purpose) WHERE state IN ('pending','sent');
CREATE TABLE session_refresh_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES sessions(id),
 token_hash bytea NOT NULL UNIQUE CHECK(octet_length(token_hash)=32), created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, used_at timestamptz, replaced_by uuid REFERENCES session_refresh_tokens(id)
);
CREATE UNIQUE INDEX refresh_current_key ON session_refresh_tokens(session_id) WHERE used_at IS NULL;
CREATE INDEX refresh_session_idx ON session_refresh_tokens(session_id);
CREATE INDEX refresh_expiry_idx ON session_refresh_tokens(expires_at);
CREATE TABLE auth_rate_limits (
 scope text NOT NULL, key_hash bytea NOT NULL, window_start timestamptz NOT NULL,
 window_seconds integer NOT NULL CHECK(window_seconds>0), count integer NOT NULL CHECK(count>=0), expires_at timestamptz NOT NULL,
 PRIMARY KEY(scope,key_hash,window_start,window_seconds)
);
CREATE INDEX rate_expiry_idx ON auth_rate_limits(expires_at);
`).execute(db);
}
