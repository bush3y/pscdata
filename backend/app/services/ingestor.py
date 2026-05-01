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

    # Canonical breakdown variable codes for snps02–snps24 cross-tabulation files.
    # Maps CSV column name (without _e/_f suffix, lowercased) → canonical uppercase code.
    SNPS_BREAKDOWN_COL_MAP: dict[str, str] = {
        "gdr_10":     "GDR_10",
        "ddis_fl":    "DDIS_FL",
        "vismin_fl":  "VISMIN_FL",
        "visminfl":   "VISMIN_FL",   # 2021 typo in source CSV
        "iidflag":    "IIDFLAG",
        "fol_05":     "FOL_05",
        "region1":    "LAB_01",
        "lab_20":     "LAB_01",      # 2021/2023 old code for region
        "lab_01":     "LAB_01",
        "occlevel":   "ALL_D30A",
        "all_d30a":   "ALL_D30A",
        "agg_35":     "AGG_35",
        "yrs_15":     "YRS_02",      # 2021/2023 old code
        "yrs_02":     "YRS_02",
        "lab_10":     "GEN_06",      # 2021/2023 old code
        "gen_06":     "GEN_06",
        "ed_05":      "ED_01",       # 2021/2023 old code
        "ed_01":      "ED_01",
        "mrt_sts":    "PG_06",       # 2023 marital status
        "pg_06":      "PG_06",
        "gdrplus_fl": "GDR_FL",      # 2023 2SLGBTQIA+ flag
        "gdr_fl":     "GDR_FL",
        "gdr_11a":    "GDR_11A",
        "gdr_11b":    "GDR_11B",
        "pg_07":      "PG_07",
        "pg_08":      "PG_08",
        "pg_05":      "PG_05",
        "abm_01":     "ABM_01",
        "dis_01":     "DIS_01",
    }

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
        # Track which question codes were loaded from snps01 per year so snps12
        # supplements only add questions that are genuinely missing.
        snps01_loaded: dict[int, set[str]] = {}

        async with get_write_conn() as conn:
            conn.execute("TRUNCATE snps_responses")
            conn.execute("TRUNCATE snps_questions")
            conn.execute("TRUNCATE snps_response_profile")
            conn.execute("TRUNCATE snps_crosstabs")

            for year, ckan_id in settings.SNPS_DATASET_IDS.items():
                resources = await self._ckan.list_csv_resources(ckan_id)
                snps01_loaded[year] = set()

                for res in resources:
                    # Match against both name and URL — CKAN resource names vary but URL always has filename
                    check = (res["name"] + " " + res["url"]).lower()

                    if re.search(r"snps.?01", check):
                        target_table = "snps_responses"
                        is_snps12 = False
                    elif re.search(r"snps.?12", check) and year in (2021, 2023):
                        # Supplement: demographic questions absent from snps01 for 2021/2023.
                        # 2025 snps01 already contains all demographic questions.
                        target_table = "snps_responses"
                        is_snps12 = True
                    elif re.search(r"snps.?13", check):
                        target_table = "snps_response_profile"
                        is_snps12 = False
                    elif re.search(r"snps.?14", check):
                        target_table = "snps_questions"
                        is_snps12 = False
                    elif re.search(r"snps.?(?:0[2-9]|1[0-1]|1[6-9]|2[0-4])", check):
                        # snps02–snps11, snps16–snps24 are cross-tabulation files (~11M rows).
                        # Skipped: snps_crosstabs is not used by any current feature and
                        # loading it OOMs small production servers.
                        continue
                    else:
                        continue

                    if any(ext in check for ext in (".docx", ".html", ".xlsx")):
                        continue

                    log_id = _log_id()
                    await self._log_start(conn, log_id, dataset_key, res["name"], res["url"])
                    try:
                        df = await self._ckan.download_csv(res["url"])
                        df.columns = [
                            c.lower().strip().lstrip("\ufeff").strip('"').replace(" ", "_")
                            for c in df.columns
                        ]
                        df = df.replace(r"^\s*$|^\*+$", float("nan"), regex=True)

                        if target_table == "snps_responses":
                            if is_snps12:
                                df = self._process_snps12_supplement(df, year, snps01_loaded[year])
                                if df is None or df.empty:
                                    await self._log_finish(conn, log_id, "success", 0)
                                    continue
                            else:
                                # snps01 standard processing
                                if "question_value_e" in df.columns:
                                    mask = df["question_value_e"].str.lower().str.contains(
                                        r"all respondents|tous les r", na=False, regex=True
                                    )
                                    df = df[~mask]
                                if "question" in df.columns:
                                    df["question"] = df["question"].str.upper()
                                    if year != 2025:
                                        df["question"] = df["question"].replace(self.SNPS_CODE_CROSSWALK)
                                if "dept_e" in df.columns:
                                    df["dept_e"] = df["dept_e"].replace(
                                        {"Federal public service": "Federal Public Service"}
                                    )
                                if "dept_f" in df.columns:
                                    df["dept_f"] = df["dept_f"].replace(
                                        {"Fonction Publique Fédérale": "Fonction publique fédérale"}
                                    )
                                snps01_loaded[year].update(df["question"].dropna().unique())

                        elif target_table == "snps_crosstabs":
                            df = self._process_crosstab(df, year)
                            if df is None or df.empty:
                                await self._log_finish(conn, log_id, "success", 0)
                                continue

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

                # After all resources for this year, derive demographic distributions
                # from the cross-tabulation data loaded into snps_crosstabs
                try:
                    derived = await self._derive_demographic_distributions(conn, year)
                    total_rows += derived
                    logger.info("Derived %d demographic distribution rows for year=%d", derived, year)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Failed to derive demographics for year=%d: %s", year, exc)

            # After all years: detect question_type and populate include_scatter
            try:
                self._populate_question_metadata(conn)
                logger.info("Populated question_type and include_scatter for all snps_questions rows")
            except Exception as exc:  # noqa: BLE001
                logger.exception("Failed to populate question metadata: %s", exc)

        return IngestResult(dataset_key=dataset_key, status="success", rows_loaded=total_rows)

    def _populate_question_metadata(self, conn) -> None:  # noqa: ANN001
        """Detect question_type from response values and set include_scatter.

        question_type values:
          likert      — response options include Likert scale labels (great/moderate/minimal/not at all)
          yesno       — exactly Yes + No (2 values)
          multiselect — response options include Selected / Not selected
          categorical — has response data but doesn't match above patterns
          unknown     — no response data found

        include_scatter = TRUE for likert and yesno questions outside the
        Demographic characteristics theme that are not sub-questions (codes
        with two or more underscore-separated numeric segments like HMN_04_1).
        """
        # Step 1: classify question_type from response values
        conn.execute("""
            UPDATE snps_questions
            SET question_type = (
                SELECT CASE
                    WHEN SUM(CASE WHEN question_value_e IN (
                        'To a great extent', 'To a moderate extent',
                        'To a minimal extent', 'Not at all'
                    ) THEN 1 ELSE 0 END) > 0 THEN 'likert'
                    WHEN SUM(CASE WHEN question_value_e IN ('Selected', 'Not selected')
                    THEN 1 ELSE 0 END) > 0 THEN 'multiselect'
                    WHEN COUNT(DISTINCT question_value_e) = 2
                         AND SUM(CASE WHEN question_value_e = 'Yes' THEN 1 ELSE 0 END) > 0
                         AND SUM(CASE WHEN question_value_e = 'No'  THEN 1 ELSE 0 END) > 0
                    THEN 'yesno'
                    WHEN COUNT(*) > 0 THEN 'categorical'
                    ELSE 'unknown'
                END
                FROM snps_responses r
                WHERE r.question = snps_questions.question
                  AND r.year    = snps_questions.year
            )
        """)

        # Step 2: include_scatter — likert or yesno, non-demographic, non-sub-question
        # Sub-questions have an extra numeric segment: e.g. HMN_04_1 (length - replace count > 1 underscore pair)
        conn.execute("""
            UPDATE snps_questions
            SET include_scatter = (
                question_type IN ('likert', 'yesno')
                AND (theme_e IS NULL OR theme_e != 'Demographic characteristics')
                AND length(question) - length(replace(question, '_', '')) <= 1
            )
        """)

    def _process_snps12_supplement(
        self,
        df: pd.DataFrame,
        year: int,
        snps01_questions: set[str],
    ) -> pd.DataFrame | None:
        """Extract base-population response distributions from snps12 for questions
        not already loaded from snps01. Handles different schemas for 2021 vs 2023."""

        if year == 2021:
            # 2021 snps12: variable_name_2021, shr_w_resp_2021, total_w_resp_2021
            if "variable_name_2021" not in df.columns:
                return None
            df = df[df.get("population_e", pd.Series(dtype=str)) == "All categories"]
            df = df.rename(columns={
                "variable_name_2021": "question",
                "shr_w_resp_2021": "shr_w_resp",
                "total_w_resp_2021": "total_w_resp",
            })
        elif year == 2023:
            # 2023 snps12: same column names as snps01 but with extra population cols
            if "question" not in df.columns:
                return None
            df = df[
                (df.get("population_e", pd.Series(dtype=str)) == "All respondents") &
                (df.get("population2_e", pd.Series(dtype=str)) == "All respondents") &
                (df.get("population3_e", pd.Series(dtype=str)) == "All respondents")
            ]
        else:
            return None

        if df.empty:
            return None

        # Normalise question codes (uppercase + crosswalk)
        if "question" in df.columns:
            df = df.copy()
            df["question"] = df["question"].str.upper().replace(self.SNPS_CODE_CROSSWALK)

        # Keep only questions genuinely absent from snps01 for this year
        df = df[~df["question"].isin(snps01_questions)]

        if df.empty:
            return None

        # Filter out "All respondents" summary rows in question_value_e
        if "question_value_e" in df.columns:
            mask = df["question_value_e"].str.lower().str.contains(
                r"all respondents|tous les r|all categories|toutes les cat", na=False, regex=True
            )
            df = df[~mask]

        if "dept_e" in df.columns:
            df["dept_e"] = df["dept_e"].replace(
                {"Federal public service": "Federal Public Service"}
            )
        if "dept_f" in df.columns:
            df["dept_f"] = df["dept_f"].replace(
                {"Fonction Publique Fédérale": "Fonction publique fédérale"}
            )

        return df

    def _process_crosstab(self, df: pd.DataFrame, year: int) -> pd.DataFrame | None:
        """Process a snps02–snps24 cross-tabulation CSV into snps_crosstabs format.

        Schema: dept_f, dept_e, [breakdown_var]_f, [breakdown_var]_e,
                question, question_value_f, question_value_e, shr_w_resp, total_w_resp.
        Retains 'All respondents' rows — they encode demographic composition counts.
        """
        KNOWN = {
            "dept_f", "dept_e", "question",
            "question_value_f", "question_value_e",
            "shr_w_resp", "total_w_resp",
        }
        breakdown_cols = [c for c in df.columns if c not in KNOWN]
        breakdown_e = next((c for c in breakdown_cols if c.endswith("_e")), None)
        breakdown_f = next((c for c in breakdown_cols if c.endswith("_f")), None)

        if breakdown_e is None:
            logger.warning("_process_crosstab: no breakdown _e column found. Cols: %s", list(df.columns))
            return None

        raw_var = breakdown_e[:-2]  # strip trailing _e
        canonical_var = self.SNPS_BREAKDOWN_COL_MAP.get(raw_var.lower(), raw_var.upper())

        df = df.copy()

        if "question" in df.columns:
            df["question"] = df["question"].str.upper()
            if year != 2025:
                df["question"] = df["question"].replace(self.SNPS_CODE_CROSSWALK)

        if "dept_e" in df.columns:
            df["dept_e"] = df["dept_e"].replace({"Federal public service": "Federal Public Service"})
        if "dept_f" in df.columns:
            df["dept_f"] = df["dept_f"].replace({"Fonction Publique Fédérale": "Fonction publique fédérale"})

        out = pd.DataFrame({
            "dept_e":           df.get("dept_e"),
            "dept_f":           df.get("dept_f"),
            "breakdown_var":    canonical_var,
            "breakdown_value_e": df[breakdown_e],
            "breakdown_value_f": df[breakdown_f] if breakdown_f else None,
            "question":         df.get("question"),
            "question_value_e": df.get("question_value_e"),
            "question_value_f": df.get("question_value_f"),
            "shr_w_resp":       pd.to_numeric(df.get("shr_w_resp", pd.Series(dtype=float)), errors="coerce"),
            "total_w_resp":     pd.to_numeric(df.get("total_w_resp", pd.Series(dtype=float)), errors="coerce"),
        })

        return out if not out.empty else None

    async def _derive_demographic_distributions(self, conn: Any, year: int) -> int:
        """Compute per-dept demographic composition from snps_crosstabs and insert into snps_responses.

        For each breakdown_var (e.g. AGG_35), rows where question_value_e = 'All respondents'
        hold the weighted respondent count for each demographic category. Dividing each
        category count by the dept total gives the share, which is inserted as a survey
        question into snps_responses (question = breakdown_var, question_value_e = category label).
        Questions already present in snps_responses for that year/dept are skipped.
        """
        # Insert derived demographic distributions into snps_responses
        result = conn.execute("""
            WITH anchors AS (
                SELECT
                    year,
                    dept_e,
                    dept_f,
                    breakdown_var,
                    breakdown_value_e,
                    breakdown_value_f,
                    SUM(total_w_resp) AS cat_total
                FROM snps_crosstabs
                WHERE year = ?
                  AND lower(question_value_e) LIKE '%all respondents%'
                  AND total_w_resp IS NOT NULL
                  AND total_w_resp > 0
                  AND lower(breakdown_value_e) NOT LIKE 'all %'
                GROUP BY year, dept_e, dept_f, breakdown_var, breakdown_value_e, breakdown_value_f
            ),
            with_dept_total AS (
                SELECT *,
                    SUM(cat_total) OVER (PARTITION BY year, dept_e, breakdown_var) AS dept_total
                FROM anchors
            )
            INSERT INTO snps_responses
                (year, dept_e, dept_f, question, question_value_e, question_value_f,
                 shr_w_resp, total_w_resp, _loaded_at)
            SELECT
                year,
                dept_e,
                dept_f,
                breakdown_var                           AS question,
                breakdown_value_e                       AS question_value_e,
                breakdown_value_f                       AS question_value_f,
                cat_total / NULLIF(dept_total, 0)       AS shr_w_resp,
                dept_total                              AS total_w_resp,
                CURRENT_TIMESTAMP                       AS _loaded_at
            FROM with_dept_total
            WHERE dept_total > 0
              AND NOT EXISTS (
                SELECT 1 FROM snps_responses sr
                WHERE sr.year    = with_dept_total.year
                  AND sr.dept_e  = with_dept_total.dept_e
                  AND sr.question = with_dept_total.breakdown_var
              )
        """, [year])
        rows_added = result.rowcount if result.rowcount and result.rowcount > 0 else 0

        # Ensure each derived breakdown_var has a row in snps_questions so it appears
        # in the question selector. Use a synthetic "Demographics" category.
        _DEMO_QUESTION_LABELS: dict[str, str] = {
            "AGG_35":    "Age Group",
            "FOL_05":    "First Official Language",
            "GDR_10":    "Gender",
            "GDR_FL":    "2SLGBTQIA+ Identity",
            "GDR_11A":   "Sexual Orientation",
            "GDR_11B":   "Gender Identity",
            "DDIS_FL":   "Disability",
            "DIS_01":    "Disability Type",
            "VISMIN_FL": "Visible Minority",
            "PG_05":     "Visible Minority Subgroup",
            "IIDFLAG":   "Indigenous Identity",
            "ABM_01":    "Indigenous Group",
            "LAB_01":    "Region",
            "ALL_D30A":  "Occupational Level",
            "YRS_02":    "Years of Service",
            "GEN_06":    "Employment Tenure",
            "ED_01":     "Level of Education",
            "PG_06":     "Marital Status",
            "PG_07":     "Family Status",
            "PG_08":     "Religion",
        }

        vars_in_year = conn.execute(
            "SELECT DISTINCT breakdown_var FROM snps_crosstabs WHERE year = ?", [year]
        ).fetchall()

        for (var,) in vars_in_year:
            already = conn.execute(
                "SELECT 1 FROM snps_questions WHERE year = ? AND question = ?", [year, var]
            ).fetchone()
            if already:
                continue
            label = _DEMO_QUESTION_LABELS.get(var, var)
            conn.execute(
                """INSERT INTO snps_questions
                   (year, question, category_e, category_f, theme_e, theme_f, question_e, question_f, _loaded_at)
                   VALUES (?, ?, 'Demographic characteristics', 'Caractéristiques démographiques',
                           'Demographic characteristics', 'Caractéristiques démographiques', ?, ?, CURRENT_TIMESTAMP)""",
                [year, var, label, label],
            )

        return rows_added
