# GC Staffing Insights Portal — Project Notes

## What This Is
A bilingual (EN/FR) web platform for exploring Public Service Commission of Canada staffing data. No login. Deployable via Docker on Digital Ocean.

## Stack
- **Backend**: FastAPI + DuckDB + Pandas, Python 3.12
- **Frontend**: React + TypeScript + Vite + Recharts
- **Docker**: `docker-compose.yml` for local dev (hot reload on both sides), `docker-compose.prod.yml` for prod

## Running Locally
```bash
docker compose up --build
# Backend: http://localhost:8000
# Frontend: http://localhost:5173
```
After first boot, navigate to `/admin` directly in the browser and trigger ingestion to load data.

## Data Sources (3 datasets)

| Key | Dataset | Source | Frequency | Tables |
|---|---|---|---|---|
| `advertisements` | Public Service Staffing Advertisements | PSC | Annual | `raw_advertisements` |
| `staffing_dashboard` | Staffing and Non-Partisanship Survey Dashboard | PSC | Quarterly | `dash_inflow`, `dash_outflow`, `dash_internal_mobility`, `dash_adv_type`, `dash_advertisements`, `dash_demo_ee`, `dash_demo_age`, `dash_demo_region`, `dash_demo_group`, `dash_demo_fol`, `dash_priority`, `dash_reappointments`, `dash_vha_1`, `dash_vha_2`, `dash_vha_3` |
| `tbs_population` | Federal Public Service Statistics | TBS | Annual (March 31) | `tbs_pop_dept`, `tbs_pop_tenure` |

### Why only two PSC datasets (dropped two)
- **Applications by Recruitment Program** — redundant with `raw_advertisements`, cross-year numbers not comparable (scope changed post-2016)
- **PSEA Hiring Activities** — 20+ CSVs dumped into two tables caused massive double-counting; `dash_inflow` from the staffing dashboard covers hiring by type (2011–2026) cleanly

## Data Coverage — TBS Population Tables
- CKAN dataset ID: `f0d12b41-54dc-4784-ad2b-83dffed2ab84`
- Coverage: 2010–2025 (March 31 snapshot each year)
- `tbs_pop_dept`: year, universe (CPA etc.), dept_e, count — total headcount per department
- `tbs_pop_tenure`: year, dept_e, tenure_e (Indeterminate/Term/Casual/Student), count
- **Year mapping**: TBS year N = PSC fiscal year (N-1)-N (e.g. TBS 2025 ≈ FY 2024-2025)
- **Dept name caveat**: TBS and PSC maintain independent department name lists in English. Names generally match for major departments but may differ for smaller agencies. The frontend shows a note when TBS data is not found for a selected department.
- Only EN CSVs are ingested. FR resources are skipped (detected by "ministere"/"effectif" in URL/name).
- No aggregate "Total" row in source data. PS Total is computed as SUM — but **only for departments also present in `dash_inflow`** (PSC-covered universe), so the TBS headcount and PSC staffing activity totals are over the same set of departments.

## Data Coverage — raw_advertisements
2017–2026, ~54K rows. Columns ingested:

| Column | Notes |
|---|---|
| `fiscal_year` | |
| `car_chc_id` | Internal PSC numeric ID |
| `reference_number` | Internal PSC ad identifier (e.g. `PSC23J-106197-000006`) |
| `selection_process_number` | GC Jobs-facing identifier (e.g. `22-DIS-ON-EA-423055`) — **different field from reference_number** |
| `creation_date` | When the process was created |
| `open_date` / `close_date` | When the posting opened/closed |
| `number_days_open` | Duration the posting was open |
| `internal_indicator` / `external_indicator` | Audience flags |
| `position_title_e/f` | |
| `classifications` | Comma-separated classification codes |
| `advertisement_url_e/f` | Direct link to GC Jobs posting |
| `city_name_e/f` | City of the position |
| `administrator_region_e/f` | PSC administrative region |
| `advertisement_type_e/f` | |
| `organization_e/f` / `organization_code` | |
| `province_name_e/f` | |
| `recruitment_program_e/f` | INT, JOP, FSWEP, PSR, RAP, RPL |
| `status_e/f` | Open / Closed |
| `indeterminate` / `specified_term` / `acting` / `assignment` / `deployment` / `secondment` | Tenure types sought in the posting (not appointment counts) |
| `total_submitted_sup` | Applicants submitted |
| `total_in_sup` | Screened in |
| `total_out_sup` | Screened out |
| `caf_in` | CAF (Canadian Armed Forces) members in the process — NOT total appointed. There is no total appointments column in this dataset. |

