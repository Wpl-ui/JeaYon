-- Run after every successful migration as the bootstrap owner or migrator.
-- No DDL, ownership, superuser, BYPASSRLS, or role membership for the API role.
GRANT USAGE ON SCHEMA public TO dwa_api, dwa_backup;
GRANT SELECT, INSERT, UPDATE ON
  users, identities, otp_codes, sessions, session_refresh_tokens, password_reauth, auth_rate_limits,
  teams, team_members, team_invites, tasks, work_logs TO dwa_api;
GRANT DELETE ON work_logs TO dwa_api;
GRANT INSERT ON audit_events TO dwa_api;
GRANT SELECT ON kysely_migration TO dwa_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dwa_api;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dwa_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO dwa_backup;
