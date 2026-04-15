import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


async def create_tables() -> None:
    """Create all tables on startup, then add any missing columns."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _migrate_missing_columns()


async def _migrate_missing_columns() -> None:
    """Add columns that exist in models but are missing from the DB (no-op if already present)."""
    async with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            rows = await conn.execute(text(f"PRAGMA table_info({table.name})"))
            existing = {row[1] for row in rows}
            for col in table.columns:
                if col.name not in existing:
                    type_str = col.type.compile(dialect=engine.dialect)
                    nullable = "" if col.nullable else " NOT NULL"
                    default = ""
                    if col.default is not None and col.default.is_scalar:
                        default = f" DEFAULT {col.default.arg!r}"
                    await conn.execute(
                        text(f"ALTER TABLE {table.name} ADD COLUMN {col.name} {type_str}{nullable}{default}")
                    )
                    logger.info("migration: added %s.%s (%s)", table.name, col.name, type_str)