## Data Coverage — Staffing Dashboard Tables
- `dash_advertisements`: 2011–2026. Source: `advs.csv`. Program × days-to-close category, application totals by dept + quarter. Authoritative source for application counts.
- `dash_inflow`: 2011–2026. Hire types: Casual, New Indeterminate, New Term, Student, etc., by dept + quarter.
- `dash_outflow`: 2011–2026. Separations by reason.
- `dash_demo_ee`: 2011–2026. EE group breakdown by hire type + quarter. Released annually with ~1 year delay.
- `dash_demo_age`: 2011–2026. Age group breakdown by hire type + quarter.
- `dash_demo_region`: 2011–2026. Region breakdown by hire type + quarter.
- `dash_demo_group`: 2011–2026. Occupational group breakdown by hire type + quarter.
- `dash_demo_fol`: 2011–2026. First Official Language breakdown (Anglophones/Francophones) by dept + fiscal year. **No `quarter` column** — annual only.
- `dash_priority`: Single point-in-time snapshot. Priority persons by province and classification. No fiscal year.
- `dash_reappointments`: 2011–2026. Total indeterminate staffing actions + priority appointments, by department. `count` = total indeterminate (advertised + non-advertised); `priority_count` = priority appointments.
- `dash_vha_1`: 2015–2026. CAF/veteran applications to internal and external advertisements, by provision type and application type.
- `dash_vha_2`: 2015–2026. VHA priority registrations and appointments by priority type.
- `dash_vha_3`: 2015–2026. Eligible CAF members by eligibility reason.

## Known Data Quirks
- GoC CSVs use `" "` (space) and `*` to suppress small counts — treated as NULL on ingest (applies to both `raw_advertisements` and all staffing tables)
- Some staffing CSVs have extra columns (e.g. `pct_chg_qtr`) not in schema — handled by PRAGMA-based column alignment in `_insert_df`
- `dash_demo_ee` CSV uses `ee_e/ee_f` columns; renamed to `ee_group_e/ee_group_f` on ingest
- `dash_demo_group` CSV uses `class_e/class_f`; renamed to `occ_group_e/occ_group_f` on ingest
- `advs.csv` (→ `dash_advertisements`) has a **typo** in column headers: `appl_sumbitted_sum` / `appl_sumbitted_mean` (note "sumbitted"). Corrected via `_col_renames` on ingest.
- `advs.csv` FSWEP application counts are inflated for 2023-2024 onwards — PSC data quality issue, expected to self-correct on next republish. All other programs match PSC dashboard exactly.
- `raw_advertisements` source CSVs contain exact duplicate rows for FSWEP ads (NULL `reference_number`). Fixed by `df.drop_duplicates()` on ingest.
- `dash_advertisements` has a "Public Service - Total" aggregate row per fiscal year. Always filter to this row for national totals to avoid double-counting.
- `raw_advertisements` is TRUNCATED before each ingest run (not appended). `dash_*` staffing tables are also truncated per-resource before insert.
- `dash_demo_region` source CSV contains a spurious `region_e = 'check'` row (all zeros). Filtered out in the demographics endpoint.
- `priority.csv` uses `N` as the count column name — renamed to `count` on ingest.
- `vha_3.csv` count field may be formatted with commas (e.g. "7,348") — stripped on ingest.
- All VHA and priority CSVs use `processing_date_traitement` — renamed to `processing_date` on ingest.
- `reference_number` and `selection_process_number` are **different fields**: reference_number is PSC's internal ad ID; selection_process_number is the GC Jobs-facing identifier. Both are searchable in Process Lookup.

## Schema Migrations
`schema.sql` uses `CREATE TABLE IF NOT EXISTS` for all tables (idempotent). New columns added to existing tables use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements at the bottom of `schema.sql`, which run on every startup via `migrations.py`. This pattern is safe and idempotent — never add new columns only to the CREATE TABLE block without also adding an ALTER TABLE statement.

**IMPORTANT — migration parser caveat**: `migrations.py` splits `schema.sql` on every `;` character. Never put a semicolon inside a SQL comment in schema.sql — it will be treated as a statement boundary and corrupt the following statement. Use `—` (em dash) instead. This bug previously caused `car_chc_id` to silently fail to be added until manually run.

