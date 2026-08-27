FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    CATCARE_INTAKE_RELAY_SERVER=1 \
    CATCARE_RELAY_BACKGROUND_CLEANUP=1 \
    CATCARE_RELAY_AUTO_MIGRATE=1

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt \
    && useradd --create-home --uid 10001 catcare

COPY backend/alembic.ini ./alembic.ini
COPY backend/app ./app
COPY backend/migrations ./migrations

USER catcare
EXPOSE 8080

CMD ["python", "-m", "app.relay_runtime"]
