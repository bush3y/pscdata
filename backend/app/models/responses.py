from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class DatasetRegistryRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    dataset_id: str
    dataset_key: str
    title_en: str
    title_fr: str | None = None
    frequency: str | None = None
    last_ingested_at: datetime | None = None
    total_records: int | None = None
    source_url: str | None = None


class AdvertisementRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fiscal_year: str | None = None
    reference_number: str | None = None
    open_date: date | None = None
    close_date: date | None = None
    internal_indicator: str | None = None
    external_indicator: str | None = None
    position_title_e: str | None = None
    position_title_f: str | None = None
    classifications: str | None = None
    administrator_region_e: str | None = None
    administrator_region_f: str | None = None
    advertisement_type_e: str | None = None
    advertisement_type_f: str | None = None
    organization_e: str | None = None
    organization_f: str | None = None
    organization_code: str | None = None
    province_name_e: str | None = None
    province_name_f: str | None = None
    recruitment_program_e: str | None = None
    recruitment_program_f: str | None = None
    status_e: str | None = None
    status_f: str | None = None
    indeterminate: int | None = None
    specified_term: int | None = None
    acting: int | None = None
    total_submitted_sup: int | None = None
    total_in_sup: int | None = None
    caf_in: int | None = None
    women_submitted_sup: int | None = None
    vismin_submitted_sup: int | None = None
    indigenous_submitted_sup: int | None = None
    pwd_submitted_sup: int | None = None
    french_submitted_sup: int | None = None
    english_submitted_sup: int | None = None


class AdvertisementSummaryRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fiscal_year: str
    advertisement_count: int


class FunnelRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fiscal_year: str
    advertisement_count: int
    total_applicants: int | None = None
    screened_in: int | None = None
    avg_applicants_per_adv: float | None = None
    screened_in_rate_pct: float | None = None


class FunnelByRegionRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fiscal_year: str
    region_e: str | None = None
    region_f: str | None = None
    advertisement_count: int
    total_applicants: int | None = None
    screened_in: int | None = None


class StaffingRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    department_e: str | None = None
    department_f: str | None = None
    fiscal_year: str | None = None
    quarter: str | None = None
    count: int | None = None
    qtr_count: int | None = None



class IngestLogRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    dataset_key: str | None = None
    resource_name: str | None = None
    resource_url: str | None = None
    status: str | None = None
    rows_loaded: int | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class IngestResult(BaseModel):
    dataset_key: str
    status: str
    rows_loaded: int = 0
    error_message: str | None = None


class GenericRow(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="allow")

    def __init__(self, **data: Any) -> None:
        super().__init__(**data)
