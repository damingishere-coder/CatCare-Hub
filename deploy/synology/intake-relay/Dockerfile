FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    CATCARE_INTAKE_RELAY_SERVER=1 \
    CATCARE_RELAY_BACKGROUND_CLEANUP=1 \
    CATCARE_RELAY_AUTO_MIGRATE=1

WORKDIR /app/backend

COPY deploy/synology/intake-relay/requirements.lock ./requirements.lock
COPY --from=relay_wheels . /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels --requirement requirements.lock \
    && rm -rf /wheels \
    && useradd --create-home --uid 10001 catcare

COPY backend/alembic.ini ./alembic.ini
COPY backend/app ./app
COPY backend/migrations ./migrations
COPY deploy/synology/intake-relay/entrypoint.sh /usr/local/bin/catcare-relay-entrypoint

RUN chmod 0555 /usr/local/bin/catcare-relay-entrypoint

USER catcare
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/catcare-relay-entrypoint"]
