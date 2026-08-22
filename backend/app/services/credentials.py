import base64
import hashlib
import secrets


PBKDF2_ALGORITHM = "sha256"
PBKDF2_ITERATIONS = 600_000
PBKDF2_MIN_ITERATIONS = 300_000
PBKDF2_MAX_ITERATIONS = 2_000_000
ACCESS_CODE_MIN_LENGTH = 12


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_access_code(
    access_code: str,
    *,
    salt: bytes | None = None,
    iterations: int = PBKDF2_ITERATIONS,
) -> str:
    if len(access_code) < ACCESS_CODE_MIN_LENGTH:
        raise ValueError(f"访问码至少需要 {ACCESS_CODE_MIN_LENGTH} 个字符")
    if not PBKDF2_MIN_ITERATIONS <= iterations <= PBKDF2_MAX_ITERATIONS:
        raise ValueError("PBKDF2 迭代次数超出安全范围")
    resolved_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        access_code.encode("utf-8"),
        resolved_salt,
        iterations,
    )
    return "$".join(
        ("pbkdf2_sha256", str(iterations), _b64encode(resolved_salt), _b64encode(digest))
    )


def parse_password_hash(encoded_hash: str) -> tuple[int, bytes, bytes]:
    scheme, raw_iterations, raw_salt, raw_digest = encoded_hash.split("$", 3)
    iterations = int(raw_iterations)
    if scheme != "pbkdf2_sha256":
        raise ValueError("不支持的访问码哈希格式")
    if not PBKDF2_MIN_ITERATIONS <= iterations <= PBKDF2_MAX_ITERATIONS:
        raise ValueError("PBKDF2 迭代次数超出安全范围")
    salt = _b64decode(raw_salt)
    digest = _b64decode(raw_digest)
    if len(salt) < 16 or len(digest) != hashlib.sha256().digest_size:
        raise ValueError("访问码哈希内容无效")
    return iterations, salt, digest


def verify_access_code(access_code: str, encoded_hash: str) -> bool:
    try:
        iterations, salt, expected = parse_password_hash(encoded_hash)
        actual = hashlib.pbkdf2_hmac(
            PBKDF2_ALGORITHM,
            access_code.encode("utf-8"),
            salt,
            iterations,
        )
        return secrets.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def token_digest(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