## Staffing Dashboard Open Data Quirk — Quarter Column
Most `dash_*` staffing tables have a `quarter` column (`dash_demo_fol` is the exception — annual only, no quarter). **PSC only publishes one row per fiscal year per department** (not true quarterly breakdowns). PSC stamps **every row in the entire dataset** with the current publishing quarter when they update — so all years (including completed ones) will show the same quarter value (e.g. when Q3 is published, every row across all fiscal years has `quarter = 'Q3'`). For completed years `count` is the full annual total; for the current year it is the FYTD total through the publishing quarter. The companion `qtr_count`/`qtr_appl_submitted_sum` fields hold the actual FYTD figure for each year — used directly for same-period YoY comparison in KPI cards (no estimation needed for prior years). `q_count` detection (reading the quarter from the max fiscal year) drives the FYTD date window for `raw_advertisements`. The `quarter` filter in `_build_common_where()` is never used by the frontend — always passed as `None`.

## Architecture Notes
- DuckDB doesn't allow mixing `read_only=True` and read-write connections to the same file — all connections use read-write mode, writes are serialized via `asyncio.Lock`
- Pandas returns `NaN` (not `None`) for DB nulls — `query_to_records()` uses `df.astype(object).where(pd.notnull(df), None)` before `.to_dict()`
- Stale `running` ingest log entries (from crashed runs) are cleaned up automatically on startup in `main.py::_cleanup_stale_ingest_logs()`
- Ingestion uses `PRAGMA table_info` to align DataFrame columns to schema before insert — handles extra/missing CSV columns gracefully
- All staffing endpoints default to `department_e = 'Public Service - Total'` when no department filter is provided, to use PSC's pre-aggregated national totals and avoid double-counting individual department rows alongside roll-up rows.
- `dash_reappointments` has TWO aggregate rows: `'Public Service - Total'` (national total, used as default — `count` = total indeterminate staffing actions, `priority_count` = priority appointments) and `'Public Service - Average'` (per-department average, much smaller values). The endpoint defaults to "Total".

## Data Source Strategy by Metric

| Metric | Source Table | Notes |
|---|---|---|
| Advertisement counts | `raw_advertisements` | Exact; FSWEP deduped via `drop_duplicates()` |
| Applications | `dash_advertisements` | Exact for INT/JOP/PSR/RAP; FSWEP inflated 2023+ (PSC data issue) |
| Screened In | `raw_advertisements` | ~2–5% under PSC for large programs (suppressed values → NULL) |
| Screened Out | `raw_advertisements` | Same suppression caveat |
| CAF Members | `raw_advertisements` | `caf_in` column — CAF members in process, not total appointed |
| Appointments | N/A | No total appointed column exists in the raw advertisements dataset |

## Pages
| Route | Page | Description |
|---|---|---|
| `/` | Staffing Dashboard | Home page — KPI summary cards + 6-tab dashboard |
| `/snapshot` | Department Snapshot | Executive summary for a specific dept or PS Total — headline, KPI cards, chart, composition, comparison table, PSC oversight indicators |
| `/query` | Data Explorer | Standard column picker + Advanced SQL mode for raw advertisements and all tables |
| `/process` | Process Lookup | Search by selection process # or reference #; shows process detail card |
| `/admin` | Data Ingestion | Trigger ingestion, view log history — not linked in nav, access directly by URL |

## Staffing Dashboard — URL State
- `?dept=` syncs the selected department filter; shareable link
- `?tab=` syncs the active chart tab (`advertisements` | `inflow` | `outflow` | `mobility` | `demographics` | `priority`)
- Page title shows "Staffing Dashboard — [Dept name]" when a department is filtered
- Deep-links from Department Snapshot use both params (e.g. `/?dept=RCMP&tab=inflow`)

## Staffing Dashboard — KPI Summary Cards
Shown at the top of the page, always visible regardless of active tab. Matches PSC's summary panel metrics:

| Card | Source | Filter |
|---|---|---|
| Advertisements | `raw_advertisements` | INT + JOP programs, filtered to current FYTD date window |
| Applications | `dash_advertisements` | All programs, `days_cat_e = 'Total'`, PS Total |
| New Indeterminate | `dash_inflow` | `hire_e = 'New Indeterminate'`, PS Total |
| Separations | `dash_outflow` | All separation reasons, PS Total |
| Promotions | `dash_internal_mobility` | `mob_type_e = 'Promotion'`, PS Total |
| Lateral / Downward | `dash_internal_mobility` | `mob_type_e = 'Lateral or downward'`, PS Total |
| Acting | `dash_internal_mobility` | `mob_type_e = 'Acting'`, PS Total |

