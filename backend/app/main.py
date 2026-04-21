from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import get_write_conn
from app.db.migrations import init_db
from app.routers import (
    advertisements,
    datasets,
    funnel,
    ingestion,
    query,
    snps,
    staffing,
)

logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)

_DATASET_TITLES = {
    "advertisements": {
        "title_en": "Public Service Staffing Advertisements",
        "title_fr": "Annonces de dotation de la fonction publique",
        "frequency": "Annual",
        "source_url": "https://open.canada.ca/data/en/dataset/e61c8587-2cc9-4775-b34e-f1041ad00410",
    },
    "staffing_dashboard": {
        "title_en": "Staffing and Non-Partisanship Survey Dashboard",
        "title_fr": "Tableau de bord sur la dotation et l'impartialité",
        "frequency": "Quarterly",
        "source_url": "https://open.canada.ca/data/en/dataset/26ffad36-ca9b-431c-8f6d-a6df02665e2c",
    },
}


async def _seed_registry() -> None:
    """Upsert known datasets into dataset_registry on startup."""
    async with get_write_conn() as conn:
        for key, dataset_id in settings.DATASET_IDS.items():
            meta = _DATASET_TITLES.get(key, {})
            conn.execute(
                """
                INSERT INTO dataset_registry
                    (dataset_id, dataset_key, title_en, title_fr, frequency, source_url)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (dataset_id) DO UPDATE SET
                    dataset_key = excluded.dataset_key,
                    title_en    = excluded.title_en,
                    title_fr    = excluded.title_fr,
                    frequency   = excluded.frequency,
                    source_url  = excluded.source_url
                """,
                [
                    dataset_id,
                    key,
                    meta.get("title_en", key),
                    meta.get("title_fr"),
                    meta.get("frequency"),
                    meta.get("source_url"),
                ],
            )
    logger.info("Dataset registry seeded with %d entries.", len(settings.DATASET_IDS))


async def _cleanup_stale_ingest_logs() -> None:
    """Mark any 'running' ingest_log entries as 'error' — they're orphans from a prior crash."""
    async with get_write_conn() as conn:
        result = conn.execute(
            """
            UPDATE ingest_log
            SET status = 'error',
                error_message = 'Interrupted — process restarted before this job finished',
                finished_at = current_timestamp
            WHERE status = 'running'
            """
        )
    logger.info("Cleaned up stale ingest_log entries.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting PSC Data Explorer API…")
    await init_db()
    await _seed_registry()
    await _cleanup_stale_ingest_logs()
    yield
    logger.info("PSC Data Explorer API shutting down.")


app = FastAPI(
    title="PSC Data Explorer API",
    version="0.1.0",
    description="Public Service Commission of Canada open data exploration platform.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
PREFIX = "/api/v1"
app.include_router(datasets.router, prefix=PREFIX)
app.include_router(advertisements.router, prefix=PREFIX)
app.include_router(staffing.router, prefix=PREFIX)
app.include_router(funnel.router, prefix=PREFIX)
app.include_router(ingestion.router, prefix=PREFIX)
app.include_router(snps.router, prefix=PREFIX)
app.include_router(query.router, prefix=PREFIX)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
