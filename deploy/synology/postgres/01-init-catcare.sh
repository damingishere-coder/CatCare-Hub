#!/bin/sh
set -eu

APP_PASSWORD_FILE=/run/secrets/postgres_app_password
if [ ! -s "$APP_PASSWORD_FILE" ]; then
  echo "PostgreSQL 应用 Secret 文件缺失或为空" >&2
  exit 1
fi

APP_PASSWORD="$(tr -d '\r\n' < "$APP_PASSWORD_FILE")"
psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=app_password="$APP_PASSWORD" <<'SQL'
CREATE ROLE catcare_relay
  LOGIN
  PASSWORD :'app_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT;
CREATE DATABASE catcare_relay OWNER catcare_relay;
SQL
