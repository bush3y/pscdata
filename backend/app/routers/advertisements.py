from __future__ import annotations

import csv
import io
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.database import query_to_df, query_to_records
from app.models.responses import AdvertisementSummaryRow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/advertisements", tags=["advertisements"])

ALLOWED_COLUMNS: frozenset[str] = frozenset({
    "fiscal_year", "car_chc_id", "reference_number", "selection_process_number",
    "creation_date", "open_date", "close_date", "number_days_open",
    "internal_indicator", "external_indicator",
    "position_title_e", "position_title_f",
    "classifications",
    "advertisement_url_e", "advertisement_url_f",
    "city_name_e", "city_name_f",
    "administrator_region_e", "administrator_region_f",
    "advertisement_type_e", "advertisement_type_f",
    "organization_e", "organization_f", "organization_code",
    "province_name_e", "province_name_f",
    "recruitment_program_e", "recruitment_program_f",
    "status_e", "status_f",
    "indeterminate", "specified_term", "acting", "assignment", "deployment", "secondment",
    "total_submitted_sup", "total_in_sup", "total_out_sup", "caf_in",
    "women_submitted_sup", "vismin_submitted_sup", "indigenous_submitted_sup",
    "pwd_submitted_sup", "french_submitted_sup", "english_submitted_sup",
})

_DEFAULT_COLUMNS = [
    "fiscal_year", "reference_number", "open_date", "close_date",
    "position_title_e", "administrator_region_e",
    "advertisement_type_e", "organization_e", "status_e",
    "total_submitted_sup", "total_in_sup",
]


@router.get("/autocomplete")
async def autocomplete_reference(q: str = "", limit: int = 10) -> list[dict]:
    """Return matching reference and selection process numbers containing *q* (case-insensitive)."""
    if not q or len(q) < 2:
        return []
    rows = query_to_records(
        """
        SELECT DISTINCT reference_number, selection_process_number
        FROM raw_advertisements
        WHERE reference_number ILIKE ?
           OR selection_process_number ILIKE ?
        ORDER BY selection_process_number, reference_number
        LIMIT ?
        """,  # noqa: S608
        [f"%{q}%", f"%{q}%", limit],
    )
    return [
        {"reference_number": r["reference_number"], "selection_process_number": r["selection_process_number"]}
        for r in rows
    ]


@router.get("/process")
async def get_process(
    reference_number: str | None = None,
    car_chc_id: int | None = None,
) -> dict:
    """Return full detail for a single process by reference number, selection process number, or car_chc_id."""
    if car_chc_id is not None:
        rows = query_to_records(
            "SELECT * FROM raw_advertisements WHERE car_chc_id = ? ORDER BY _loaded_at DESC LIMIT 1",  # noqa: S608
            [car_chc_id],
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"Process '{car_chc_id}' not found.")
        return rows[0]
    if not reference_number:
        raise HTTPException(status_code=422, detail="Provide reference_number or car_chc_id.")
    rows = query_to_records(
        """
        SELECT * FROM raw_advertisements
        WHERE reference_number = ?
           OR selection_process_number = ?
        ORDER BY _loaded_at DESC LIMIT 1
        """,  # noqa: S608
        [reference_number, reference_number],
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"Process '{reference_number}' not found.")
    return rows[0]


@router.get("/filter-options")
async def get_filter_options() -> dict[str, list[str]]:
    """Return sorted distinct values for each filterable text field."""
    fields = {
        "organization": "organization_e",
        "region": "administrator_region_e",
        "status": "status_e",
        "advertisement_type": "advertisement_type_e",
        "recruitment_program": "recruitment_program_e",
        "classifications": "classifications",
    }
    result: dict[str, list[str]] = {}
    for key, col in fields.items():
        rows = query_to_records(
            f"SELECT DISTINCT {col} AS val FROM raw_advertisements "  # noqa: S608
            f"WHERE {col} IS NOT NULL ORDER BY {col}"
        )
        result[key] = [r["val"] for r in rows]
    return result


@router.get("/summary", response_model=list[AdvertisementSummaryRow])
async def get_advertisement_summary() -> list[dict]:
    """Return advertisement counts per fiscal year from the v_adv_trend view."""
    return query_to_records("SELECT * FROM v_adv_trend ORDER BY fiscal_year")


def _in_clause(col: str, values: list[str], params: list) -> str:
    placeholders = ", ".join("?" for _ in values)
    params.extend(values)
    return f"{col} IN ({placeholders})"


NUMERIC_COLS_SET: frozenset[str] = frozenset({
    "indeterminate", "specified_term", "acting", "assignment", "deployment", "secondment",
    "number_days_open",
    "total_submitted_sup", "total_in_sup", "total_out_sup", "caf_in",
    "women_submitted_sup", "vismin_submitted_sup", "indigenous_submitted_sup",
    "pwd_submitted_sup", "french_submitted_sup", "english_submitted_sup",
})

_METRIC_SQL: dict[str, str] = {
    # Use reference_number where present, fall back to row count for ads without one (e.g. FSWEP)
    "adv_count": "COUNT(DISTINCT COALESCE(reference_number, CAST(rowid AS VARCHAR)))",
    **{col: f"SUM({col})" for col in NUMERIC_COLS_SET},
}

_AGGREGATE_ALLOWED = ALLOWED_COLUMNS - frozenset({
    "reference_number", "open_date", "close_date",
    "position_title_e", "position_title_f",
    "internal_indicator", "external_indicator",
    "organization_code", "province_name_e", "province_name_f",
}) - NUMERIC_COLS_SET


