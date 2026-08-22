"""Initialize or reset local access codes without storing plaintext credentials."""

from __future__ import annotations

import argparse
import getpass
import os
from pathlib import Path
import secrets
import shutil
import sys

from dotenv import dotenv_values, set_key


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.credentials import (  # noqa: E402
    ACCESS_CODE_MIN_LENGTH,
    hash_access_code,
    parse_password_hash,
)


ROLE_ENV_NAMES = {
    "admin": "CATCARE_ADMIN_PASSWORD_HASH",
    "mobile": "CATCARE_MOBILE_PASSWORD_HASH",
}


def effective_value(values: dict[str, str | None], name: str) -> str:
    return os.getenv(name, values.get(name) or "").strip()


def validate_hash(value: str) -> bool:
    try:
        parse_password_hash(value)
    except (TypeError, ValueError):
        return False
    return True


def ensure_env_file(env_file: Path, template: Path) -> None:
    if env_file.exists():
        return
    env_file.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(template, env_file)


def initialize(env_file: Path, template: Path) -> int:
    ensure_env_file(env_file, template)
    values = dict(dotenv_values(env_file))
    generated: dict[str, str] = {}
    for role, name in ROLE_ENV_NAMES.items():
        existing = effective_value(values, name)
        if existing:
            if not validate_hash(existing):
                print(f"错误：{name} 已存在但格式无效，请使用 --reset {role}。", file=sys.stderr)
                return 1
            continue
        access_code = secrets.token_urlsafe(18)
        set_key(str(env_file), name, hash_access_code(access_code), quote_mode="always")
        generated[role] = access_code

    if generated:
        print("\nCatCare-Hub 本地访问码（原文只显示这一次，请立即保存到密码管理器）：")
        if "admin" in generated:
            print(f"  管理后台：admin / {generated['admin']}")
        if "mobile" in generated:
            print(f"  移动执行端：mobile / {generated['mobile']}")
        print("仓库与 .env 只保存不可逆哈希，不会保存上述原文。\n")
    else:
        print("本地访问码已配置，本次未覆盖，也不会再次显示原文。")
    return 0


def check(env_file: Path) -> int:
    values = dict(dotenv_values(env_file)) if env_file.exists() else {}
    invalid = [
        name
        for name in ROLE_ENV_NAMES.values()
        if not validate_hash(effective_value(values, name))
    ]
    if invalid:
        print("本地访问码尚未正确配置，请先运行 setup.bat。", file=sys.stderr)
        return 1
    return 0


def reset(env_file: Path, template: Path, role: str) -> int:
    ensure_env_file(env_file, template)
    first = getpass.getpass(f"请输入新的 {role} 访问码（至少 {ACCESS_CODE_MIN_LENGTH} 位）：")
    second = getpass.getpass("请再次输入：")
    if first != second:
        print("两次输入不一致，未修改配置。", file=sys.stderr)
        return 1
    try:
        encoded_hash = hash_access_code(first)
    except ValueError as exc:
        print(f"访问码无效：{exc}", file=sys.stderr)
        return 1
    set_key(str(env_file), ROLE_ENV_NAMES[role], encoded_hash, quote_mode="always")
    print(f"{role} 访问码已重置；请重启 CatCare-Hub，重启后该角色的现有会话会失效。")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="管理 CatCare-Hub 本地访问码")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--initialize", action="store_true")
    action.add_argument("--check", action="store_true")
    action.add_argument("--reset", choices=sorted(ROLE_ENV_NAMES))
    parser.add_argument("--env-file", type=Path, default=PROJECT_ROOT / ".env")
    parser.add_argument("--template", type=Path, default=PROJECT_ROOT / ".env.example")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    env_file = args.env_file.resolve()
    template = args.template.resolve()
    if args.initialize:
        return initialize(env_file, template)
    if args.check:
        return check(env_file)
    return reset(env_file, template, args.reset)


if __name__ == "__main__":
    raise SystemExit(main())
