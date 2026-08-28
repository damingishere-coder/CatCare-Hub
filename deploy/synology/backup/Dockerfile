FROM postgres:16-alpine

COPY deploy/synology/backup/backup.sh /usr/local/bin/catcare-backup
RUN chmod 0555 /usr/local/bin/catcare-backup

ENTRYPOINT ["/usr/local/bin/catcare-backup"]