@router.get("/aggregate")
async def aggregate_advertisements(
    group_by: str,
    group_by2: str | None = None,
    metric: str = "adv_count",
    as_pct: bool = False,
    fiscal_year: list[str] | None = Query(default=None),
    region: list[str] | None = Query(default=None),
    organization: list[str] | None = Query(default=None),
    status: list[str] | None = Query(default=None),
    advertisement_type: list[str] | None = Query(default=None),
    recruitment_program: list[str] | None = Query(default=None),
    classifications: list[str] | None = Query(default=None),
) -> list[dict]:
    """Aggregate raw_advertisements by one or two dimensions.

    When group_by2 is supplied the response includes a 'category' field for
    the second dimension — useful for pivoting into a stacked/multi-series chart.
    When as_pct=True each row's value is a percentage of the unfiltered total
    for that group_by group (only valid for single-dimension queries).
    """
    if group_by not in _AGGREGATE_ALLOWED:
        raise HTTPException(status_code=400, detail=f"Invalid group_by column: {group_by}")
    if group_by2 is not None and group_by2 not in _AGGREGATE_ALLOWED:
        raise HTTPException(status_code=400, detail=f"Invalid group_by2 column: {group_by2}")
    if metric not in _METRIC_SQL:
        raise HTTPException(status_code=400, detail=f"Invalid metric: {metric}")

    conditions: list[str] = [f"{group_by} IS NOT NULL"]
    if group_by2:
        conditions.append(f"{group_by2} IS NOT NULL")
    params: list = []
    if fiscal_year:
        conditions.append(_in_clause("fiscal_year", fiscal_year, params))
    if region:
        conditions.append(_in_clause("administrator_region_e", region, params))
    if organization:
        conditions.append(_in_clause("organization_e", organization, params))
    if status:
        conditions.append(_in_clause("status_e", status, params))
    if advertisement_type:
        conditions.append(_in_clause("advertisement_type_e", advertisement_type, params))
    if recruitment_program:
        conditions.append(_in_clause("recruitment_program_e", recruitment_program, params))
    if classifications:
        conditions.append(_in_clause("classifications", classifications, params))

    where = f"WHERE {' AND '.join(conditions)}"

    if group_by2:
        sql = f"""
            SELECT {group_by} AS x, {group_by2} AS category, {_METRIC_SQL[metric]} AS y
            FROM raw_advertisements
            {where}
            GROUP BY {group_by}, {group_by2}
            ORDER BY {group_by}, {group_by2}
        """  # noqa: S608
        return query_to_records(sql, params)

    sql = f"""
        SELECT {group_by} AS x, {_METRIC_SQL[metric]} AS y
        FROM raw_advertisements
        {where}
        GROUP BY {group_by}
        ORDER BY {group_by}
    """  # noqa: S608
    rows = query_to_records(sql, params)

    if not as_pct:
        return rows

    # Fetch unfiltered totals for the same group_by dimension
    unfiltered_sql = f"""
        SELECT {group_by} AS x, {_METRIC_SQL[metric]} AS total
        FROM raw_advertisements
        WHERE {group_by} IS NOT NULL
        GROUP BY {group_by}
    """  # noqa: S608
    totals = {r["x"]: r["total"] for r in query_to_records(unfiltered_sql)}

    return [
        {
            "x": r["x"],
            "y": round(100.0 * r["y"] / totals[r["x"]], 1) if totals.get(r["x"]) else None,
        }
        for r in rows
    ]


@router.get("")
async def get_advertisements(
    fiscal_year: list[str] | None = Query(default=None),
    region: list[str] | None = Query(default=None),
    organization: list[str] | None = Query(default=None),
    status: list[str] | None = Query(default=None),
    advertisement_type: list[str] | None = Query(default=None),
    recruitment_program: list[str] | None = Query(default=None),
    classifications: list[str] | None = Query(default=None),
    columns: list[str] | None = Query(default=None),
    limit: int = Query(default=1000, le=10000),
    offset: int = 0,
    format: str = Query(default="json", pattern="^(json|csv)$"),
):
    """Query raw_advertisements with optional filters and column selection."""
    if columns:
        invalid = [c for c in columns if c not in ALLOWED_COLUMNS]
        if invalid:
            raise HTTPException(status_code=400, detail=f"Invalid columns: {invalid}")
        select_cols = columns
    else:
        select_cols = _DEFAULT_COLUMNS

    select_clause = ", ".join(select_cols)

    conditions: list[str] = []
    params: list = []

    if fiscal_year:
        conditions.append(_in_clause("fiscal_year", fiscal_year, params))

    if region:
        conditions.append(_in_clause("administrator_region_e", region, params))

    if organization:
        conditions.append(_in_clause("organization_e", organization, params))

    if status:
        conditions.append(_in_clause("status_e", status, params))

    if advertisement_type:
        conditions.append(_in_clause("advertisement_type_e", advertisement_type, params))

    if recruitment_program:
        conditions.append(_in_clause("recruitment_program_e", recruitment_program, params))

    if classifications:
        conditions.append(_in_clause("classifications", classifications, params))

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"""
        SELECT {select_clause}
        FROM raw_advertisements
        {where_clause}
        ORDER BY fiscal_year DESC, open_date DESC
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    if format == "csv":
        df = query_to_df(sql, params)
        buffer = io.StringIO()
        df.to_csv(buffer, index=False, quoting=csv.QUOTE_NONNUMERIC)
        buffer.seek(0)
        return StreamingResponse(
            iter([buffer.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=advertisements.csv"},
        )

    return query_to_records(sql, params)
