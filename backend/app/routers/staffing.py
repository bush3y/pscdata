from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from app.database import query_to_records

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/staffing", tags=["staffing"])

_DEMO_TABLE_MAP = {
    "ee":  "dash_demo_ee",
    "age": "dash_demo_age",
    "region": "dash_demo_region",
    "group": "dash_demo_group",
    "fol": "dash_demo_fol",
}


def _build_common_where(
    fiscal_year: list[str] | None,
    quarter: str | None,
    department: str | None,
) -> tuple[str, list]:
    conditions: list[str] = []
    params: list = []

    if fiscal_year:
        placeholders = ", ".join(["?" for _ in fiscal_year])
        conditions.append(f"fiscal_year IN ({placeholders})")
        params.extend(fiscal_year)

    if quarter:
        conditions.append("quarter = ?")
        params.append(quarter)

    if department:
        conditions.append("(department_e ILIKE ? OR department_f ILIKE ?)")
        params.extend([f"%{department}%", f"%{department}%"])
    else:
        # Use the pre-aggregated national total row to avoid double-counting
        # individual department rows alongside roll-up rows.
        conditions.append("department_e = 'Public Service - Total'")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    return where, params


@router.get("/summary")
async def get_summary() -> dict:
    """Returns last 2 fiscal years for PSC dashboard key metrics.

    Metrics match the PSC Staffing Dashboard summary panel:
      - Advertisements & Applications (all programs)
      - New Indeterminate appointments (inflow)
      - Separations (total outflow)
      - Promotions, Lateral/downward, Acting (internal mobility breakdown)

    Current year is always labelled FYTD because PSC open data publishes a
    single annual snapshot per fiscal year (the latest FYTD figure available).
    """

    def totals(sql: str, params: list | None = None) -> list[dict]:
        return query_to_records(sql, params or None)

    # Detect the current FYTD quarter from the staffing tables first so we
    # can filter raw_advertisements to the same date window.
    max_year_rows_pre = query_to_records(
        """
        SELECT MAX(fiscal_year) AS max_fy, quarter
        FROM dash_inflow
        WHERE department_e = 'Public Service - Total'
          AND fiscal_year = (SELECT MAX(fiscal_year) FROM dash_inflow
                             WHERE department_e = 'Public Service - Total')
        GROUP BY quarter
        LIMIT 1
        """
    )
    _quarter_map = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}
    _quarter_end_month = {1: (6, 30), 2: (9, 30), 3: (12, 31), 4: (3, 31)}

    cur_fy   = max_year_rows_pre[0]["max_fy"] if max_year_rows_pre else None
    cur_q    = _quarter_map.get(str(max_year_rows_pre[0]["quarter"] or ""), 1) if max_year_rows_pre else 1
    fy_start_year = int(cur_fy.split("-")[0]) if cur_fy else 2025

    end_month, end_day = _quarter_end_month[cur_q]
    # Q4 wraps into the next calendar year
    end_year = fy_start_year + 1 if end_month <= 3 else fy_start_year
    adv_start = f"{fy_start_year}-04-01"
    adv_end   = f"{end_year}-{end_month:02d}-{end_day:02d}"

    # Current year: filter raw_advertisements to the same FYTD date window as staffing tables
    # Previous year: full year (the ÷4 × q_count normalization in the frontend handles it)
    prev_fy      = f"{fy_start_year - 1}-{fy_start_year}"
    prev_prev_fy = f"{fy_start_year - 2}-{fy_start_year - 1}"
    adv_count_sql = f"""
        SELECT fiscal_year, COUNT(*) AS ads
        FROM raw_advertisements
        WHERE recruitment_program_e IN ('INT', 'JOP')
          AND (
            (fiscal_year = '{cur_fy}'      AND open_date >= '{adv_start}' AND open_date <= '{adv_end}')
            OR fiscal_year = '{prev_fy}'
            OR fiscal_year = '{prev_prev_fy}'
          )
        GROUP BY fiscal_year
        ORDER BY fiscal_year DESC
    """  # noqa: S608

    adv_apps_sql = """
        SELECT fiscal_year, SUM(appl_submitted_sum) AS applications,
               SUM(qtr_appl_submitted_sum) AS qtr_total
        FROM dash_advertisements
        WHERE department_e = 'Public Service - Total'
          AND days_cat_e = 'Total'
        GROUP BY fiscal_year
        ORDER BY fiscal_year DESC
        LIMIT 3
    """

    # New Indeterminate inflow
    new_ind_sql = """
        SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total
        FROM dash_inflow
        WHERE department_e = 'Public Service - Total'
          AND hire_e = 'New Indeterminate'
        GROUP BY fiscal_year
        ORDER BY fiscal_year DESC
        LIMIT 3
    """

    # Total separations
    sep_sql = """
        SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total
        FROM dash_outflow
        WHERE department_e = 'Public Service - Total'
        GROUP BY fiscal_year
        ORDER BY fiscal_year DESC
        LIMIT 3
    """

    # Mobility by type (3 years so sub-card can show prev full-year vs prior full-year)
    mob_sql = """
        SELECT fiscal_year, mob_type_e, SUM(count) AS total, SUM(qtr_count) AS qtr_total
        FROM dash_internal_mobility
        WHERE department_e = 'Public Service - Total'
          AND mob_type_e IN ('Promotion', 'Lateral or downward', 'Acting')
          AND fiscal_year IN (
            SELECT DISTINCT fiscal_year FROM dash_internal_mobility
            WHERE department_e = 'Public Service - Total'
            ORDER BY fiscal_year DESC LIMIT 3
          )
        GROUP BY fiscal_year, mob_type_e
        ORDER BY fiscal_year DESC, mob_type_e
    """

    adv_count_rows = totals(adv_count_sql)
    adv_apps_rows  = totals(adv_apps_sql)
    new_ind_rows   = totals(new_ind_sql)
    sep_rows       = totals(sep_sql)
    mob_rows       = totals(mob_sql)

    q_count = cur_q  # already derived above from max_year_rows_pre

    # Pivot mobility rows into {fiscal_year: {mob_type: {total, qtr_total}}}
    mob_pivot: dict[str, dict[str, dict]] = {}
    for r in mob_rows:
        fy = r["fiscal_year"]
        if fy not in mob_pivot:
            mob_pivot[fy] = {}
        mob_pivot[fy][r["mob_type_e"]] = {
            "total": r["total"] or 0,
            "qtr_total": r["qtr_total"] or 0,
        }

    # Build per-type series (last 3 years, desc)
    mob_years = sorted(mob_pivot.keys(), reverse=True)[:3]

    def mob_series(mob_type: str) -> list[dict]:
        return [
            {
                "fiscal_year": fy,
                "total":     mob_pivot.get(fy, {}).get(mob_type, {}).get("total", 0),
                "qtr_total": mob_pivot.get(fy, {}).get(mob_type, {}).get("qtr_total", 0),
            }
            for fy in mob_years
        ]

    return {
        "q_count":         q_count,
        "advertisements":  [{"fiscal_year": r["fiscal_year"], "total": r["ads"]}           for r in adv_count_rows],
        "applications":    [{"fiscal_year": r["fiscal_year"], "total": r["applications"], "qtr_total": r["qtr_total"]}  for r in adv_apps_rows],
        "new_indeterminate": new_ind_rows,
        "separations":     sep_rows,
        "promotions":      mob_series("Promotion"),
        "lateral":         mob_series("Lateral or downward"),
        "acting":          mob_series("Acting"),
    }


