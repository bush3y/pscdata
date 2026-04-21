from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from app.database import get_write_conn
from app.models.responses import IngestResult
from app.services.ckan import CKANClient

logger = logging.getLogger(__name__)

# ── Column mapping helpers ────────────────────────────────────────────────────

# Known column-name variants → canonical schema column names for raw_advertisements
_ADV_COL_MAP: dict[str, str] = {
    "fiscal_year": "fiscal_year",
    "car_chc_id": "car_chc_id",
    "reference_number": "reference_number",
    "selection_process_number": "selection_process_number",
    "creation_date": "creation_date",
    "open_date": "open_date",
    "close_date": "close_date",
    "number_days_open": "number_days_open",
    "internal_indicator": "internal_indicator",
    "external_indicator": "external_indicator",
    "position_title_english": "position_title_e",
    "position_title_french": "position_title_f",
    "position_title_e": "position_title_e",
    "position_title_f": "position_title_f",
    "classifications": "classifications",
    "classification": "classifications",
    "administrator_region_english": "administrator_region_e",
    "administrator_region_french": "administrator_region_f",
    "administrator_region_e": "administrator_region_e",
    "administrator_region_f": "administrator_region_f",
    "advertisement_type_english": "advertisement_type_e",
    "advertisement_type_french": "advertisement_type_f",
    "advertisement_type_e": "advertisement_type_e",
    "advertisement_type_f": "advertisement_type_f",
    "organization_english": "organization_e",
    "organization_french": "organization_f",
    "organization_e": "organization_e",
    "organization_f": "organization_f",
    "organization_code": "organization_code",
    "province_name_english": "province_name_e",
    "province_name_french": "province_name_f",
    "province_name_e": "province_name_e",
    "province_name_f": "province_name_f",
    "recruitment_program_english": "recruitment_program_e",
    "recruitment_program_french": "recruitment_program_f",
    "recruitment_program_e": "recruitment_program_e",
    "recruitment_program_f": "recruitment_program_f",
    "status_english": "status_e",
    "status_french": "status_f",
    "status_e": "status_e",
    "status_f": "status_f",
    "indeterminate": "indeterminate",
    "specified_term": "specified_term",
    "acting": "acting",
    "assignment": "assignment",
    "deployment": "deployment",
    "secondment": "secondment",
    "advertisement_url_e": "advertisement_url_e",
    "advertisement_url_f": "advertisement_url_f",
    "city_name_e": "city_name_e",
    "city_name_f": "city_name_f",
    "total_submitted_sup": "total_submitted_sup",
    "total_submitted": "total_submitted_sup",
    "total_in_sup": "total_in_sup",
    "total_screened_in": "total_in_sup",
    "total_out_sup": "total_out_sup",
    "caf_in": "caf_in",
    "total_caf": "caf_in",
    "women_submitted_sup": "women_submitted_sup",
    "vismin_submitted_sup": "vismin_submitted_sup",
    "indigenous_submitted_sup": "indigenous_submitted_sup",
    "pwd_submitted_sup": "pwd_submitted_sup",
    "french_submitted_sup": "french_submitted_sup",
    "english_submitted_sup": "english_submitted_sup",
}

_ADV_SCHEMA_COLS = [
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
]


def _normalize_df(df: pd.DataFrame, col_map: dict[str, str], schema_cols: list[str]) -> pd.DataFrame:
    """Rename columns using *col_map* and align to *schema_cols*.

    Columns not present in the source are added as NULL.  Extra columns are dropped.
    """
    df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})
    # Drop duplicate columns that map to same target
    df = df.loc[:, ~df.columns.duplicated()]
    # Add missing schema columns as None
    for col in schema_cols:
        if col not in df.columns:
            df[col] = None
    # Select only schema columns in order
    df = df[schema_cols].copy()
    # Replace blank/whitespace strings and suppression markers with NaN
    return df.replace(r"^\s*$|^\*+$", float("nan"), regex=True)


def _log_id() -> int:
    """Generate a rough unique ID for ingest_log rows."""
    import time
    return int(time.time() * 1000) % (2**31)


# ── Ingestor class ─────────────────────────────────────────────────────────────

