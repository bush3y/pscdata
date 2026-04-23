from __future__ import annotations

import io
import logging

import httpx
import pandas as pd

logger = logging.getLogger(__name__)


class CKANClient:
    """Async client for the open.canada.ca CKAN API."""

    def __init__(self, base_url: str, http_client: httpx.AsyncClient) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = http_client

    async def get_package(self, dataset_id: str) -> dict:
        """Fetch full CKAN package metadata for *dataset_id*."""
        url = f"{self.base_url}/package_show"
        resp = await self._client.get(url, params={"id": dataset_id}, follow_redirects=True)
        resp.raise_for_status()
        body = resp.json()
        if not body.get("success"):
            raise RuntimeError(f"CKAN error for {dataset_id}: {body.get('error')}")
        return body["result"]

    async def list_csv_resources(self, dataset_id: str) -> list[dict]:
        """Return a list of CSV resources for *dataset_id*.

        Each entry is a dict with keys: name, url, id, last_modified.
        """
        package = await self.get_package(dataset_id)
        resources = package.get("resources", [])
        csv_resources = [
            {
                "name": r.get("name", ""),
                "url": r.get("url", ""),
                "id": r.get("id", ""),
                "last_modified": r.get("last_modified") or r.get("metadata_modified"),
            }
            for r in resources
            if r.get("format", "").upper() == "CSV"
        ]
        logger.debug("Found %d CSV resources for dataset %s", len(csv_resources), dataset_id)
        return csv_resources

    async def download_csv(self, url: str) -> pd.DataFrame:
        """Download a CSV from *url* and return a pandas DataFrame.

        Column names are normalised to lowercase with underscores.
        Follows redirects (needed for Azure Blob Storage URLs).
        """
        resp = await self._client.get(url, follow_redirects=True)
        resp.raise_for_status()
        try:
            df = pd.read_csv(io.BytesIO(resp.content), low_memory=False)
        except UnicodeDecodeError:
            df = pd.read_csv(io.BytesIO(resp.content), low_memory=False, encoding="latin-1")
        # Normalise column names
        df.columns = [c.lower().replace(" ", "_").replace("-", "_") for c in df.columns]
        logger.debug("Downloaded CSV from %s — %d rows, %d cols", url, len(df), len(df.columns))
        return df
