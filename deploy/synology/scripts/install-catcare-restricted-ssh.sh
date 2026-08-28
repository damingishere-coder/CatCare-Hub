#!/bin/sh
# catcare-nas-automation
set -eu

MARKER="catcare-nas-automation"
PROJECT_DIR="/volume3/docker/CatCare"
PUBLIC_KEY_FILE="$PROJECT_DIR/catcare-automation.pub"
DOCKER_BIN="/var/packages/ContainerManager/target/usr/bin/docker"
COMPOSE_FILE="$PROJECT_DIR/compose.yaml"
CONTROL_BIN="/usr/local/sbin/catcarectl"
GATEWAY_BIN="/usr/local/bin/catcare-ssh-gateway"
SUDOERS_FILE="/etc/sudoers.d/catcare-automation"

fail() {
  printf '%s\n' "安装失败：$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "请使用 sudo 运行此脚本"

TARGET_USER="${SUDO_USER:-}"
[ -n "$TARGET_USER" ] || fail "无法确认授权用户"
[ "$TARGET_USER" != "root" ] || fail "禁止为 root 用户安装"
[ -x "$DOCKER_BIN" ] || fail "未找到 Container Manager 的 Docker 命令"
[ -f "$COMPOSE_FILE" ] || fail "未找到 CatCare compose.yaml"

HOME_DIR="$(awk -F: -v user="$TARGET_USER" '$1 == user { print $6; exit }' /etc/passwd)"
[ -n "$HOME_DIR" ] || fail "无法确认授权用户的主目录"

for path in "$CONTROL_BIN" "$GATEWAY_BIN" "$SUDOERS_FILE"; do
  if [ -e "$path" ] && ! grep -q "$MARKER" "$path" 2>/dev/null; then
    fail "$path 已存在且不是 CatCare 管理文件，未覆盖"
  fi
done

TMP_DIR="$(mktemp -d /tmp/catcare-ssh.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

cat >"$TMP_DIR/catcarectl" <<'CONTROL_EOF'
#!/bin/sh
# catcare-nas-automation
set -eu

DOCKER_BIN="/var/packages/ContainerManager/target/usr/bin/docker"
PROJECT_DIR="/volume3/docker/CatCare"
COMPOSE_FILE="$PROJECT_DIR/compose.yaml"
BACKUP_DIR="$PROJECT_DIR/backups"
UPDATE_DIR="$PROJECT_DIR/incoming"
GATEWAY_ARCHIVE="$UPDATE_DIR/catcare-intake-gateway.tar"
GATEWAY_HASH="$UPDATE_DIR/catcare-intake-gateway.tar.sha256"
GATEWAY_IMAGE="catcare/intake-gateway:2026.08.27"
PUBLIC_ARCHIVE="$UPDATE_DIR/catcare-public-images.tar"
PUBLIC_HASH="$UPDATE_DIR/catcare-public-images.tar.sha256"
RELAY_IMAGE="catcare/intake-relay:2026.08.27"

[ "$#" -eq 1 ] || {
  echo "拒绝：只接受一个固定子命令" >&2
  exit 126
}

gateway_health() {
  /usr/bin/curl --fail --silent --show-error --max-time 10 \
    http://127.0.0.1:18080/api/health >/dev/null \
    && /usr/bin/curl --fail --silent --show-error --max-time 10 \
      http://127.0.0.1:18080/api/ready >/dev/null
}

wait_for_gateway() {
  attempt=0
  while [ "$attempt" -lt 24 ]; do
    if gateway_health; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 3
  done
  return 1
}

case "$1" in
  status)
    exec "$DOCKER_BIN" compose -f "$COMPOSE_FILE" ps
    ;;
  health)
    /usr/bin/curl --fail --silent --show-error --max-time 10 \
      http://127.0.0.1:18080/api/health
    printf '\n'
    /usr/bin/curl --fail --silent --show-error --max-time 10 \
      http://127.0.0.1:18080/api/ready
    printf '\n'
    ;;
  restart)
    exec "$DOCKER_BIN" compose -f "$COMPOSE_FILE" restart
    ;;
  logs)
    exec "$DOCKER_BIN" compose -f "$COMPOSE_FILE" logs --tail=200 --no-color
    ;;
  backup)
    "$DOCKER_BIN" compose -f "$COMPOSE_FILE" restart backup
    sleep 8
    latest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'catcare-relay-*.dump' -print | sort | tail -n 1)"
    [ -n "$latest" ] || {
      echo "备份容器已启动，但尚未找到备份文件" >&2
      exit 1
    }
    ls -l "$latest"
    ;;
  gateway-update)
    [ -f "$GATEWAY_ARCHIVE" ] || {
      echo "更新失败：缺少固定 Gateway 镜像包" >&2
      exit 1
    }
    [ -f "$GATEWAY_HASH" ] || {
      echo "更新失败：缺少 Gateway SHA-256 文件" >&2
      exit 1
    }
    expected="$(awk 'NR == 1 { print $1 }' "$GATEWAY_HASH")"
    case "$expected" in
      *[!0-9a-fA-F]*|'')
        echo "更新失败：SHA-256 文件格式错误" >&2
        exit 1
        ;;
    esac
    [ "${#expected}" -eq 64 ] || {
      echo "更新失败：SHA-256 长度错误" >&2
      exit 1
    }
    actual="$(/usr/bin/sha256sum "$GATEWAY_ARCHIVE" | awk '{ print $1 }')"
    [ "$actual" = "$expected" ] || {
      echo "更新失败：Gateway 镜像校验不一致" >&2
      exit 1
    }

    old_image_id="$("$DOCKER_BIN" image inspect --format '{{.Id}}' "$GATEWAY_IMAGE")"
    [ -n "$old_image_id" ] || {
      echo "更新失败：无法记录当前 Gateway 镜像" >&2
      exit 1
    }

    "$DOCKER_BIN" load --input "$GATEWAY_ARCHIVE"
    new_image_id="$("$DOCKER_BIN" image inspect --format '{{.Id}}' "$GATEWAY_IMAGE")"
    [ -n "$new_image_id" ] || {
      echo "更新失败：镜像包未提供固定 Gateway 标签" >&2
      "$DOCKER_BIN" image tag "$old_image_id" "$GATEWAY_IMAGE"
      exit 1
    }

    if "$DOCKER_BIN" compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate gateway \
      && wait_for_gateway; then
      echo "Gateway 更新成功"
      echo "旧镜像：$old_image_id"
      echo "新镜像：$new_image_id"
      exit 0
    fi

    echo "Gateway 新版本健康检查失败，正在自动回滚" >&2
    "$DOCKER_BIN" image tag "$old_image_id" "$GATEWAY_IMAGE"
    "$DOCKER_BIN" compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate gateway
    if wait_for_gateway; then
      echo "已回滚到旧 Gateway 镜像" >&2
    else
      echo "严重：回滚后 Gateway 仍未恢复，请保留现场并人工检查" >&2
    fi
    exit 1
    ;;
  public-update)
    [ -f "$PUBLIC_ARCHIVE" ] || {
      echo "更新失败：缺少固定公网镜像包" >&2
      exit 1
    }
    [ -f "$PUBLIC_HASH" ] || {
      echo "更新失败：缺少公网镜像 SHA-256 文件" >&2
      exit 1
    }
    expected="$(awk 'NR == 1 { print $1 }' "$PUBLIC_HASH")"
    case "$expected" in
      *[!0-9a-fA-F]*|'')
        echo "更新失败：SHA-256 文件格式错误" >&2
        exit 1
        ;;
    esac
    [ "${#expected}" -eq 64 ] || {
      echo "更新失败：SHA-256 长度错误" >&2
      exit 1
    }
    actual="$(/usr/bin/sha256sum "$PUBLIC_ARCHIVE" | awk '{ print $1 }')"
    [ "$actual" = "$expected" ] || {
      echo "更新失败：公网镜像校验不一致" >&2
      exit 1
    }

    old_relay_id="$("$DOCKER_BIN" image inspect --format '{{.Id}}' "$RELAY_IMAGE")"
    old_gateway_id="$("$DOCKER_BIN" image inspect --format '{{.Id}}' "$GATEWAY_IMAGE")"
    [ -n "$old_relay_id" ] && [ -n "$old_gateway_id" ] || {
      echo "更新失败：无法记录当前 Relay/Gateway 镜像" >&2
      exit 1
    }

    if ! "$DOCKER_BIN" load --input "$PUBLIC_ARCHIVE"; then
      "$DOCKER_BIN" image tag "$old_relay_id" "$RELAY_IMAGE"
      "$DOCKER_BIN" image tag "$old_gateway_id" "$GATEWAY_IMAGE"
      echo "更新失败：无法加载公网镜像包，已恢复原标签" >&2
      exit 1
    fi
    new_relay_id="$("$DOCKER_BIN" image inspect --format '{{.Id}}' "$RELAY_IMAGE")"
    new_gateway_id="$("$DOCKER_BIN" image inspect --format '{{.Id}}' "$GATEWAY_IMAGE")"
    if [ -z "$new_relay_id" ] || [ -z "$new_gateway_id" ]; then
      "$DOCKER_BIN" image tag "$old_relay_id" "$RELAY_IMAGE"
      "$DOCKER_BIN" image tag "$old_gateway_id" "$GATEWAY_IMAGE"
      echo "更新失败：镜像包未提供固定 Relay/Gateway 标签" >&2
      exit 1
    fi

    if "$DOCKER_BIN" compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate relay gateway \
      && wait_for_gateway; then
      echo "Relay/Gateway 更新成功"
      echo "Relay 旧镜像：$old_relay_id"
      echo "Relay 新镜像：$new_relay_id"
      echo "Gateway 旧镜像：$old_gateway_id"
      echo "Gateway 新镜像：$new_gateway_id"
      exit 0
    fi

    echo "公网新版本健康检查失败，正在自动回滚 Relay/Gateway" >&2
    "$DOCKER_BIN" image tag "$old_relay_id" "$RELAY_IMAGE"
    "$DOCKER_BIN" image tag "$old_gateway_id" "$GATEWAY_IMAGE"
    "$DOCKER_BIN" compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate relay gateway
    if wait_for_gateway; then
      echo "已回滚到旧 Relay/Gateway 镜像" >&2
    else
      echo "严重：回滚后公网入口仍未恢复，请保留现场并人工检查" >&2
    fi
    exit 1
    ;;
  *)
    echo "拒绝：不允许的 CatCare 子命令" >&2
    exit 126
    ;;
