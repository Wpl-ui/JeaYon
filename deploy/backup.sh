#!/usr/bin/env bash
# Use PostgreSQL 16 pg_dump/pg_restore on a trusted host, with PG* env and a 0600 PGPASSFILE.
set -euo pipefail
umask 077
: "${PGHOST:?PGHOST required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${PGUSER:?PGUSER required}"
: "${BACKUP_DIR:?BACKUP_DIR required}"
RETENTION_DAYS=${RETENTION_DAYS:-7}
[[ "$BACKUP_DIR" == /* && "$BACKUP_DIR" != / && "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid backup directory or retention' >&2; exit 1; }
[[ $(pg_dump --version) =~ \ 16\. ]] || { echo 'PostgreSQL 16 client required' >&2; exit 1; }
mkdir -p -- "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.daily-work-backup.lock"
flock -n 9 || { echo 'Backup already running' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
output="$BACKUP_DIR/dwa-$stamp.dump"
[[ ! -e "$output" && ! -e "$output.partial" ]] || { echo 'Backup name collision' >&2; exit 1; }
started=$SECONDS
# A failed dump remains .partial for inspection and is never counted as a valid backup.
pg_dump --format=custom --no-owner --no-privileges --file="$output.partial"
pg_restore --list "$output.partial" > /dev/null
mv -- "$output.partial" "$output"
(cd "$BACKUP_DIR" && sha256sum "dwa-$stamp.dump" > "dwa-$stamp.dump.sha256")
if [[ -n "${BACKUP_UPLOAD_HOOK:-}" ]]; then
    [[ "$BACKUP_UPLOAD_HOOK" == /* && -x "$BACKUP_UPLOAD_HOOK" ]] || { echo 'Invalid upload hook' >&2; exit 1; }
    # Hook must encrypt, upload AND verify before returning success; no cloud calls by default.
    "$BACKUP_UPLOAD_HOOK" "$output" "$output.sha256"
fi
# Retain only this script's strictly named completed artifacts; never touch unrelated files.
find "$BACKUP_DIR" -regextype posix-extended -maxdepth 1 -type f \
  -regex '.*/dwa-[0-9]{8}T[0-9]{6}Z\.dump(\.sha256)?' -mmin "+$((RETENTION_DAYS * 1440))" -delete
printf 'Backup verified: %s bytes, %ss elapsed\n' "$(wc -c < "$output")" "$((SECONDS - started))"
