import logging
import re


FILL_TOKEN_PATTERN = re.compile(r"(/api/fill/)[^/?\s]+")


def redact_fill_tokens(value: object) -> object:
    if not isinstance(value, str):
        return value
    return FILL_TOKEN_PATTERN.sub(r"\1[redacted]", value)


class FillTokenRedactionFilter(logging.Filter):
    """Prevent public form tokens from being written to Uvicorn access logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact_fill_tokens(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(redact_fill_tokens(value) for value in record.args)
        elif isinstance(record.args, dict):
            record.args = {
                key: redact_fill_tokens(value) for key, value in record.args.items()
            }
        return True


def install_fill_token_redaction() -> None:
    access_logger = logging.getLogger("uvicorn.access")
    if not any(
        isinstance(item, FillTokenRedactionFilter) for item in access_logger.filters
    ):
        access_logger.addFilter(FillTokenRedactionFilter())
