from logging.config import fileConfig

from alembic import context
from sqlalchemy import make_url, pool

from app.db.base import Base
from app.db.session import build_engine, get_database_url
import app.models  # noqa: F401


config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def resolved_database_url() -> str:
    configured_url = config.get_main_option("sqlalchemy.url").strip()
    return get_database_url(configured_url or None)


def run_migrations_offline() -> None:
    url = resolved_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        render_as_batch=make_url(url).get_backend_name() == "sqlite",
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = build_engine(
        resolved_database_url(),
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            render_as_batch=connection.dialect.name == "sqlite",
        )

        with context.begin_transaction():
            context.run_migrations()

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
