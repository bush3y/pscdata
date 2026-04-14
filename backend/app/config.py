from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DUCKDB_PATH: str = "/data/psc.duckdb"
    CKAN_BASE_URL: str = "https://open.canada.ca/data/en/api/3/action"
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:80"]

    @property
    def DATASET_IDS(self) -> dict[str, str]:
        return {
            "advertisements": "e61c8587-2cc9-4775-b34e-f1041ad00410",
            "staffing_dashboard": "26ffad36-ca9b-431c-8f6d-a6df02665e2c",
            "tbs_population": "f0d12b41-54dc-4784-ad2b-83dffed2ab84",
        }

    class Config:
        env_file = ".env"


settings = Settings()