Each card has two panels:
- **FYTD panel** (white): current year value vs prior year's `qtr_count`/`qtr_appl_submitted_sum` (the actual published FYTD figure for the same quarter in the prior year). Falls back to `prior_year_total / 4 × q_count` estimate only when `qtr_count` is unavailable. Labelled "vs same period last year" (or "vs ~est. prior period" if estimated).
- **Full-year panel** (shaded): prior full year total vs the year before that, with directional % change and `YYYY-YYYY vs YYYY-YYYY` label. This is the only true apples-to-apples annual comparison available.

`q_count` is detected dynamically — when PSC publishes Q2 open data and we re-ingest, the date window for raw_advertisements and the normalization factor both update automatically.

## Staffing Dashboard — Chart Tabs
Six tabs: Advertisements, Inflow, Outflow, Internal Mobility, Demographics, Priority & Veterans. (Recruitment Pipeline tab was removed — not enough value over the existing views.)

Each tab shows a plain-language description of what is being visualized and any relevant data caveats.

### Advertisements Tab
- **Metric selector**: Advertisements / Applications / Screened In
- **Dimension selector**: varies by metric source
  - Advertisements, Screened In → `raw_advertisements`; dimensions: Program, Ad Type, Region, Classification, Status
  - Applications → `dash_advertisements` via `GET /staffing/adv-aggregate`; dimensions: Program, Days to Close
- Charts: time-series line (with multi-line breakdown toggle) + stacked bar mix (with 100% toggle)

### Inflow / Outflow / Internal Mobility Tabs
All use the shared `TrendMixCharts` component:
- Left: time-series line (single or multi-line breakdown by category)
- Right: stacked bar mix with 100% toggle

### Demographics Tab
Two sub-tabs:

**By Hire Type** — hire type selector (New Indeterminate, New Term, Casual, Term to Indeterminate, Indet. from other org, Term from other org, All hire types) × breakdown selector (Age Group, Classification, Region). Uses `dash_demo_age/group/region` with `hire_e` filter. `TrendMixCharts` with line + stacked bar.

**Advanced Statistics** — category selector with four views:
- **Employment Equity** — `dash_demo_ee`, `ee_group_e` dimension. Annual data, ~1 year delay.
- **Advertised / Non-advertised** — `dash_adv_type`, `adv_e` dimension (Advertised Process, Non-advertised Process, Unknown Status).
- **First Official Language** — `dash_demo_fol`, `fol_e` dimension (Anglophones, Francophones). No `quarter` column — annual only; `ORDER BY fiscal_year` (not `fiscal_year, quarter`).
- **Priority Appointments** — `dash_reappointments` "Public Service - Total" row; custom `PriorityApptsChart` showing "Total indeterminate" (`count`) and "Priority appointments" (`priority_count`) lines + % chart.

### Priority & Veterans Tab
Sub-selector with 5 views:
- **Reappointments** — total indeterminate staffing actions and priority appointments over time + % chart. Source: `dash_reappointments` "Public Service - Total" row (`count` = total indeterminate, `priority_count` = priority appointments).
- **Priority (current)** — snapshot bar charts of current priority persons by province and top 15 classifications. Source: `dash_priority`.
- **VHA — Applications** — CAF/veteran applications to job postings by type over time. Source: `dash_vha_1`.
- **VHA — Registrations** — VHA priority registrations vs appointments by priority type. Source: `dash_vha_2`.
- **VHA — Eligibility** — Eligible CAF members by eligibility reason over time. Source: `dash_vha_3`.

### Partial Year (FYTD) Visual Treatment
- `detectPartialYear()` runs on the fetched data: finds max fiscal year, checks quarter coverage (< 4 quarters = partial)
- Partial year x-axis label gets " FYTD" suffix
- Single-line charts split into two `Line` components: solid (all years except partial) + dashed (bridge from last full year to partial year)
- Stacked bar charts dim the partial year column via `Cell fillOpacity={0.45}`
- Custom tooltip shows a single clean value regardless of the two-line split

