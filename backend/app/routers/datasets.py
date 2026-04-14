from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, HTTPException

from app.config import settings
from app.database import query_to_records
from app.models.responses import DatasetRegistryRow
from app.services.ckan import CKANClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.get("", response_model=list[DatasetRegistryRow])
async def list_datasets() -> list[dict]:
    """Return all rows from dataset_registry."""
    return query_to_records("SELECT * FROM dataset_registry ORDER BY dataset_key")


@router.get("/{dataset_key}", response_model=DatasetRegistryRow)
async def get_dataset(dataset_key: str) -> dict:
    """Return registry info for a single dataset, enriched with live CKAN metadata."""
    rows = query_to_records(
        "SELECT * FROM dataset_registry WHERE dataset_key = ?", [dataset_key]
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_key}' not found in registry.")

    row = rows[0]

    # Attempt to fetch live metadata from CKAN
    dataset_id = settings.DATASET_IDS.get(dataset_key)
    if dataset_id:
        try:
            async with httpx.AsyncClient(timeout=15) as http:
                ckan = CKANClient(settings.CKAN_BASE_URL, http)
                package = await ckan.get_package(dataset_id)
            row["ckan_title"] = package.get("title")
            row["ckan_notes"] = package.get("notes")
            row["ckan_metadata_modified"] = package.get("metadata_modified")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not fetch live CKAN metadata for %s: %s", dataset_key, exc)

    return row
