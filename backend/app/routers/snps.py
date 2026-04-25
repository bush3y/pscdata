from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Query  # noqa: F401

from app.database import query_to_records

router = APIRouter(prefix="/snps", tags=["snps"])

PS_TOTAL_DEPT = "Federal Public Service"

# TBS fuzzy-match fragments (same pattern as staffing.py)
_TBS_FUZZY   = "(dept_e = ? OR STARTS_WITH(?, dept_e || ' ('))"
_TBS_FUZZY_T = "(t.dept_e = ? OR STARTS_WITH(?, t.dept_e || ' ('))"


def _q(sql: str, params=None) -> list[dict]:
    return query_to_records(sql, params or None)


def _resolve_snps_peers(dept: str, year: int) -> tuple[str | None, list[str]]:
    """Return (tier_label, peer_snps_dept_names).
    tier_label is None when the dept can't be found in TBS population data.
    Peers are matched against snps_responses dept names (not dash_inflow)."""
    hc_rows = _q(
        f"SELECT count FROM tbs_pop_dept "
        f"WHERE {_TBS_FUZZY} "
        f"  AND year = (SELECT MAX(year) FROM tbs_pop_dept WHERE {_TBS_FUZZY}) "
        f"ORDER BY length(dept_e) DESC LIMIT 1",
        [dept, dept, dept, dept],
    )
    if not hc_rows or hc_rows[0]["count"] is None:
        return None, []
    hc = hc_rows[0]["count"]

    if hc < 100:    lo, hi, label = 0, 99, "Micro"
    elif hc < 500:  lo, hi, label = 100, 499, "Small"
    elif hc < 2000: lo, hi, label = 500, 1999, "Medium"
    else:           lo, hi, label = 2000, 9_999_999, "Large"

    peer_tbs_rows = _q(
        f"SELECT t.dept_e FROM tbs_pop_dept t "
        f"WHERE t.year = (SELECT MAX(year) FROM tbs_pop_dept) "
        f"  AND t.count >= ? AND t.count <= ? "
        f"  AND NOT ({_TBS_FUZZY_T})",
        [lo, hi, dept, dept],
    )
    peer_tbs_names = {r["dept_e"] for r in peer_tbs_rows}
    if not peer_tbs_names:
        return label, []

    snps_dept_rows = _q(
        "SELECT DISTINCT dept_e FROM snps_responses WHERE year = ? AND dept_e != ?",
        [year, PS_TOTAL_DEPT],
    )
    snps_depts = [r["dept_e"] for r in snps_dept_rows]
    peers = [
        s for s in snps_depts
        if any(s == t or s.startswith(t + " (") for t in peer_tbs_names)
        and s != dept
    ]
    return label, peers


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
    Uses browse-year snps_questions for metadata (correct themes/labels per year),
    falling back to latest year for questions only introduced in later surveys.
    Defaults to latest available response year when year param is omitted."""
    if year is None:
        rows = _q("SELECT MAX(year) AS y FROM snps_responses")
        year = rows[0]["y"] if rows else None
    if year is None:
        return []
    # Use browse year's own snps_questions as primary metadata source so theme/label
    # assignments reflect the actual survey year (e.g. 2023 demographic themes).
    # Fall back to latest year's metadata for questions introduced later (not in browse year).
    meta_rows = _q("SELECT MAX(year) AS y FROM snps_questions")
    meta_year = meta_rows[0]["y"] if meta_rows else year
    return _q(
        "SELECT q.question, q.category_e, q.category_f, q.theme_e, q.theme_f, q.question_e, q.question_f "
        "FROM snps_questions q "
        "WHERE q.year = ? AND EXISTS (SELECT 1 FROM snps_responses r WHERE r.question = q.question AND r.year = ?) "
        "UNION "
        "SELECT q2.question, q2.category_e, q2.category_f, q2.theme_e, q2.theme_f, q2.question_e, q2.question_f "
        "FROM snps_questions q2 "
        "WHERE q2.year = ? AND EXISTS (SELECT 1 FROM snps_responses r WHERE r.question = q2.question AND r.year = ?) "
        "  AND NOT EXISTS (SELECT 1 FROM snps_questions qbrowse WHERE qbrowse.year = ? AND qbrowse.question = q2.question) "
        "ORDER BY question",
        [year, year, meta_year, year, year],
    )


@router.get("/responses")
async def get_snps_responses(
    question: str,
    dept: str | None = None,
    year: int | None = None,
) -> list[dict]:
    """Response distribution for a question.
    Always returns both the requested dept AND PS Total rows so the chart can
    render a side-by-side comparison. Callers must not sum across all rows."""
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
async def get_snps_dept_scores(
    question: str,
    year: int | None = None,
    value_e: str | None = None,
) -> list[dict]:
    """% per department for a question/year, sorted descending.

    When value_e is provided, ranks by share who gave that specific answer.
    Otherwise ranks by positive response rate (great/moderate extent or Yes).
    """
    if year is None:
        rows = _q("SELECT MAX(year) AS y FROM snps_responses WHERE question = ?", [question])
        year = rows[0]["y"] if rows else None
    if year is None:
        return []

    if value_e is not None:
        return _q(
            "SELECT dept_e, "  # noqa: S608
            "ROUND(SUM(CASE WHEN question_value_e = ? THEN shr_w_resp ELSE 0 END) * 100) AS positive_pct, "
            "MAX(total_w_resp) AS n_respondents "
            "FROM snps_responses "
            "WHERE question = ? AND year = ? AND dept_e != ? "
            "GROUP BY dept_e "
            "ORDER BY positive_pct DESC",
            [value_e, question, year, PS_TOTAL_DEPT],
        )

    positive_vals = ("To a great extent", "To a moderate extent", "Yes", "Selected")
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


@router.get("/dept-profile")
async def get_snps_dept_profile(dept: str, year: int | None = None) -> list[dict]:
    """Per-question positive % for a dept with PS Total and peer-group comparisons.
    Excludes demographic characteristic questions (no meaningful positive %).
    Peers are determined by TBS size tier (Micro/Small/Medium/Large)."""
    if year is None:
        y = _q("SELECT MAX(year) AS y FROM snps_responses WHERE dept_e = ?", [dept])
        year = y[0]["y"] if y else None
    if year is None:
        return []

    positive_vals = ("To a great extent", "To a moderate extent", "Yes", "Selected")
    ph = ", ".join("?" * len(positive_vals))

    # Batch: positive % for every (question, dept) pair in this year (excl PS Total)
    all_rows = _q(  # noqa: S608
        f"SELECT r.question, r.dept_e, "
        f"ROUND(SUM(CASE WHEN r.question_value_e IN ({ph}) THEN r.shr_w_resp ELSE 0 END)*100) AS positive_pct, "
        f"MAX(r.total_w_resp) AS n_respondents "
        f"FROM snps_responses r WHERE r.year = ? AND r.dept_e != ? "
        f"GROUP BY r.question, r.dept_e",
        [*positive_vals, year, PS_TOTAL_DEPT],
    )
    # PS Total rows separately
    ps_rows = _q(  # noqa: S608
        f"SELECT question, "
        f"ROUND(SUM(CASE WHEN question_value_e IN ({ph}) THEN shr_w_resp ELSE 0 END)*100) AS positive_pct "
        f"FROM snps_responses WHERE year = ? AND dept_e = ? GROUP BY question",
        [*positive_vals, year, PS_TOTAL_DEPT],
    )
    # Question metadata — browse-year-then-latest-year fallback (same as /questions)
    meta_rows = _q("SELECT MAX(year) AS y FROM snps_questions")
    meta_year = meta_rows[0]["y"] if meta_rows else year
    questions_meta = _q(
        "SELECT q.question, q.category_e, q.category_f, q.theme_e, q.theme_f, q.question_e, q.question_f "
        "FROM snps_questions q "
        "WHERE q.year = ? AND EXISTS (SELECT 1 FROM snps_responses r WHERE r.question=q.question AND r.year=?) "
        "UNION "
        "SELECT q2.question, q2.category_e, q2.category_f, q2.theme_e, q2.theme_f, q2.question_e, q2.question_f "
        "FROM snps_questions q2 "
        "WHERE q2.year = ? AND EXISTS (SELECT 1 FROM snps_responses r WHERE r.question=q2.question AND r.year=?) "
        "  AND NOT EXISTS (SELECT 1 FROM snps_questions qb WHERE qb.year=? AND qb.question=q2.question) "
        "ORDER BY question",
        [year, year, meta_year, year, year],
    )

    tier_label, peer_snps = _resolve_snps_peers(dept, year)
    peer_set = set(peer_snps)
    ps_by_q = {r["question"]: r["positive_pct"] for r in ps_rows}

    dept_data: dict[str, list[dict]] = defaultdict(list)
    for r in all_rows:
        dept_data[r["question"]].append(r)

    result = []
    for meta in questions_meta:
        if meta["theme_e"] == "Demographic characteristics":
            continue
        q_code = meta["question"]
        rows_q = dept_data.get(q_code, [])
        dept_row = next((r for r in rows_q if r["dept_e"] == dept), None)
        if dept_row is None:
            continue
        dp = dept_row["positive_pct"]
        peer_vals = [r["positive_pct"] for r in rows_q if r["dept_e"] in peer_set and r["positive_pct"] is not None]
        all_pcts = sorted([r["positive_pct"] for r in rows_q if r["positive_pct"] is not None], reverse=True)
        result.append({
            "question":      q_code,
            "theme_e":       meta["theme_e"],
            "theme_f":       meta["theme_f"],
            "category_e":    meta["category_e"],
            "question_e":    meta["question_e"],
            "question_f":    meta["question_f"],
            "dept_pct":      dp,
            "ps_pct":        ps_by_q.get(q_code),
            "peer_avg_pct":  round(sum(peer_vals) / len(peer_vals), 1) if peer_vals else None,
            "peer_count":    len(peer_vals),
            "tier_label":    tier_label,
            "rank_all":      (all_pcts.index(dp) + 1) if dp in all_pcts else None,
            "total_depts":   len(all_pcts),
            "n_respondents": dept_row["n_respondents"],
            "year":          year,
        })
    result.sort(key=lambda r: (r["theme_e"] or "", r["question"]))
    return result
