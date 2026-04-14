# PSC Data Explorer

A bilingual (EN/FR) web platform for exploring [Public Service Commission of Canada](https://www.canada.ca/en/public-service-commission.html) open data. No login required. Self-hostable via Docker.

## What It Does

Turns PSC and TBS open datasets into an interactive dashboard covering federal public service staffing activity — advertisements, hiring, separations, internal mobility, demographics, and veterans hiring.

**Key pages:**
- **Staffing Dashboard** (`/`) — KPI summary cards + six chart tabs (Advertisements, Inflow, Outflow, Internal Mobility, Demographics, Priority & Veterans)
- **Department Overview** (`/department`) — executive summary for any department or PS Total: KPIs, workforce flow charts, TBS headcount trend, demographics
- **Data Explorer** (`/query`) — standard column picker or free-form SQL against any table; export to CSV
- **Process Lookup** (`/process`) — search by GC Jobs selection process number or PSC reference number; shows full process detail card with applicant funnel
- **Data Ingestion** (`/admin`) — trigger ingestion from open.canada.ca, view log history

## Data Sources

| Dataset | Source | Coverage |
|---|---|---|
| Public Service Staffing Advertisements | PSC | 2017–2026, ~54K ads |
| Staffing and Non-Partisanship Survey Dashboard | PSC | 2011–2026, quarterly updates |
| Federal Public Service Statistics | TBS | 2010–2025, March 31 snapshots |

All data is fetched directly from [open.canada.ca](https://open.canada.ca) on demand — no pre-bundled data files.

## Stack

- **Backend**: FastAPI + DuckDB + Pandas, Python 3.12
- **Frontend**: React + TypeScript + Vite + Recharts
- **Database**: DuckDB (single file, no separate DB server needed)
- **Deployment**: Docker Compose

## Running Locally

```bash
git clone <repo-url>
cd pscdata
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

On first boot the database is empty. Navigate to **http://localhost:5173/admin** and click **Start Ingestion** to load all datasets (takes a few minutes — fetches CSVs from open.canada.ca).

## Production Deployment

```bash
docker compose -f docker-compose.prod.yml up -d
```

Runs the frontend as a pre-built Nginx bundle on port 80. Intended for a single Digital Ocean droplet.

## Project Structure

```
pscdata/
├── backend/
│   ├── app/
│   │   ├── routers/        # FastAPI route handlers
│   │   ├── services/       # Ingestor (fetches + loads CSVs)
│   │   ├── db/
│   │   │   └── schema.sql  # DuckDB schema + idempotent migrations
│   │   └── main.py
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/          # StaffingDashboard, DepartmentOverview, etc.
│   │   ├── components/     # ChartCard, TrendMixCharts, etc.
│   │   └── api/            # React Query hooks
│   └── Dockerfile
├── docker-compose.yml       # Local dev (hot reload)
└── docker-compose.prod.yml  # Production
```

## Developer Notes

See [CLAUDE.md](CLAUDE.md) for detailed notes on data quirks, schema migration patterns, endpoint behaviour, and known issues.
