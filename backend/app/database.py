from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

import duckdb
import pandas as pd

from app.config import settings

logger = logging.getLogger(__name__)

_write_lock = asyncio.Lock()


@contextlib.contextmanager
def get_read_conn():
    """Context manager returning a read-only DuckDB connection."""
    conn = duckdb.connect(settings.DUCKDB_PATH)
    try:
        yield conn
    finally:
        conn.close()


@contextlib.asynccontextmanager
async def get_write_conn():
    """Async context manager returning a writable DuckDB connection.

    Acquires a module-level asyncio lock so that only one writer is active
    at a time (DuckDB only allows one simultaneous writer).
    """
    await _write_lock.acquire()
    conn = duckdb.connect(settings.DUCKDB_PATH, read_only=False)
    try:
        yield conn
    finally:
        conn.close()
        _write_lock.release()


def query_to_df(sql: str, params: list[Any] | None = None) -> pd.DataFrame:
    """Execute a query and return results as a pandas DataFrame."""
    with get_read_conn() as conn:
        if params:
            return conn.execute(sql, params).df()
        return conn.execute(sql).df()


def query_to_records(sql: str, params: list[Any] | None = None) -> list[dict]:
    """Execute a query and return results as a list of dicts."""
    df = query_to_df(sql, params)
    return df.astype(object).where(pd.notnull(df), other=None).to_dict(orient="records")