## API Routes (`/api/v1/`)
- `GET /advertisements` — raw ads with filters + column selection, JSON or CSV
- `GET /advertisements/summary` — ad count by fiscal year
- `GET /advertisements/aggregate` — server-side aggregation by 1–2 dimensions with metric and filter support
- `GET /advertisements/filter-options` — distinct values for all filterable fields
- `GET /advertisements/autocomplete?q=` — contains search on both `reference_number` and `selection_process_number`; returns `{reference_number, selection_process_number}` objects
- `GET /advertisements/process?reference_number=` — lookup by either `reference_number` OR `selection_process_number` (OR condition)
- `GET /staffing/summary` — KPI summary panel: last 3 years for 7 metrics + q_count
- `GET /staffing/{inflow|outflow|mobility|adv-type|advertisements}` — staffing dashboard tables
- `GET /staffing/adv-aggregate` — aggregate `dash_advertisements` by dimension for applications data
- `GET /staffing/demographics/{ee|age|region|group|fol}` — demographic breakdown tables; optional `hire_e` param for age/region/group; `fol` orders by `fiscal_year` only (no quarter column)
- `GET /staffing/priority` — current priority persons snapshot (no filters)
- `GET /staffing/reappointments` — indeterminate appointments + priority appointments by fiscal year + department; defaults to `Public Service - Total`
- `GET /staffing/vha/{1|2|3}` — VHA tables 1, 2, or 3 filtered by fiscal year
- `GET /staffing/department-overview` — bundled executive summary for a dept or PS Total; includes `q_count` for FYTD normalization
- `GET /staffing/population` — TBS headcount + tenure mix for a dept or PS Total (filtered to PSC universe for PS Total)
- `GET /funnel` — recruitment funnel aggregated by fiscal year
- `GET /funnel/by-region` — funnel by administrator region
- `POST /query/raw` — execute a read-only SELECT against any table; sanitized (SELECT-only, no semicolons, forbidden keyword blocklist); `limit=0` = no cap; returns `{rows, row_count, capped, columns}`
- `POST /ingest` — trigger ingestion (background task)
- `GET /ingest/status` — last 50 ingest log entries

## Process Lookup Page (`/process`)
- Search box with autocomplete dropdown (min 2 chars, contains match on both `selection_process_number` and `reference_number`)
- Dropdown shows selection process number prominently with reference number in smaller text below
- Selecting a result or pressing Enter triggers the process lookup
- `car_chc_id` written to `?id=` URL param on load — shareable link; page boots pre-loaded when `?id=` present (backend `/advertisements/process` accepts `car_chc_id` param)
- Empty skeleton state when no process selected (hidden when `?id=` is present)
- Process card:
  - Header: selection process number (primary) + reference number (secondary), position title, org/region/year, status badge; **"View on GC Jobs ↗"** and **"View full data ↗"** links below org line (View full data navigates to `/query?sql=SELECT * FROM raw_advertisements WHERE car_chc_id=...`)
  - Stats row: Applications, Screened In, Screened Out (if present) — with % screened-in rate
  - Left column: Overview rows (Open Date, Close Date, Days Open, Ad Type, Audience, Program, City, Province, Tenure Sought) + Classifications chips
  - Right column: **Application Status** bars (Submitted → Screened In → Screened Out) → **EE Applicants** (Women, Visible Minority, Indigenous, Persons w/ Disabilities; suppressed <5 shown as —) → **First Official Language** (Francophone, Anglophone) → **CAF Members** (participation count, not appointments)

## Data Explorer Page (`/query`)
Two modes toggled at top-right:

**Standard mode** — column picker + filters against `raw_advertisements`:

| Group | Columns |
|---|---|
| Identifiers | Fiscal Year, Selection Process #, Reference #, car_chc_id, Open Date, Close Date, Creation Date, Days Open |
| Position | Position Title, Classification, Ad Type, Recruitment Program |
| Location | Region, Province, City |
| Organization | Organization, Org Code |
| Status | Status, Internal, External |
| Metrics | Submitted, Screened In, Screened Out, CAF Members |
| EE Applicants | Women, Visible Minority, Indigenous, Persons w/ Disabilities, Francophone, Anglophone |
| Tenure | Indeterminate, Specified Term, Acting, Assignment, Deployment, Secondment |

Filters: Fiscal Year, Organization, Region, Status, Ad Type, Recruitment Program, Classification.
Visualize button opens a chart (bar or line) aggregated server-side by any dimension × metric combination.
Results table shows friendly column labels (e.g. "Fiscal Year", not "fiscal_year").

