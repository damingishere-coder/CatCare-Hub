import os
from pathlib import Path
import subprocess
import sys

from dotenv import dotenv_values

from app.services.credentials import parse_password_hash


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "manage_access.py"


def clean_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment.pop("CATCARE_ADMIN_PASSWORD_HASH", None)
    environment.pop("CATCARE_MOBILE_PASSWORD_HASH", None)
    environment["PYTHONIOENCODING"] = "utf-8"
    return environment


def run_access_script(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *arguments],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=clean_environment(),
    )


def test_initialize_is_hash_only_and_idempotent(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    template = tmp_path / ".env.example"
    template.write_text(
        "# isolated P12 test\nCATCARE_ADMIN_PASSWORD_HASH=\nCATCARE_MOBILE_PASSWORD_HASH=\n",
        encoding="utf-8",
    )

    first = run_access_script(
        "--initialize",
        "--env-file",
        str(env_file),
        "--template",
        str(template),
    )
    assert first.returncode == 0, first.stderr
    assert "原文只显示这一次" in first.stdout
    values = dotenv_values(env_file)
    for name in ("CATCARE_ADMIN_PASSWORD_HASH", "CATCARE_MOBILE_PASSWORD_HASH"):
        encoded_hash = values[name]
        assert isinstance(encoded_hash, str)
        parse_password_hash(encoded_hash)
        assert encoded_hash.startswith("pbkdf2_sha256$")
    original_contents = env_file.read_text(encoding="utf-8")

    second = run_access_script(
        "--initialize",
        "--env-file",
        str(env_file),
        "--template",
        str(template),
    )
    assert second.returncode == 0
    assert "本次未覆盖" in second.stdout
    assert env_file.read_text(encoding="utf-8") == original_contents

    check = run_access_script("--check", "--env-file", str(env_file))
    assert check.returncode == 0


def test_check_rejects_missing_or_malformed_hashes(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "CATCARE_ADMIN_PASSWORD_HASH=invalid\nCATCARE_MOBILE_PASSWORD_HASH=\n",
        encoding="utf-8",
    )
    result = run_access_script("--check", "--env-file", str(env_file))
    assert result.returncode == 1
    assert "setup.bat" in result.stderr
