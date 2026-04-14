from __future__ import annotations

import logging

from fastapi import APIRouter, Query

from app.database import query_to_records
from app.models.responses import FunnelByRegionRow, FunnelRow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/funnel", tags=["funnel"])


@router.get("", response_model=list[FunnelRow])
async def get_funnel(
    fiscal_year: list[str] | None = Query(default=None),
) -> list[dict]:
    if fiscal_year:
        placeholders = ", ".join(["?" for _ in fiscal_year])
        return query_to_records(
            f"SELECT * FROM v_recruitment_funnel WHERE fiscal_year IN ({placeholders}) ORDER BY fiscal_year",  # noqa: S608
            fiscal_year,
        )
    return query_to_records("SELECT * FROM v_recruitment_funnel ORDER BY fiscal_year")


@router.get("/by-region", response_model=list[FunnelByRegionRow])
async def get_funnel_by_region(
    fiscal_year: str | None = None,
) -> list[dict]:
    if fiscal_year:
        return query_to_records(
            "SELECT * FROM v_funnel_by_region WHERE fiscal_year = ? ORDER BY region_e",
            [fiscal_year],
        )
    return query_to_records("SELECT * FROM v_funnel_by_region ORDER BY fiscal_year, region_e")
