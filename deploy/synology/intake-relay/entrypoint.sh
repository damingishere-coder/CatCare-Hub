#!/bin/sh
set -eu

POSTGRES_PASSWORD_FILE=/run/secrets/postgres_app_password
RELAY_KEY_FILE=/run/secrets/relay_key

if [ ! -s "$POSTGRES_PASSWORD_FILE" ] || [ ! -s "$RELAY_KEY_FILE" ]; then
  echo "CatCare relay Secret 文件缺失或为空" >&2
  exit 1
fi

CATCARE_DATABASE_URL="$(python - "$POSTGRES_PASSWORD_FILE" <<'PY'
import pathlib
import sys
import urllib.parse

password = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").strip()
if not password:
    raise SystemExit("PostgreSQL 应用 Secret 为空")
encoded = urllib.parse.quote(password, safe="")
print(f"postgresql+psycopg://catcare_relay:{encoded}@postgres:5432/catcare_relay")
PY
)"

CATCARE_INTAKE_RELAY_KEY="$(tr -d '\r\n' < "$RELAY_KEY_FILE")"
if [ -z "$CATCARE_INTAKE_RELAY_KEY" ]; then
  echo "CatCare relay 管理 Secret 为空" >&2
  exit 1
fi

export CATCARE_DATABASE_URL CATCARE_INTAKE_RELAY_KEY
exec python -m app.relay_runtime