esac
CONTROL_EOF

cat >"$TMP_DIR/catcare-ssh-gateway" <<'GATEWAY_EOF'
#!/bin/sh
# catcare-nas-automation
set -eu

case "${SSH_ORIGINAL_COMMAND:-}" in
  "catcare status")         exec sudo -n /usr/local/sbin/catcarectl status ;;
  "catcare health")         exec sudo -n /usr/local/sbin/catcarectl health ;;
  "catcare restart")        exec sudo -n /usr/local/sbin/catcarectl restart ;;
  "catcare logs")           exec sudo -n /usr/local/sbin/catcarectl logs ;;
  "catcare backup")         exec sudo -n /usr/local/sbin/catcarectl backup ;;
  "catcare gateway-update") exec sudo -n /usr/local/sbin/catcarectl gateway-update ;;
  "catcare public-update")  exec sudo -n /usr/local/sbin/catcarectl public-update ;;
  *)
    echo "拒绝：这把 SSH 密钥只能执行 CatCare 固定命令" >&2
    exit 126
    ;;
esac
GATEWAY_EOF

cat >"$TMP_DIR/catcare-automation" <<EOF
# catcare-nas-automation
$TARGET_USER ALL=(root) NOPASSWD: $CONTROL_BIN status, $CONTROL_BIN health, $CONTROL_BIN restart, $CONTROL_BIN logs, $CONTROL_BIN backup, $CONTROL_BIN gateway-update, $CONTROL_BIN public-update
EOF