@router.get("/inflow")
async def get_inflow(
    fiscal_year: list[str] | None = Query(default=None),
    quarter: str | None = None,
    department: str | None = None,
) -> list[dict]:
    where, params = _build_common_where(fiscal_year, quarter, department)
    return query_to_records(
        f"SELECT * FROM dash_inflow {where} ORDER BY fiscal_year, quarter",  # noqa: S608
        params or None,
    )


@router.get("/outflow")
async def get_outflow(
    fiscal_year: list[str] | None = Query(default=None),
    quarter: str | None = None,
    department: str | None = None,
) -> list[dict]:
    where, params = _build_common_where(fiscal_year, quarter, department)
    return query_to_records(
        f"SELECT * FROM dash_outflow {where} ORDER BY fiscal_year, quarter",  # noqa: S608
        params or None,
    )


@router.get("/adv-type")
async def get_adv_type(
    fiscal_year: list[str] | None = Query(default=None),
    department: str | None = None,
) -> list[dict]:
    conditions: list[str] = []
    params: list = []

    if fiscal_year:
        placeholders = ", ".join(["?" for _ in fiscal_year])
        conditions.append(f"fiscal_year IN ({placeholders})")
        params.extend(fiscal_year)

    if department:
        conditions.append("(department_e ILIKE ? OR department_f ILIKE ?)")
        params.extend([f"%{department}%", f"%{department}%"])

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    return query_to_records(
        f"SELECT * FROM dash_adv_type {where} ORDER BY fiscal_year",  # noqa: S608
        params or None,
    )


