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

    # Crosswalk: 2023/2021 old question codes -> canonical 2025 codes
    # Extracted from PSC snps12_a (Data Visualization Dataset) which harmonizes both years.
    # Codes with the same old/new value are identity mappings (code unchanged across years).
    SNPS_CODE_CROSSWALK: dict[str, str] = {
        "ED_05": "ED_01", "GEN_30": "GEN_05", "GEN_40": "GEN_08",
        "HMN_10": "HMN_01",
        "HMN_15B": "HMN_08A", "HMN_15D": "HMN_08B",
        "HMN_25A": "HMN_09_1", "HMN_25B": "HMN_09_2", "HMN_25C": "HMN_09_3",
        "HMN_25D": "HMN_09_4", "HMN_25E": "HMN_09_5", "HMN_25F": "HMN_09_6",
        "HMN_25G": "HMN_09_8", "HMN_30E": "HMN_10A",
        "HMN_35_1": "HMN_10B_1", "HMN_35_2": "HMN_10B_2", "HMN_35_3": "HMN_10B_3",
        "HMN_35_4": "HMN_10B_4", "HMN_35_5": "HMN_10B_5", "HMN_35_6": "HMN_10B_6",
        "HMN_35_7": "HMN_10B_7", "HMN_35_8": "HMN_10B_8", "HMN_35_9": "HMN_10B_9",
        "HMN_35_10": "HMN_10B_10", "HMN_35_12": "HMN_10B_17",
        "HMN_35_13": "HMN_10B_18", "HMN_35_14": "HMN_10B_20",
        "LAB_10": "GEN_06", "LAB_20": "LAB_01",
        "MAN_10": "MAN_01",
        "MAN_15F": "MAN_02C", "MAN_15G": "MAN_02D",
        "MAN_15HI_H": "MAN_05A", "MAN_15HI_I": "MAN_05B",
        "MAN_25A": "MAN_06A_1", "MAN_25B": "MAN_06A_2", "MAN_25C": "MAN_06A_3",
        "MAN_25D": "MAN_06A_4", "MAN_25E": "MAN_06A_6",
        "POL_05A": "POL_01A", "POL_05B": "POL_01B", "POL_05C": "POL_01C",
        "POL_05D": "POL_01D", "POL_05E": "POL_01E", "POL_05F": "POL_01F",
        "POL_05G": "POL_01G", "POL_10": "POL_02",
        "STA_10A_A": "STA_01A", "STA_10A_B": "STA_01B", "STA_10A_C": "STA_01C",
        "STA_10A_D": "STA_01D", "STA_10A_E": "STA_01E",
        "STA_20": "STA_04", "STA_25": "STA_05",
        "STA_30_1": "STA_06_1", "STA_30_2": "STA_06_2", "STA_30_3": "STA_06_3",
        "STA_30_4": "STA_06_4", "STA_30_5": "STA_06_5", "STA_30_6": "STA_06_6",
        "STA_30_7": "STA_06_7", "STA_30_8": "STA_06_8", "STA_30_9": "STA_06_9",
        "STA_30_10": "STA_06_10", "STA_30_11": "STA_06_11", "STA_30_12": "STA_06_12",
        "STA_30_13": "STA_06_13", "STA_30_14": "STA_06_14", "STA_30_15": "STA_06_16",
        "STA_30_16": "STA_06_17", "STA_30_18": "STA_06_20",
        "STA_35": "STA_07",
        "STA_38A": "STA_09A", "STA_38B": "STA_09B", "STA_38C": "STA_09C",
        "STA_50B": "STA_12A", "STA_50C": "STA_12B",
        "STA_50D_1": "STA_12C_1", "STA_50D_2": "STA_12C_2", "STA_50D_3": "STA_12C_3",
        "STA_50D_4": "STA_12C_4", "STA_50D_5": "STA_12C_5", "STA_50D_6": "STA_12C_6",
        "STA_50D_7": "STA_12C_7", "STA_50D_8": "STA_12C_8", "STA_50D_9": "STA_12C_9",
        "STA_50D_10": "STA_12C_10", "STA_50D_11": "STA_12C_11", "STA_50D_12": "STA_12C_12",
        "STA_55": "STA_12D", "STA_56": "STA_13", "STA_57": "STA_14A",
        "STA_58_1": "STA_14C_1", "STA_58_2": "STA_14C_2", "STA_58_3": "STA_14C_3",
        "STA_58_4": "STA_14C_4", "STA_58_5": "STA_14C_5", "STA_58_6": "STA_14C_6",
        "STA_58_7": "STA_14C_7",
        "STA_60A": "STA_15A", "STA_60B": "STA_15B", "STA_60C": "STA_15C",
        "STA_65A": "STA_16A",
        "STA_65BA": "STA_16B_1", "STA_65BD": "STA_16B_3", "STA_65BE": "STA_16B_4",
        "STA_65BF": "STA_16B_5", "STA_65BH": "STA_16B_6",
        "STA_66": "STA_17",
        "YRS_10": "YRS_01", "YRS_15": "YRS_02", "YRS_25": "YRS_03",
    }

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
                    # Match against both name and URL — CKAN resource names vary but URL always has filename
                    check = (res["name"] + " " + res["url"]).lower()

                    # Match only the three CSVs we need; skip docs and demographic breakdowns
                    if re.search(r"snps.?01", check):
                        target_table = "snps_responses"
                    elif re.search(r"snps.?13", check):
                        target_table = "snps_response_profile"
                    elif re.search(r"snps.?14", check):
                        target_table = "snps_questions"
                    else:
                        continue

                    if any(ext in check for ext in (".docx", ".html", ".xlsx")):
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
                            if "question" in df.columns:
                                # Uppercase codes (2021/2023 CSVs use lowercase)
                                df["question"] = df["question"].str.upper()
                                # Remap old codes to canonical 2025 codes for cross-year trends
                                if year != 2025:
                                    df["question"] = df["question"].replace(self.SNPS_CODE_CROSSWALK)
                            if "dept_e" in df.columns:
                                df["dept_e"] = df["dept_e"].replace(
                                    {"Federal public service": "Federal Public Service"}
                                )

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
