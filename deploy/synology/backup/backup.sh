#!/bin/sh
set -eu

PASSWORD_FILE=/run/secrets/postgres_app_password
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"

if [ ! -s "$PASSWORD_FILE" ]; then
  echo "备份服务的 PostgreSQL Secret 文件缺失或为空" >&2
  exit 1
fi

export PGPASSWORD
PGPASSWORD="$(tr -d '\r\n' < "$PASSWORD_FILE")"
umask 077

until pg_isready \
  --host "$POSTGRES_HOST" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 2
done

while true; do
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  final_path="/backups/catcare-relay-${timestamp}.dump"
  temp_path="${final_path}.tmp"

  pg_dump \
    --host "$POSTGRES_HOST" \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file "$temp_path"
  mv "$temp_path" "$final_path"

  find /backups \
    -maxdepth 1 \
    -type f \
    -name 'catcare-relay-*.dump' \
    -mtime "+$((RETENTION_DAYS - 1))" \
    -delete

  sleep "$INTERVAL_SECONDS"
done