mkdir -p /usr/local/sbin /usr/local/bin /etc/sudoers.d
cp "$TMP_DIR/catcarectl" "$CONTROL_BIN"
cp "$TMP_DIR/catcare-ssh-gateway" "$GATEWAY_BIN"
cp "$TMP_DIR/catcare-automation" "$SUDOERS_FILE"
chown root:root "$CONTROL_BIN" "$GATEWAY_BIN" "$SUDOERS_FILE"
chmod 0755 "$CONTROL_BIN" "$GATEWAY_BIN"
chmod 0440 "$SUDOERS_FILE"

if ! sudo -l -U "$TARGET_USER" >/dev/null 2>&1; then
  rm -f "$SUDOERS_FILE"
  fail "sudoers 校验失败，已撤回免密码规则"
fi

SSH_DIR="$HOME_DIR/.ssh"
AUTHORIZED_KEYS="$SSH_DIR/authorized_keys"
mkdir -p "$SSH_DIR"
touch "$AUTHORIZED_KEYS"
chown "$TARGET_USER" "$SSH_DIR" "$AUTHORIZED_KEYS"
chmod 0700 "$SSH_DIR"
chmod 0600 "$AUTHORIZED_KEYS"

if ! grep -Fq "$MARKER" "$AUTHORIZED_KEYS"; then
  [ -f "$PUBLIC_KEY_FILE" ] || fail "首次安装需要 $PUBLIC_KEY_FILE"
  PUBLIC_KEY="$(sed -n '1p' "$PUBLIC_KEY_FILE")"
  case "$PUBLIC_KEY" in
    ssh-ed25519\ *) ;;
    *) fail "公钥文件不是有效的 ED25519 公钥" ;;
  esac
  AUTHORIZED_LINE="restrict,command=\"$GATEWAY_BIN\" $PUBLIC_KEY $MARKER"
  printf '%s\n' "$AUTHORIZED_LINE" >>"$AUTHORIZED_KEYS"
fi

printf '%s\n' "CatCare 受限 SSH 授权安装完成"
printf '%s\n' "授权用户：$TARGET_USER"
printf '%s\n' "允许命令：status health restart logs backup gateway-update public-update"
