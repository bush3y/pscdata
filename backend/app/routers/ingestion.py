from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings
from app.database import query_to_records
from app.models.responses import IngestLogRow, IngestResult
from app.services.ckan import CKANClient
from app.services.ingestor import DataIngestor

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ingest", tags=["ingestion"])


class IngestRequest(BaseModel):
    dataset_keys: list[str] | str = "all"


async def _run_ingestion(dataset_keys: list[str] | str) -> None:
    """Background task: run ingestion for one or more datasets."""
    async with httpx.AsyncClient(timeout=300) as http:
        ckan = CKANClient(settings.CKAN_BASE_URL, http)
        ingestor = DataIngestor(ckan)

        if dataset_keys == "all":
            results = await ingestor.ingest_all()
        else:
            key_method_map = {
                "advertisements": ingestor.ingest_advertisements,
                "staffing_dashboard": ingestor.ingest_staffing_dashboard,
            }
            results: list[IngestResult] = []
            for key in dataset_keys:
                method = key_method_map.get(key)
                if method:
                    try:
                        result = await method()
                        results.append(result)
                    except Exception as exc:  # noqa: BLE001
                        logger.exception("Ingestion failed for key %s: %s", key, exc)
                else:
                    logger.warning("Unknown dataset key: %s", key)

    logger.info("Ingestion complete. Results: %s", results)


@router.post("")
async def trigger_ingestion(body: IngestRequest | None = None) -> dict[str, str]:
    """Trigger data ingestion as a background task."""
    keys = body.dataset_keys if body else "all"
    asyncio.create_task(_run_ingestion(keys))
    return {"status": "accepted", "message": "Ingestion started"}


@router.get("/status", response_model=list[IngestLogRow])
async def get_ingest_status() -> list[dict]:
    """Return the 50 most recent ingest log entries."""
    return query_to_records(
        "SELECT * FROM ingest_log ORDER BY started_at DESC LIMIT 50"
    )
