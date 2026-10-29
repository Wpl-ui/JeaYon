#!/usr/bin/env bash
# Only executed by the official PostgreSQL entrypoint for a new, empty volume.
set -euo pipefail
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv db_name POSTGRES_DB
\getenv migrator_password MIGRATOR_PASSWORD
\getenv api_password API_DB_PASSWORD
\getenv backup_password BACKUP_DB_PASSWORD
CREATE ROLE dwa_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_password';
CREATE ROLE dwa_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'api_password';
CREATE ROLE dwa_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'backup_password';
ALTER DATABASE :"db_name" OWNER TO dwa_migrator;
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO dwa_api, dwa_backup;
ALTER SCHEMA public OWNER TO dwa_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dwa_api, dwa_backup;
SQL