**Advanced SQL mode** — free-form SELECT against any table:
- Textarea with dark monospace styling; Cmd/Ctrl+Enter to run
- Available tables listed as a hint above the editor
- Sanitized: SELECT-only, no semicolons, forbidden keyword blocklist (INSERT/UPDATE/DELETE/DROP/CREATE/ALTER/TRUNCATE/ATTACH/PRAGMA/INSTALL/LOAD etc.)
- Limit dropdown shared with standard mode; `limit=0` = no server-side cap
- Results table shows raw column names from the query
- CSV export is client-side from the full in-memory result set
- Visualize not available in advanced mode (schema is unknown)
- **Pre-population**: switching from Standard → Advanced SQL generates a `SELECT` reflecting current column/filter state (only when editor is empty). A **"↺ Sync from standard"** button regenerates at any time.
- **Deep-link**: page reads `?sql=` URL param on mount, switches to Advanced SQL mode and pre-populates the editor (used by Process Lookup "View full data" link)

## Department Snapshot Page (`/snapshot`)
Executive summary for a specific department or PS Total. Department selector with autocomplete. `DepartmentOverview.tsx` (old page) still exists as a file but is no longer routed — `DeptSnapshot.tsx` is the active page.

- **Page title** shows "Department Snapshot — [Dept name]" when a department is filtered
- **URL state**: `?dept=` param syncs the selected department; shareable link
- **Deep-link icons (↗)** on KPI cards and module cards link to the corresponding Staffing Dashboard tab with `?dept=&tab=` pre-set
- **Headline block**: opinionated `getHeadline()` sentence (base + modifier pattern), status badge (Net inflow / Net outflow / Departures rising / Stable), FYTD period label, size tier badge, supporting context sentence, italic partial-year note when `q_count < 4`
- **4 KPI cards**: Hiring (highlighted), Departures, Net Change (`NetCard` with colour-coded background), Internal Movement (% rate with tooltip icon)
  - All YoY comparisons are FYTD-normalized via `qCount`; "This year" and "PS average" labeled rows
- **Chart**: "Hiring vs departures over time" line chart (all available years)
- **Hiring composition**: stacked bar breakdown of latest year inflow by hire type; "What's driving hiring? ↗" links to Staffing Dashboard inflow tab
- **Comparison table**: title "How does [Dept name] compare?"; 6 rows — Hiring, Departures, Hiring YoY, Departures YoY, Internal movement rate (tooltip), Advertised appointment % (tooltip); peer column from size-tier benchmark query. No colour coding — numbers speak for themselves.
- **PSC oversight indicators** divider (italic subtitle: "Appointment integrity & employment equity"), then:
  - **Advertised appointment rate** module (`HiringPipelineModule`): big %, progress bar, 3-yr rate table, then separate "Advertised processes launched" section with total/internal/external 3-yr table (from `raw_advertisements`; different source than rate — shown in same card but separate tables)
  - **Internal movement rate** module (`MobilityDetailModule`): big %, progress bar, labeled rows, 3-yr table with cross-org transfers
  - **Employment equity in hiring** card (`EERepresentationModule`): 30px dept rate + PS avg (border-left separator), comparison bars (dept vs PS), amber insight callout with narrative text; prior years top-right; ~1 year data lag note
- Data source: `GET /staffing/department-overview` (bundled endpoint); EE from `ee_snapshot` (3 years, binary self-identification only)

## Design Notes
- Global font: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` set on AppShell main area
- Page headers: `fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em'` — consistent across all pages
- `ChartCard` title: `#111827`, 15px, letter-spacing `-0.01em`; subtitle `#6b7280`, 12px
- Colour palette: primary `#1d3557`, text `#111827`, muted `#6b7280`, border `#e5e7eb`

## What's Next (not started)
- Bilingual support is wired (i18n) but translations are minimal; FR nav labels need updating to reflect removed Department Overview and renamed Department Snapshot
- No production deployment yet (Digital Ocean droplet)
- Staffing Dashboard department filter is text-only (no autocomplete)
- FSWEP application counts in `dash_advertisements` will self-correct once PSC republishes the source CSV
- Consider snapshotting quarterly ingest data (append instead of truncate per quarter) to enable true same-period year-over-year comparisons in future
- `DepartmentOverview.tsx` is unused (route removed) — can be deleted when confirmed no longer needed
