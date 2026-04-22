from __future__ import annotations

from fastapi import APIRouter, Query  # noqa: F401

from app.database import query_to_records

router = APIRouter(prefix="/snps", tags=["snps"])

PS_TOTAL_DEPT = "Federal Public Service"


def _q(sql: str, params=None) -> list[dict]:
    return query_to_records(sql, params or None)


@router.get("/years")
async def get_snps_years() -> list[int]:
    rows = _q("SELECT DISTINCT year FROM snps_responses ORDER BY year")
    return [r["year"] for r in rows]


@router.get("/departments")
async def get_snps_departments() -> list[str]:
    rows = _q(
        "SELECT DISTINCT dept_e FROM snps_responses "
        f"WHERE dept_e != '{PS_TOTAL_DEPT}' AND dept_e IS NOT NULL "
        "ORDER BY dept_e"
    )
    return [r["dept_e"] for r in rows]


@router.get("/questions")
async def get_snps_questions(year: int | None = None) -> list[dict]:
    """Return questions that have response data for the given year.
    Always uses the latest snps_questions as metadata source (canonical 2025 codes).
    Defaults to latest available response year."""
    if year is None:
        rows = _q("SELECT MAX(year) AS y FROM snps_responses")
        year = rows[0]["y"] if rows else None
    if year is None:
        return []
    # Use latest snps_questions year as the canonical metadata source
    meta_rows = _q("SELECT MAX(year) AS y FROM snps_questions")
    meta_year = meta_rows[0]["y"] if meta_rows else year
    return _q(
        "SELECT q.question, q.category_e, q.category_f, q.theme_e, q.theme_f, q.question_e, q.question_f "
        "FROM snps_questions q "
        "WHERE q.year = ? "
        "  AND EXISTS (SELECT 1 FROM snps_responses r WHERE r.question = q.question AND r.year = ?) "
        "ORDER BY q.question",
        [meta_year, year],
    )


@router.get("/responses")
async def get_snps_responses(
    question: str,
    dept: str | None = None,
    year: int | None = None,
) -> list[dict]:
    """Response distribution for a question. Returns dept + PS Total rows."""
    if year is None:
        rows = _q("SELECT MAX(year) AS y FROM snps_responses")
        year = rows[0]["y"] if rows else None
    if year is None:
        return []

    target_dept = dept or PS_TOTAL_DEPT
    depts = list({target_dept, PS_TOTAL_DEPT})  # dedupe if dept IS ps total
    placeholders = ", ".join("?" * len(depts))

    return _q(
        f"SELECT year, dept_e, dept_f, question_value_e, question_value_f, "  # noqa: S608
        f"shr_w_resp, total_w_resp "
        f"FROM snps_responses "
        f"WHERE question = ? AND year = ? AND dept_e IN ({placeholders}) "
        f"ORDER BY dept_e, question_value_e",
        [question, year, *depts],
    )


@router.get("/trend")
async def get_snps_trend(
    question: str,
    dept: str | None = None,
) -> list[dict]:
    """Response distribution across all available years for time-series view."""
    target_dept = dept or PS_TOTAL_DEPT
    depts = list({target_dept, PS_TOTAL_DEPT})
    placeholders = ", ".join("?" * len(depts))

    return _q(
        f"SELECT year, dept_e, question_value_e, question_value_f, "  # noqa: S608
        f"shr_w_resp, total_w_resp "
        f"FROM snps_responses "
        f"WHERE question = ? AND dept_e IN ({placeholders}) "
        f"ORDER BY year, dept_e, question_value_e",
        [question, *depts],
    )


@router.get("/dept-scores")
async def get_snps_dept_scores(question: str, year: int | None = None) -> list[dict]:
    """Positive % per department for a question/year, sorted descending."""
    if year is None:
        rows = _q("SELECT MAX(year) AS y FROM snps_responses WHERE question = ?", [question])
        year = rows[0]["y"] if rows else None
    if year is None:
        return []

    positive_vals = ("To a great extent", "To a moderate extent", "Yes")
    placeholders = ", ".join("?" * len(positive_vals))

    return _q(
        f"SELECT dept_e, "  # noqa: S608
        f"ROUND(SUM(CASE WHEN question_value_e IN ({placeholders}) THEN shr_w_resp ELSE 0 END) * 100) AS positive_pct, "
        f"MAX(total_w_resp) AS n_respondents "
        f"FROM snps_responses "
        f"WHERE question = ? AND year = ? AND dept_e != ? "
        f"GROUP BY dept_e "
        f"ORDER BY positive_pct DESC",
        [*positive_vals, question, year, PS_TOTAL_DEPT],
    )