class DataIngestor:
    def __init__(self, ckan_client: CKANClient) -> None:
        self._ckan = ckan_client

    # ── helpers ───────────────────────────────────────────────────────────────

    async def _log_start(self, conn: Any, log_id: int, dataset_key: str, resource_name: str, url: str) -> None:
        conn.execute(
            """INSERT INTO ingest_log (id, dataset_key, resource_name, resource_url, status, started_at)
               VALUES (?, ?, ?, ?, 'running', ?)""",
            [log_id, dataset_key, resource_name, url, datetime.now(timezone.utc)],
        )

    async def _log_finish(
        self, conn: Any, log_id: int, status: str, rows: int = 0, error: str | None = None
    ) -> None:
        conn.execute(
            """UPDATE ingest_log
               SET status = ?, rows_loaded = ?, error_message = ?, finished_at = ?
               WHERE id = ?""",
            [status, rows, error, datetime.now(timezone.utc), log_id],
        )

    async def _insert_df(self, conn: Any, table: str, df: pd.DataFrame) -> int:
        """Insert a DataFrame into *table* using DuckDB's native df ingestion.

        Only inserts columns that exist in both the DataFrame and the table,
        so extra CSV columns are silently dropped and missing ones become NULL.
        """
        table_cols = conn.execute(f"PRAGMA table_info('{table}')").df()["name"].tolist()  # noqa: S608
        shared = [c for c in table_cols if c in df.columns]
        col_sql = ", ".join(f'"{c}"' for c in shared)
        conn.execute(f"INSERT INTO {table} ({col_sql}) SELECT {col_sql} FROM df")  # noqa: S608
        return len(df)

    # ── public API ────────────────────────────────────────────────────────────

    async def ingest_all(self) -> list[IngestResult]:
        results = []
        for method in (
            self.ingest_advertisements,
            self.ingest_staffing_dashboard,
            self.ingest_tbs_population,
            self.ingest_snps,
        ):
            try:
                result = await method()
                results.append(result)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Ingest method %s failed: %s", method.__name__, exc)
                results.append(IngestResult(dataset_key=method.__name__, status="error", error_message=str(exc)))
        return results

    async def ingest_advertisements(self) -> IngestResult:
        dataset_key = "advertisements"
        from app.config import settings

        resources = await self._ckan.list_csv_resources(settings.DATASET_IDS[dataset_key])
        total_rows = 0

        async with get_write_conn() as conn:
            conn.execute("TRUNCATE raw_advertisements")
            for res in resources:
                # Skip non-data resources
                name_lower = res["name"].lower()
                if any(ext in name_lower for ext in (".docx", ".html", "readme", "guide", "lisez")):
                    continue

                log_id = _log_id()
                await self._log_start(conn, log_id, dataset_key, res["name"], res["url"])
                try:
                    df = await self._ckan.download_csv(res["url"])
                    df = _normalize_df(df, _ADV_COL_MAP, _ADV_SCHEMA_COLS)
                    df = df.drop_duplicates()
                    df["_loaded_at"] = datetime.now(timezone.utc)
                    rows = await self._insert_df(conn, "raw_advertisements", df)
                    total_rows += rows
                    await self._log_finish(conn, log_id, "success", rows)
                    logger.info("Loaded %d rows into raw_advertisements from '%s'", rows, res["name"])
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Failed to ingest advertisement resource '%s': %s", res["name"], exc)
                    await self._log_finish(conn, log_id, "error", error=str(exc))

        return IngestResult(dataset_key=dataset_key, status="success", rows_loaded=total_rows)

    async def ingest_staffing_dashboard(self) -> IngestResult:
        dataset_key = "staffing_dashboard"
        from app.config import settings

        # Pattern → target table mapping (regex patterns matched against resource name)
        table_patterns: list[tuple[str, str]] = [
            (r"inflow", "dash_inflow"),
            (r"outflow", "dash_outflow"),
            (r"internal.mobility|mobility", "dash_internal_mobility"),
            (r"adv.type|advertisement.type", "dash_adv_type"),
            # "Advertisements" CSV (program × days breakdown) — "advertisements" has no "type" suffix
            (r"advertisements", "dash_advertisements"),
            (r"ee|employment.equity", "dash_demo_ee"),
            (r"\bage\b", "dash_demo_age"),          # word boundary avoids matching "language"
            (r"region", "dash_demo_region"),
            (r"group|occupation", "dash_demo_group"),
            (r"fol|first.official.language", "dash_demo_fol"),
            # Priority & Veterans tables — matched before generic catch-alls
            (r"\bpriority\b", "dash_priority"),
            (r"reappointment", "dash_reappointments"),
            (r"veterans.*\b1\b|vha.?1", "dash_vha_1"),
            (r"veterans.*\b2\b|vha.?2", "dash_vha_2"),
            (r"veterans.*\b3\b|vha.?3", "dash_vha_3"),
        ]

        # Column renames needed because some CSVs use different names than the schema
        _col_renames: dict[str, dict[str, str]] = {
            "dash_demo_ee": {"ee_e": "ee_group_e", "ee_f": "ee_group_f"},
            "dash_demo_group": {"class_e": "occ_group_e", "class_f": "occ_group_f"},
            # CSV has typo: "sumbitted" instead of "submitted"
            "dash_advertisements": {
                "appl_sumbitted_mean":     "appl_submitted_mean",
                "qtr_appl_sumbitted_mean": "qtr_appl_submitted_mean",
                "appl_sumbitted_sum":      "appl_submitted_sum",
                "qtr_appl_sumbitted_sum":  "qtr_appl_submitted_sum",
            },
            # priority.csv: 'N' column is the count; processing_date_traitement → processing_date
            "dash_priority": {
                "n":                         "count",
                "processing_date_traitement": "processing_date",
            },
            # reappointments may also have the long date column name
            "dash_reappointments": {
                "processing_date_traitement": "processing_date",
            },
            # VHA tables share the same date column rename
            "dash_vha_1": {"processing_date_traitement": "processing_date"},
            "dash_vha_2": {"processing_date_traitement": "processing_date"},
            "dash_vha_3": {"processing_date_traitement": "processing_date"},
        }

        resources = await self._ckan.list_csv_resources(settings.DATASET_IDS[dataset_key])
        total_rows = 0

        async with get_write_conn() as conn:
            for res in resources:
                name_lower = res["name"].lower()
                target_table: str | None = None
                for pattern, table in table_patterns:
                    if re.search(pattern, name_lower):
                        target_table = table
                        break

                if target_table is None:
                    logger.debug("Skipping staffing resource '%s' — no table match", res["name"])
                    continue

                log_id = _log_id()
                await self._log_start(conn, log_id, dataset_key, res["name"], res["url"])
                try:
                    df = await self._ckan.download_csv(res["url"])
                    df.columns = [c.lower().replace(" ", "_") for c in df.columns]
                    if target_table in _col_renames:
                        df = df.rename(columns=_col_renames[target_table])
                    df = df.replace(r"^\s*$|^\*+$", float("nan"), regex=True)
                    # vha_3 count column may be formatted with commas (e.g. "7,348")
                    if target_table == "dash_vha_3" and "count" in df.columns:
                        df["count"] = (
                            df["count"].astype(str)
                            .str.replace(",", "", regex=False)
                            .replace("nan", float("nan"))
                        )
                    df["_loaded_at"] = datetime.now(timezone.utc)

                    conn.execute(f"TRUNCATE {target_table}")  # noqa: S608
                    rows = await self._insert_df(conn, target_table, df)
                    total_rows += rows
                    await self._log_finish(conn, log_id, "success", rows)
                    logger.info("Loaded %d rows into %s from '%s'", rows, target_table, res["name"])
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Failed to ingest staffing resource '%s': %s", res["name"], exc)
                    await self._log_finish(conn, log_id, "error", error=str(exc))

        return IngestResult(dataset_key=dataset_key, status="success", rows_loaded=total_rows)

    async def ingest_tbs_population(self) -> IngestResult:
        """Ingest TBS Federal Public Service Statistics (headcount by dept and tenure)."""
        dataset_key = "tbs_population"
        from app.config import settings

        # Only fetch the two EN CSVs we need — matched against resource name (lowercased)
        # FR resources contain "ministere" or "effectif" — skip them
        table_patterns: list[tuple[str, str]] = [
            (r"department.or.agency",  "tbs_pop_dept"),
            (r"department.and.tenure", "tbs_pop_tenure"),
        ]

        # After download_csv normalises columns to lowercase+underscore:
        #   "department_or_agency" → dept_e
        #   "number_of_employees"  → count
        #   "tenure"               → tenure_e
        _col_renames = {
            "department_or_agency": "dept_e",
            "number_of_employees":  "count",
            "tenure":               "tenure_e",
        }

        resources = await self._ckan.list_csv_resources(settings.DATASET_IDS[dataset_key])
        total_rows = 0

        async with get_write_conn() as conn:
            for res in resources:
                name_lower = res["name"].lower()
                target_table: str | None = None
                for pattern, table in table_patterns:
                    if re.search(pattern, name_lower):
                        target_table = table
                        break

                if target_table is None:
                    logger.debug("Skipping TBS resource '%s' — no table match", res["name"])
                    continue

                # Skip French resources (URL or name contains French keywords)
                url_lower = res["url"].lower()
                if any(k in name_lower or k in url_lower for k in ("ministere", "effectif", "duree")):
                    logger.debug("Skipping TBS French resource '%s'", res["name"])
                    continue

                log_id = _log_id()
                await self._log_start(conn, log_id, dataset_key, res["name"], res["url"])
                try:
                    df = await self._ckan.download_csv(res["url"])
                    df = df.rename(columns={k: v for k, v in _col_renames.items() if k in df.columns})
                    df = df.replace(r"^\s*$|^\*+$", float("nan"), regex=True)
                    df["_loaded_at"] = datetime.now(timezone.utc)

                    conn.execute(f"TRUNCATE {target_table}")  # noqa: S608
                    rows = await self._insert_df(conn, target_table, df)
                    total_rows += rows
                    await self._log_finish(conn, log_id, "success", rows)
                    logger.info("Loaded %d rows into %s from '%s'", rows, target_table, res["name"])
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Failed to ingest TBS resource '%s': %s", res["name"], exc)
                    await self._log_finish(conn, log_id, "error", error=str(exc))

        return IngestResult(dataset_key=dataset_key, status="success", rows_loaded=total_rows)

    async def ingest_snps(self) -> IngestResult:
        """Ingest SNPS responses, questions, and response profiles for 2021, 2023, 2025."""
        dataset_key = "snps"
        from app.config import settings

        total_rows = 0

        async with get_write_conn() as conn:
            conn.execute("TRUNCATE snps_responses")
            conn.execute("TRUNCATE snps_questions")
            conn.execute("TRUNCATE snps_response_profile")

            for year, ckan_id in settings.SNPS_DATASET_IDS.items():
                resources = await self._ckan.list_csv_resources(ckan_id)

                for res in resources:
                    name_lower = res["name"].lower()

                    # Match only the three CSVs we need; skip docs and demographic breakdowns
                    if re.search(r"snps.?01", name_lower):
                        target_table = "snps_responses"
                    elif re.search(r"snps.?13", name_lower):
                        target_table = "snps_response_profile"
                    elif re.search(r"snps.?14", name_lower):
                        target_table = "snps_questions"
                    else:
                        continue

                    if any(ext in name_lower for ext in (".docx", ".html", ".xlsx")):
                        continue

                    log_id = _log_id()
                    await self._log_start(conn, log_id, dataset_key, res["name"], res["url"])
                    try:
                        df = await self._ckan.download_csv(res["url"])
                        df.columns = [c.lower().replace(" ", "_") for c in df.columns]
                        df = df.replace(r"^\s*$|^\*+$", float("nan"), regex=True)

                        if target_table == "snps_responses":
                            if "question_value_e" in df.columns:
                                mask = df["question_value_e"].str.lower().str.contains(
                                    r"all respondents|tous les r", na=False, regex=True
                                )
                                df = df[~mask]

                        elif target_table == "snps_response_profile":
                            df = df.rename(columns={"n": "count"})

                        df["year"] = year
                        df["_loaded_at"] = datetime.now(timezone.utc)
                        rows = await self._insert_df(conn, target_table, df)
                        total_rows += rows
                        await self._log_finish(conn, log_id, "success", rows)
                        logger.info(
                            "Loaded %d rows into %s from '%s' (year=%d)",
                            rows, target_table, res["name"], year,
                        )
                    except Exception as exc:  # noqa: BLE001
                        logger.exception(
                            "Failed to ingest SNPS resource '%s' (year=%d): %s",
                            res["name"], year, exc,
                        )
                        await self._log_finish(conn, log_id, "error", error=str(exc))

        return IngestResult(dataset_key=dataset_key, status="success", rows_loaded=total_rows)