@router.get("/mobility")
async def get_mobility(
    fiscal_year: list[str] | None = Query(default=None),
    quarter: str | None = None,
    department: str | None = None,
) -> list[dict]:
    where, params = _build_common_where(fiscal_year, quarter, department)
    return query_to_records(
        f"SELECT * FROM dash_internal_mobility {where} ORDER BY fiscal_year, quarter",  # noqa: S608
        params or None,
    )


@router.get("/priority")
async def get_priority() -> list[dict]:
    """Snapshot of current priority persons by province and classification."""
    return query_to_records("SELECT * FROM dash_priority ORDER BY province_e, class_e")


@router.get("/reappointments")
async def get_reappointments(
    fiscal_year: list[str] | None = Query(default=None),
    department: str | None = None,
) -> list[dict]:
    conditions: list[str] = []
    params: list = []

    if fiscal_year:
        placeholders = ", ".join(["?" for _ in fiscal_year])
        conditions.append(f"fiscal_year IN ({placeholders})")
        params.extend(fiscal_year)

    if department:
        conditions.append("(department_e ILIKE ? OR department_f ILIKE ?)")
        params.extend([f"%{department}%", f"%{department}%"])
    else:
        conditions.append("department_e = 'Public Service - Total'")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    return query_to_records(
        f"SELECT * FROM dash_reappointments {where} ORDER BY fiscal_year",  # noqa: S608
        params or None,
    )


@router.get("/vha/{table_num}")
async def get_vha(
    table_num: int,
    fiscal_year: list[str] | None = Query(default=None),
) -> list[dict]:
    if table_num not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="table_num must be 1, 2, or 3")

    table = f"dash_vha_{table_num}"
    conditions: list[str] = []
    params: list = []

    if fiscal_year:
        placeholders = ", ".join(["?" for _ in fiscal_year])
        conditions.append(f"fiscal_year IN ({placeholders})")
        params.extend(fiscal_year)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    return query_to_records(
        f"SELECT * FROM {table} {where} ORDER BY fiscal_year",  # noqa: S608
        params or None,
    )


@router.get("/departments")
async def get_departments() -> list[str]:
    """Sorted list of department names available in the staffing tables."""
    rows = query_to_records(
        "SELECT DISTINCT department_e FROM dash_inflow "
        "WHERE department_e != 'Public Service - Total' AND department_e IS NOT NULL "
        "ORDER BY department_e"
    )
    return [r["department_e"] for r in rows]


@router.get("/population")
async def get_population(department: str | None = None) -> dict:
    """TBS headcount and tenure mix for a department or the whole public service.

    *department* must be an exact TBS department name (English).  When omitted,
    returns aggregated totals across all departments/universes.

    Year = March 31 snapshot — corresponds to PSC fiscal year (year-1)-(year).
    """
    def q(sql: str, params: list | None = None) -> list[dict]:
        return query_to_records(sql, params or None)

    # PSC-covered departments (used to constrain TBS PS Total to a comparable universe)
    _PSC_DEPT_SUBQUERY = (
        "SELECT DISTINCT department_e FROM dash_inflow "
        "WHERE department_e != 'Public Service - Total' AND department_e IS NOT NULL"
    )

    if department:
        headcount = q(
            "SELECT year, SUM(count) AS count FROM tbs_pop_dept "
            "WHERE dept_e = ? GROUP BY year ORDER BY year",
            [department],
        )
        tenure = q(
            "SELECT year, tenure_e, SUM(count) AS count FROM tbs_pop_tenure "
            "WHERE dept_e = ? GROUP BY year, tenure_e ORDER BY year, tenure_e",
            [department],
        )
        dept_names = q(
            "SELECT DISTINCT dept_e FROM tbs_pop_dept WHERE dept_e ILIKE ? ORDER BY dept_e",
            [f"%{department}%"],
        )
    else:
        # PS Total: only sum TBS departments that are also in the PSC staffing universe
        headcount = q(
            f"SELECT year, SUM(count) AS count FROM tbs_pop_dept "  # noqa: S608
            f"WHERE dept_e IN ({_PSC_DEPT_SUBQUERY}) "
            "GROUP BY year ORDER BY year"
        )
        tenure = q(
            f"SELECT year, tenure_e, SUM(count) AS count FROM tbs_pop_tenure "  # noqa: S608
            f"WHERE dept_e IN ({_PSC_DEPT_SUBQUERY}) "
            "GROUP BY year, tenure_e ORDER BY year, tenure_e"
        )
        dept_names = []

    return {
        "department": department,
        "matched_dept": dept_names[0]["dept_e"] if dept_names else department,
        "headcount": headcount,
        "tenure": tenure,
    }


