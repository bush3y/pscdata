from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from app.database import get_write_conn

logger = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


async def init_db() -> None:
    """Read schema.sql and execute every statement against the DuckDB database.

    Statements are split on ';' so each is executed individually.  Failures
    are logged as warnings rather than raised so that VIEW creation failures
    (which can happen on an empty database) do not prevent startup.
    """
    sql_text = SCHEMA_PATH.read_text()
    statements = [s.strip() for s in sql_text.split(";") if s.strip()]

    async with get_write_conn() as conn:
        for stmt in statements:
            try:
                conn.execute(stmt)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Migration statement failed (non-fatal): %s — %s", stmt[:80], exc)

    logger.info("Database initialised — %d statements processed.", len(statements))
