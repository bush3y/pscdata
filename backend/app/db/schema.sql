-- PSC Data Explorer — DuckDB Schema
-- All tables use CREATE TABLE IF NOT EXISTS for idempotent migrations.

CREATE TABLE IF NOT EXISTS raw_advertisements (
    fiscal_year               VARCHAR,
    car_chc_id                INTEGER,
    reference_number          VARCHAR,
    selection_process_number  VARCHAR,
    creation_date             DATE,
    open_date                 DATE,
    close_date                DATE,
    number_days_open          INTEGER,
    internal_indicator        VARCHAR,
    external_indicator        VARCHAR,
    position_title_e          VARCHAR,
    position_title_f          VARCHAR,
    classifications           VARCHAR,
    advertisement_url_e       VARCHAR,
    advertisement_url_f       VARCHAR,
    city_name_e               VARCHAR,
    city_name_f               VARCHAR,
    administrator_region_e    VARCHAR,
    administrator_region_f    VARCHAR,
    advertisement_type_e      VARCHAR,
    advertisement_type_f      VARCHAR,
    organization_e            VARCHAR,
    organization_f            VARCHAR,
    organization_code         VARCHAR,
    province_name_e           VARCHAR,
    province_name_f           VARCHAR,
    recruitment_program_e     VARCHAR,
    recruitment_program_f     VARCHAR,
    status_e                  VARCHAR,
    status_f                  VARCHAR,
    indeterminate             INTEGER,
    specified_term            INTEGER,
    acting                    INTEGER,
    assignment                INTEGER,
    deployment                INTEGER,
    secondment                INTEGER,
    total_submitted_sup       INTEGER,
    total_in_sup              INTEGER,
    total_out_sup             INTEGER,
    caf_in                    INTEGER,
    women_submitted_sup       INTEGER,
    vismin_submitted_sup      INTEGER,
    indigenous_submitted_sup  INTEGER,
    pwd_submitted_sup         INTEGER,
    french_submitted_sup      INTEGER,
    english_submitted_sup     INTEGER,
    _loaded_at                TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_inflow (
    department_e  VARCHAR,
    department_f  VARCHAR,
    fiscal_year   VARCHAR,
    quarter       VARCHAR,
    hire_e        VARCHAR,
    hire_f        VARCHAR,
    count         INTEGER,
    qtr_count     INTEGER,
    _loaded_at    TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_outflow (
    department_e   VARCHAR,
    department_f   VARCHAR,
    fiscal_year    VARCHAR,
    quarter        VARCHAR,
    sep_reason_e   VARCHAR,
    sep_reason_f   VARCHAR,
    count          INTEGER,
    qtr_count      INTEGER,
    _loaded_at     TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_internal_mobility (
    department_e  VARCHAR,
    department_f  VARCHAR,
    fiscal_year   VARCHAR,
    quarter       VARCHAR,
    mob_type_e    VARCHAR,
    mob_type_f    VARCHAR,
    count         INTEGER,
    qtr_count     INTEGER,
    _loaded_at    TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_adv_type (
    department_e  VARCHAR,
    department_f  VARCHAR,
    fiscal_year   VARCHAR,
    adv_e         VARCHAR,
    adv_f         VARCHAR,
    count         INTEGER,
    _loaded_at    TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_demo_fol (
    department_e  VARCHAR,
    department_f  VARCHAR,
    fiscal_year   VARCHAR,
    fol_e         VARCHAR,
    fol_f         VARCHAR,
    count         INTEGER,
    _loaded_at    TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_demo_ee (
    department_e  VARCHAR,
    department_f  VARCHAR,
    fiscal_year   VARCHAR,
    quarter       VARCHAR,
    ee_group_e    VARCHAR,
    ee_group_f    VARCHAR,
    count         INTEGER,
    qtr_count     INTEGER,
    _loaded_at    TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_demo_age (
    department_e  VARCHAR,
    department_f  VARCHAR,
    fiscal_year   VARCHAR,
    quarter       VARCHAR,
    hire_e        VARCHAR,
    hire_f        VARCHAR,
    age_group_e   VARCHAR,
    age_group_f   VARCHAR,
    count         INTEGER,
    qtr_count     INTEGER,
    _loaded_at    TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_demo_region (
    department_e  VARCHAR,
    department_f  VARCHAR,
    fiscal_year   VARCHAR,
    quarter       VARCHAR,
    hire_e        VARCHAR,
    hire_f        VARCHAR,
    region_e      VARCHAR,
    region_f      VARCHAR,
    count         INTEGER,
    qtr_count     INTEGER,
    _loaded_at    TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_demo_group (
    department_e  VARCHAR,
    department_f  VARCHAR,
    fiscal_year   VARCHAR,
    quarter       VARCHAR,
    hire_e        VARCHAR,
    hire_f        VARCHAR,
    occ_group_e   VARCHAR,
    occ_group_f   VARCHAR,
    count         INTEGER,
    qtr_count     INTEGER,
    _loaded_at    TIMESTAMP DEFAULT current_timestamp
);


CREATE TABLE IF NOT EXISTS dash_advertisements (
    department_e              VARCHAR,
    department_f              VARCHAR,
    fiscal_year               VARCHAR,
    quarter                   VARCHAR,
    program_e                 VARCHAR,
    program_f                 VARCHAR,
    days_cat_e                VARCHAR,
    days_cat_f                VARCHAR,
    count                     INTEGER,
    qtr_count                 INTEGER,
    appl_submitted_mean       DOUBLE,
    qtr_appl_submitted_mean   DOUBLE,
    appl_submitted_sum        INTEGER,
    qtr_appl_submitted_sum    INTEGER,
    _loaded_at                TIMESTAMP DEFAULT current_timestamp
);

-- ── Priority & Veterans tables ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dash_priority (
    province_e              VARCHAR,
    province_f              VARCHAR,
    class_e                 VARCHAR,
    class_f                 VARCHAR,
    count                   INTEGER,
    processing_date         VARCHAR,
    _loaded_at              TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_reappointments (
    fiscal_year             VARCHAR,
    department_e            VARCHAR,
    department_f            VARCHAR,
    count                   INTEGER,
    priority_count          INTEGER,
    _loaded_at              TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_vha_1 (
    fiscal_year                 VARCHAR,
    provision_type_e            VARCHAR,
    provision_type_f            VARCHAR,
    application_type_e          VARCHAR,
    application_type_f          VARCHAR,
    applications_count          INTEGER,
    total_internal_adv_count    INTEGER,
    total_external_adv_count    INTEGER,
    processing_date             VARCHAR,
    _loaded_at                  TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_vha_2 (
    fiscal_year             VARCHAR,
    type_e                  VARCHAR,
    type_f                  VARCHAR,
    reg_app_e               VARCHAR,
    reg_app_f               VARCHAR,
    count                   INTEGER,
    processing_date         VARCHAR,
    _loaded_at              TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS dash_vha_3 (
    fiscal_year             VARCHAR,
    eligibility_reason_e    VARCHAR,
    eligibility_reason_f    VARCHAR,
    count                   INTEGER,
    processing_date         VARCHAR,
    _loaded_at              TIMESTAMP DEFAULT current_timestamp
);

-- ── TBS Population tables ────────────────────────────────────────────────────
-- Source: TBS "Federal Public Service Statistics" dataset (f0d12b41-54dc-4784-ad2b-83dffed2ab84)
-- Year = March 31 snapshot — maps to PSC fiscal year (year-1)-(year) e.g. 2025 = FY 2024-2025

CREATE TABLE IF NOT EXISTS tbs_pop_dept (
    year        INTEGER,
    universe    VARCHAR,
    dept_e      VARCHAR,
    count       INTEGER,
    _loaded_at  TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS tbs_pop_tenure (
    year        INTEGER,
    dept_e      VARCHAR,
    tenure_e    VARCHAR,
    count       INTEGER,
    _loaded_at  TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS ingest_log (
    id              INTEGER,
    dataset_key     VARCHAR,
    resource_name   VARCHAR,
    resource_url    VARCHAR,
    status          VARCHAR,
    rows_loaded     INTEGER,
    error_message   VARCHAR,
    started_at      TIMESTAMP,
    finished_at     TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dataset_registry (
    dataset_id        VARCHAR PRIMARY KEY,
    dataset_key       VARCHAR,
    title_en          VARCHAR,
    title_fr          VARCHAR,
    frequency         VARCHAR,
    last_ingested_at  TIMESTAMP,
    total_records     INTEGER,
    source_url        VARCHAR
);

-- ── Additive migrations for raw_advertisements ───────────────────────────────
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS is idempotent — safe to run every startup.

ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS car_chc_id INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS selection_process_number VARCHAR;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS creation_date DATE;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS number_days_open INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS advertisement_url_e VARCHAR;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS advertisement_url_f VARCHAR;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS city_name_e VARCHAR;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS city_name_f VARCHAR;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS assignment INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS deployment INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS secondment INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS total_out_sup INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS women_submitted_sup INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS vismin_submitted_sup INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS indigenous_submitted_sup INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS pwd_submitted_sup INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS french_submitted_sup INTEGER;
ALTER TABLE raw_advertisements ADD COLUMN IF NOT EXISTS english_submitted_sup INTEGER;
ALTER TABLE dash_demo_age    ADD COLUMN IF NOT EXISTS hire_e VARCHAR;
ALTER TABLE dash_demo_age    ADD COLUMN IF NOT EXISTS hire_f VARCHAR;
ALTER TABLE dash_demo_region ADD COLUMN IF NOT EXISTS hire_e VARCHAR;
ALTER TABLE dash_demo_region ADD COLUMN IF NOT EXISTS hire_f VARCHAR;
ALTER TABLE dash_demo_group  ADD COLUMN IF NOT EXISTS hire_e VARCHAR;
ALTER TABLE dash_demo_group  ADD COLUMN IF NOT EXISTS hire_f VARCHAR;

-- ── Views ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_recruitment_funnel AS
SELECT
    fiscal_year,
    COUNT(DISTINCT reference_number)                              AS advertisement_count,
    SUM(total_submitted_sup)                                      AS total_applicants,
    SUM(total_in_sup)                                             AS screened_in,
    ROUND(
        CAST(SUM(total_submitted_sup) AS DOUBLE) /
        NULLIF(COUNT(DISTINCT reference_number), 0), 1
    )                                                             AS avg_applicants_per_adv,
    ROUND(
        100.0 * CAST(SUM(total_in_sup) AS DOUBLE) /
        NULLIF(SUM(total_submitted_sup), 0), 1
    )                                                             AS screened_in_rate_pct
FROM raw_advertisements
GROUP BY fiscal_year
ORDER BY fiscal_year;

CREATE OR REPLACE VIEW v_funnel_by_region AS
SELECT
    fiscal_year,
    administrator_region_e                                        AS region_e,
    administrator_region_f                                        AS region_f,
    COUNT(DISTINCT reference_number)                              AS advertisement_count,
    SUM(total_submitted_sup)                                      AS total_applicants,
    SUM(total_in_sup)                                             AS screened_in
FROM raw_advertisements
GROUP BY fiscal_year, administrator_region_e, administrator_region_f
ORDER BY fiscal_year, administrator_region_e;

CREATE OR REPLACE VIEW v_adv_trend AS
SELECT
    fiscal_year,
    COUNT(DISTINCT reference_number) AS advertisement_count
FROM raw_advertisements
GROUP BY fiscal_year
ORDER BY fiscal_year;


CREATE TABLE IF NOT EXISTS snps_responses (
    year              INTEGER,
    dept_e            VARCHAR,
    dept_f            VARCHAR,
    question          VARCHAR,
    question_value_e  VARCHAR,
    question_value_f  VARCHAR,
    shr_w_resp        DOUBLE,
    total_w_resp      INTEGER,
    _loaded_at        TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS snps_questions (
    year            INTEGER,
    question        VARCHAR,
    category_e      VARCHAR,
    category_f      VARCHAR,
    theme_e         VARCHAR,
    theme_f         VARCHAR,
    question_e      VARCHAR,
    question_f      VARCHAR,
    question_type   VARCHAR,
    include_scatter BOOLEAN,
    _loaded_at      TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS snps_response_profile (
    year           INTEGER,
    dept_e         VARCHAR,
    dept_f         VARCHAR,
    respondents_e  VARCHAR,
    respondents_f  VARCHAR,
    count          INTEGER,
    _loaded_at     TIMESTAMP DEFAULT current_timestamp
);

-- Cross-tabulation data from snps02–snps24: response distributions broken down by demographic variable.
-- breakdown_var: canonical question code for the segmentation dimension (e.g. AGG_35, FOL_05, GDR_10)
-- breakdown_value_e/f: the specific category within that dimension (e.g. "25 to 29 years", "All respondents")
-- question / question_value_e/f: the survey question and response option being cross-tabulated
CREATE TABLE IF NOT EXISTS snps_crosstabs (
    year               INTEGER NOT NULL,
    dept_e             VARCHAR,
    dept_f             VARCHAR,
    breakdown_var      VARCHAR NOT NULL,
    breakdown_value_e  VARCHAR,
    breakdown_value_f  VARCHAR,
    question           VARCHAR NOT NULL,
    question_value_e   VARCHAR,
    question_value_f   VARCHAR,
    shr_w_resp         DOUBLE,
    total_w_resp       DOUBLE,
    _loaded_at         TIMESTAMP DEFAULT current_timestamp
);

ALTER TABLE snps_questions ADD COLUMN IF NOT EXISTS question_type VARCHAR;
ALTER TABLE snps_questions ADD COLUMN IF NOT EXISTS include_scatter BOOLEAN;
