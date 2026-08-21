import os
import warnings
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from pathlib import Path, PurePosixPath
from uuid import uuid4

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

from app.db.session import PROJECT_ROOT


UPLOAD_ROOT = (PROJECT_ROOT / "data" / "uploads").resolve()
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
READ_CHUNK_BYTES = 1024 * 1024
FORMAT_DETAILS = {
    "JPEG": (".jpg", "image/jpeg"),
    "PNG": (".png", "image/png"),
    "WEBP": (".webp", "image/webp"),
}


@dataclass(frozen=True)
class ValidatedImage:
    content: bytes
    extension: str
    media_type: str


class UploadValidationError(ValueError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


async def validate_uploaded_image(upload: UploadFile) -> ValidatedImage:
    chunks: list[bytes] = []
    size = 0
    while chunk := await upload.read(READ_CHUNK_BYTES):
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES:
            raise UploadValidationError(413, "单张图片不能超过 10 MiB")
        chunks.append(chunk)

    if size == 0:
        raise UploadValidationError(422, "不能上传空文件")

    content = b"".join(chunks)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                image_format = image.format
                width, height = image.size
                if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
                    raise UploadValidationError(413, "图片像素不能超过 2500 万")
                image.verify()
    except UploadValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise UploadValidationError(413, "图片像素不能超过 2500 万") from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise UploadValidationError(422, "图片内容损坏或格式不受支持") from None

    details = FORMAT_DETAILS.get(image_format or "")
    if details is None:
        raise UploadValidationError(415, "仅支持 JPEG、PNG 和 WebP 图片")
    extension, expected_media_type = details
    if upload.content_type != expected_media_type:
        raise UploadValidationError(415, "图片声明类型与实际内容不一致")
    return ValidatedImage(
        content=content,
        extension=extension,
        media_type=expected_media_type,
    )


def persist_uploaded_image(image: ValidatedImage, service_date: date) -> str:
    directory = (
        UPLOAD_ROOT
        / "tasks"
        / f"{service_date.year:04d}"
        / f"{service_date.month:02d}"
        / f"{service_date.day:02d}"
    )
    directory.mkdir(parents=True, exist_ok=True)
    resolved_directory = directory.resolve()
    if not resolved_directory.is_relative_to(UPLOAD_ROOT):
        raise RuntimeError("上传目录不安全")

    token = uuid4().hex
    filename = f"{token}{image.extension}"
    final_path = resolved_directory / filename
    temporary_path = resolved_directory / f".{token}.tmp"
    try:
        with temporary_path.open("xb") as output:
            output.write(image.content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, final_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        final_path.unlink(missing_ok=True)
        raise

    return (
        f"/uploads/tasks/{service_date.year:04d}/{service_date.month:02d}/"
        f"{service_date.day:02d}/{filename}"
    )


def resolve_photo_path(file_url: str) -> Path | None:
    prefix = "/uploads/"
    if not file_url.startswith(prefix):
        return None
    relative = PurePosixPath(file_url.removeprefix(prefix))
    if not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
        return None
    candidate = (UPLOAD_ROOT.joinpath(*relative.parts)).resolve()
    if not candidate.is_relative_to(UPLOAD_ROOT):
        return None
    return candidate


def delete_stored_photo(file_url: str) -> None:
    path = resolve_photo_path(file_url)
    if path is not None:
        path.unlink(missing_ok=True)


def photo_media_type(path: Path) -> str | None:
    return {
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(path.suffix.lower())
