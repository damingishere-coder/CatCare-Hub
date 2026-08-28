FROM postgres:16-alpine

COPY deploy/synology/postgres/01-init-catcare.sh /docker-entrypoint-initdb.d/01-init-catcare.sh
RUN chmod 0555 /docker-entrypoint-initdb.d/01-init-catcare.sh
