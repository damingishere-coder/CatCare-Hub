import asyncio
import logging
import os

from sqlalchemy.orm import sessionmaker

from app.services.intake import redact_due_submissions


logger = logging.getLogger(__name__)
INTERVAL_ENV = "CATCARE_RELAY_CLEANUP_INTERVAL_SECONDS"


async def run_redaction_worker(session_factory: sessionmaker) -> None:
    """Run an idempotent cleanup immediately and then at a bounded interval."""

    interval = max(300, int(os.getenv(INTERVAL_ENV, "21600")))
    while True:
        try:
            with session_factory() as session:
                redacted = redact_due_submissions(session)
                session.commit()
            if redacted:
                logger.info("redacted %d expired intake submissions", redacted)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("intake redaction worker failed")
        await asyncio.sleep(interval)
