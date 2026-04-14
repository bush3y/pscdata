from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import query_to_records

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/query", tags=["query"])

# Keywords that must never appear in a read-only query
_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|ATTACH|DETACH|COPY|EXPORT"
    r"|PRAGMA|CALL|EXECUTE|INSTALL|LOAD|VACUUM|CHECKPOINT|SET\s+VARIABLE)\b",
    re.IGNORECASE,
)

def _validate(sql: str) -> str | None:
    """Return an error string if the SQL is unsafe, otherwise None."""
    # Strip block comments /* … */
    cleaned = re.sub(r"/\*.*?\*/", "", sql, flags=re.DOTALL)
    # Strip line comments -- …
    cleaned = re.sub(r"--[^\n]*", "", cleaned)
    cleaned = cleaned.strip()

    if not cleaned:
        return "Query is empty."
    if ";" in cleaned:
        return "Multiple statements are not allowed — remove the semicolon."
    if not re.match(r"^\s*SELECT\b", cleaned, re.IGNORECASE):
        return "Only SELECT queries are allowed."
    if _FORBIDDEN.search(cleaned):
        return "Query contains a forbidden keyword."
    return None


class RawQueryRequest(BaseModel):
    sql: str
    limit: int = 5_000  # 0 = no limit


@router.post("/raw")
async def raw_query(req: RawQueryRequest) -> dict:
    """Execute a read-only SELECT query against the database.

    Pass limit=0 for no row cap. Otherwise the query is wrapped with LIMIT.
    Only SELECT statements are accepted; forbidden keywords (INSERT, DROP, etc.)
    are rejected before execution.
    """
    err = _validate(req.sql)
    if err:
        raise HTTPException(status_code=400, detail=err)

    sql = req.sql.strip()
    wrapped = sql if req.limit == 0 else f"SELECT * FROM ({sql}) __q LIMIT {req.limit}"  # noqa: S608

    try:
        rows = query_to_records(wrapped)
    except Exception as exc:
        # Surface DuckDB parse/execution errors back to the user
        logger.warning("Raw query failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "rows": rows,
        "row_count": len(rows),
        "capped": req.limit > 0 and len(rows) == req.limit,
        "columns": list(rows[0].keys()) if rows else [],
    }