@router.get("/department-overview")
async def get_department_overview(department: str | None = None) -> dict:
    """Bundled executive summary for a specific department or PS-Total.

    When *department* is None the response reflects 'Public Service - Total'.
    All KPI series include the last three fiscal years (DESC); trend series
    include all available years (ASC) for charting.
    """
    dept = department if department else "Public Service - Total"
    ps = "Public Service - Total"
    is_ps_total = dept == ps

    def q(sql: str, params: list | None = None) -> list[dict]:
        return query_to_records(sql, params or None)

    # Detect current FYTD quarter (from PS Total — consistent reference point)
    _quarter_map = {"Q1": 1, "Q2": 2, "Q3": 3, "Q4": 4}
    q_row = q(
        "SELECT quarter FROM dash_inflow "
        "WHERE department_e = 'Public Service - Total' "
        "  AND fiscal_year = (SELECT MAX(fiscal_year) FROM dash_inflow "
        "                     WHERE department_e = 'Public Service - Total') "
        "LIMIT 1"
    )
    q_count = _quarter_map.get(str(q_row[0]["quarter"] or ""), 1) if q_row else 1

    # ── KPIs (last 3 fiscal years) ──────────────────────────────────────────
    new_ind_dept = q(
        "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_inflow "
        "WHERE department_e = ? AND hire_e = 'New Indeterminate' "
        "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        [dept],
    )
    sep_dept = q(
        "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_outflow "
        "WHERE department_e = ? "
        "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        [dept],
    )
    promo_dept = q(
        "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_internal_mobility "
        "WHERE department_e = ? AND mob_type_e = 'Promotion' "
        "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        [dept],
    )
    acting_dept = q(
        "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_internal_mobility "
        "WHERE department_e = ? AND mob_type_e = 'Acting' "
        "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        [dept],
    )
    lateral_dept = q(
        "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_internal_mobility "
        "WHERE department_e = ? AND mob_type_e = 'Lateral or downward' "
        "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        [dept],
    )

    if not is_ps_total:
        new_ind_ps = q(
            "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_inflow "
            "WHERE department_e = 'Public Service - Total' AND hire_e = 'New Indeterminate' "
            "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        )
        sep_ps = q(
            "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_outflow "
            "WHERE department_e = 'Public Service - Total' "
            "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        )
        promo_ps = q(
            "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_internal_mobility "
            "WHERE department_e = 'Public Service - Total' AND mob_type_e = 'Promotion' "
            "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        )
        acting_ps = q(
            "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_internal_mobility "
            "WHERE department_e = 'Public Service - Total' AND mob_type_e = 'Acting' "
            "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        )
        lateral_ps = q(
            "SELECT fiscal_year, SUM(count) AS total, SUM(qtr_count) AS qtr_total FROM dash_internal_mobility "
            "WHERE department_e = 'Public Service - Total' AND mob_type_e = 'Lateral or downward' "
            "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        )
    else:
        new_ind_ps = new_ind_dept
        sep_ps     = sep_dept
        promo_ps   = promo_dept
        acting_ps  = acting_dept
        lateral_ps = lateral_dept

    # ── Workforce trend (all available years) ───────────────────────────────
    inflow_trend = q(
        "SELECT fiscal_year, SUM(count) AS total FROM dash_inflow "
        "WHERE department_e = ? GROUP BY fiscal_year ORDER BY fiscal_year",
        [dept],
    )
    outflow_trend = q(
        "SELECT fiscal_year, SUM(count) AS total FROM dash_outflow "
        "WHERE department_e = ? GROUP BY fiscal_year ORDER BY fiscal_year",
        [dept],
    )

    # ── Hire type breakdown (all years) ─────────────────────────────────────
    inflow_by_type = q(
        "SELECT fiscal_year, hire_e, SUM(count) AS count FROM dash_inflow "
        "WHERE department_e = ? GROUP BY fiscal_year, hire_e ORDER BY fiscal_year, hire_e",
        [dept],
    )

    # ── Internal mobility trend (all types, all years) ───────────────────────
    mobility_trend = q(
        "SELECT fiscal_year, mob_type_e, SUM(count) AS count "
        "FROM dash_internal_mobility WHERE department_e = ? "
        "GROUP BY fiscal_year, mob_type_e ORDER BY fiscal_year, mob_type_e",
        [dept],
    )

    # ── Age snapshot (latest available year) ─────────────────────────────────
    age_dept = q(
        "SELECT age_group_e, SUM(count) AS count FROM dash_demo_age "
        "WHERE department_e = ? "
        "  AND fiscal_year = (SELECT MAX(fiscal_year) FROM dash_demo_age WHERE department_e = ?) "
        "GROUP BY age_group_e ORDER BY age_group_e",
        [dept, dept],
    )
    if not is_ps_total:
        age_ps = q(
            "SELECT age_group_e, SUM(count) AS count FROM dash_demo_age "
            "WHERE department_e = 'Public Service - Total' "
            "  AND fiscal_year = (SELECT MAX(fiscal_year) FROM dash_demo_age "
            "                     WHERE department_e = 'Public Service - Total') "
            "GROUP BY age_group_e ORDER BY age_group_e",
        )
    else:
        age_ps = age_dept

    # ── Applications (from dash_advertisements, all programs) ────────────────
    apps_dept = q(
        "SELECT fiscal_year, SUM(appl_submitted_sum) AS total, "
        "SUM(qtr_appl_submitted_sum) AS qtr_total "
        "FROM dash_advertisements "
        "WHERE department_e = ? AND days_cat_e = 'Total' "
        "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        [dept],
    )
    apps_trend = q(
        "SELECT fiscal_year, SUM(appl_submitted_sum) AS total "
        "FROM dash_advertisements "
        "WHERE department_e = ? AND days_cat_e = 'Total' "
        "GROUP BY fiscal_year ORDER BY fiscal_year",
        [dept],
    )
    if not is_ps_total:
        apps_ps = q(
            "SELECT fiscal_year, SUM(appl_submitted_sum) AS total, "
            "SUM(qtr_appl_submitted_sum) AS qtr_total "
            "FROM dash_advertisements "
            "WHERE department_e = 'Public Service - Total' AND days_cat_e = 'Total' "
            "GROUP BY fiscal_year ORDER BY fiscal_year DESC LIMIT 3",
        )
    else:
        apps_ps = apps_dept

    # ── Outflow by separation reason (all years) ─────────────────────────────
    outflow_by_reason = q(
        "SELECT fiscal_year, sep_reason_e, SUM(count) AS count "
        "FROM dash_outflow WHERE department_e = ? "
        "GROUP BY fiscal_year, sep_reason_e ORDER BY fiscal_year, sep_reason_e",
        [dept],
    )

    # ── Advertisement type breakdown (from dash_adv_type, all years) ─────────
    adv_by_type = q(
        "SELECT fiscal_year, adv_e, SUM(count) AS count "
        "FROM dash_adv_type WHERE department_e = ? "
        "GROUP BY fiscal_year, adv_e ORDER BY fiscal_year, adv_e",
        [dept],
    )

    # ── EE snapshot (latest available year for this dept) ───────────────────
    ee_dept = q(
        "SELECT ee_group_e, SUM(count) AS count FROM dash_demo_ee "
        "WHERE department_e = ? "
        "  AND fiscal_year = (SELECT MAX(fiscal_year) FROM dash_demo_ee WHERE department_e = ?) "
        "GROUP BY ee_group_e ORDER BY ee_group_e",
        [dept, dept],
    )
    if not is_ps_total:
        ee_ps = q(
            "SELECT ee_group_e, SUM(count) AS count FROM dash_demo_ee "
            "WHERE department_e = 'Public Service - Total' "
            "  AND fiscal_year = (SELECT MAX(fiscal_year) FROM dash_demo_ee "
            "                     WHERE department_e = 'Public Service - Total') "
            "GROUP BY ee_group_e ORDER BY ee_group_e",
        )
    else:
        ee_ps = ee_dept

    # ── Ranks + TBS headcount (for per-1,000 rates) ─────────────────────────
    # Rank only meaningful for specific departments (not PS Total)
    latest_fy = (
        (new_ind_dept[0]["fiscal_year"] if new_ind_dept else None)
        or (sep_dept[0]["fiscal_year"] if sep_dept else None)
    )

    def _rank(
        table: str, fy: str | None, extra_col: str | None, extra_val: str | None
    ) -> dict | None:
        """Rank *dept* among all departments by SUM(count) DESC for the given metric/year."""
        if fy is None or is_ps_total:
            return None
        conds = (
            "fiscal_year = ? AND department_e != 'Public Service - Total' "
            "AND department_e IS NOT NULL"
        )
        params_inner: list = [fy]
        if extra_col and extra_val:
            conds += f" AND {extra_col} = ?"
            params_inner.append(extra_val)
        rows = q(
            f"SELECT rnk, total_depts FROM ("  # noqa: S608
            f"  SELECT department_e,"
            f"         RANK() OVER (ORDER BY SUM(count) DESC) AS rnk,"
            f"         COUNT(*) OVER () AS total_depts"
            f"  FROM {table} WHERE {conds}"
            f"  GROUP BY department_e"
            f") sub WHERE department_e = ?",
            params_inner + [dept],
        )
        return rows[0] if rows else None

    ranks = {
        "new_indeterminate": _rank("dash_inflow",             latest_fy, "hire_e",       "New Indeterminate"),
        "separations":        _rank("dash_outflow",           latest_fy, None,            None),
        "promotions":         _rank("dash_internal_mobility", latest_fy, "mob_type_e",    "Promotion"),
        "acting":             _rank("dash_internal_mobility", latest_fy, "mob_type_e",    "Acting"),
        "lateral":            _rank("dash_internal_mobility", latest_fy, "mob_type_e",    "Lateral or downward"),
    }

    # TBS headcount — latest available year for this dept (for rate per 1,000)
    if not is_ps_total:
        hc_rows = q(
            "SELECT year, count FROM tbs_pop_dept "
            "WHERE dept_e = ? "
            "  AND year = (SELECT MAX(year) FROM tbs_pop_dept WHERE dept_e = ?)",
            [dept, dept],
        )
    else:
        hc_rows = q(
            "SELECT year, SUM(count) AS count FROM tbs_pop_dept "
            "WHERE dept_e IN ("
            "  SELECT DISTINCT department_e FROM dash_inflow "
            "  WHERE department_e != 'Public Service - Total' AND department_e IS NOT NULL"
            ") GROUP BY year ORDER BY year DESC LIMIT 1"
        )
    tbs_headcount = hc_rows[0] if hc_rows else None

    return {
        "department": dept,
        "is_ps_total": is_ps_total,
        "q_count": q_count,
        "kpis": {
            "new_indeterminate": {"dept": new_ind_dept, "ps": new_ind_ps},
            "separations":       {"dept": sep_dept,     "ps": sep_ps},
            "promotions":        {"dept": promo_dept,   "ps": promo_ps},
            "acting":            {"dept": acting_dept,  "ps": acting_ps},
            "lateral":           {"dept": lateral_dept, "ps": lateral_ps},
            "applications":      {"dept": apps_dept,    "ps": apps_ps},
        },
        "ranks":         ranks,
        "tbs_headcount": tbs_headcount,
        "workforce_trend":   {"inflow": inflow_trend, "outflow": outflow_trend},
        "inflow_by_type":    inflow_by_type,
        "mobility_trend":    mobility_trend,
        "applications_trend": apps_trend,
        "outflow_by_reason": outflow_by_reason,
        "adv_by_type":       adv_by_type,
        "ee_snapshot":       {"dept": ee_dept, "ps": ee_ps},
        "age_snapshot":      {"dept": age_dept, "ps": age_ps},
    }


_ADV_AGG_DIMS = {"program_e", "days_cat_e", "fiscal_year"}


@router.get("/adv-aggregate")
async def adv_aggregate(
    group_by: str,
    group_by2: str | None = None,
    fiscal_year: list[str] | None = Query(default=None),
    department: str | None = None,
) -> list[dict]:
    """Aggregate dash_advertisements by one or two dimensions for applications data."""
    if group_by not in _ADV_AGG_DIMS:
        raise HTTPException(400, detail=f"Invalid group_by: {group_by}")
    if group_by2 and group_by2 not in _ADV_AGG_DIMS:
        raise HTTPException(400, detail=f"Invalid group_by2: {group_by2}")

    dims = {group_by, group_by2} - {None}
    conditions: list[str] = [f"{group_by} IS NOT NULL"]
    params: list = []

    # Filter days_cat to avoid double-counting: use Total rows unless days_cat_e is a grouping dim
    if "days_cat_e" in dims:
        conditions.append("days_cat_e != 'Total'")
    else:
        conditions.append("days_cat_e = 'Total'")

    # Without a department filter use the pre-aggregated national total row to avoid
    # summing both individual department rows and the roll-up row.
    if department:
        conditions.append("(department_e ILIKE ? OR department_f ILIKE ?)")
        params.extend([f"%{department}%", f"%{department}%"])
    else:
        conditions.append("department_e = 'Public Service - Total'")

    if fiscal_year:
        placeholders = ", ".join("?" for _ in fiscal_year)
        conditions.append(f"fiscal_year IN ({placeholders})")
        params.extend(fiscal_year)

    where = f"WHERE {' AND '.join(conditions)}"

    if group_by2:
        sql = f"""
            SELECT {group_by} AS x, {group_by2} AS category, SUM(appl_submitted_sum) AS y
            FROM dash_advertisements {where}
            GROUP BY {group_by}, {group_by2}
            ORDER BY {group_by}, {group_by2}
        """  # noqa: S608
        return query_to_records(sql, params or None)

    sql = f"""
        SELECT {group_by} AS x, SUM(appl_submitted_sum) AS y
        FROM dash_advertisements {where}
        GROUP BY {group_by}
        ORDER BY {group_by}
    """  # noqa: S608
    return query_to_records(sql, params or None)


@router.get("/advertisements")
async def get_advertisements(
    fiscal_year: list[str] | None = Query(default=None),
    quarter: str | None = None,
    department: str | None = None,
) -> list[dict]:
    where, params = _build_common_where(fiscal_year, quarter, department)
    return query_to_records(
        f"SELECT * FROM dash_advertisements {where} ORDER BY fiscal_year, quarter",  # noqa: S608
        params or None,
    )


@router.get("/demographics/{dimension}")
async def get_demographics(
    dimension: str,
    fiscal_year: list[str] | None = Query(default=None),
    quarter: str | None = None,
    department: str | None = None,
    hire_e: str | None = None,
) -> list[dict]:
    table = _DEMO_TABLE_MAP.get(dimension)
    if not table:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown dimension '{dimension}'. Valid options: {list(_DEMO_TABLE_MAP.keys())}",
        )
    where, params = _build_common_where(fiscal_year, quarter, department)
    extra = " AND " if where else " WHERE "
    # Exclude spurious "check" row in region data
    region_filter = f"{extra}region_e != 'check'" if table == "dash_demo_region" else ""
    # Optional hire_e filter (age, region, group tables all have hire_e)
    hire_filter = ""
    if hire_e and table in ("dash_demo_age", "dash_demo_region", "dash_demo_group"):
        hire_filter = f"{extra if not region_filter else ' AND '}hire_e = ?"
        params = (params or []) + [hire_e]
    order = "fiscal_year, quarter" if table != "dash_demo_fol" else "fiscal_year"
    return query_to_records(
        f"SELECT * FROM {table} {where}{region_filter}{hire_filter} ORDER BY {order}",  # noqa: S608
        params or None,
    )
