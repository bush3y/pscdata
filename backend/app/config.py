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

    @property
    def SNPS_DATASET_IDS(self) -> dict[int, str]:
        return {
            2025: "8766bf91-d14c-423b-a5d1-ac47f5b4dd22",
            2023: "88f45a5c-bc57-4483-bc85-2c19bc342039",
            2021: "90705678-982e-49db-8f1b-13e93ede3a95",
        }

    class Config:
        env_file = ".env"


settings = Settings()
