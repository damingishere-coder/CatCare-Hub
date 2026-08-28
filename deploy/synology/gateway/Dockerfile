FROM nginx:stable-alpine

COPY deploy/synology/gateway/nginx.conf /etc/nginx/nginx.conf
COPY deploy/synology/gateway/security-headers.conf /etc/nginx/security-headers.conf
COPY frontend/dist-public /usr/share/nginx/html

RUN chown -R nginx:nginx /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=8 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
