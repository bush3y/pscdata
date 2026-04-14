export interface DatasetMeta {
  dataset_id: string;
  dataset_key: string;
  title_en: string;
  title_fr: string | null;
  frequency: string;
  last_ingested_at: string | null;
  total_records: number | null;
  source_url: string | null;
}

export interface FunnelRow {
  fiscal_year: string;
  advertisement_count: number;
  total_applicants: number | null;
  screened_in: number | null;
  avg_applicants_per_adv: number | null;
  screened_in_rate_pct: number | null;
}

export interface FunnelByRegionRow {
  fiscal_year: string;
  region_e: string;
  region_f: string | null;
  advertisement_count: number;
  total_applicants: number | null;
  screened_in: number | null;
}

export interface AdvertisementSummary {
  fiscal_year: string;
  advertisement_count: number;
}

export interface StaffingDemoRow {
  fiscal_year: string;
  quarter: string;
  department_e: string;
  count: number;
  qtr_count: number;
  [key: string]: string | number | null;
}


export interface IngestLog {
  id: number;
  dataset_key: string;
  resource_name: string;
  status: string;
  rows_loaded: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface FilterState {
  fiscal_year?: string[];
  region?: string;
  department?: string;
  quarter?: string;
}

/**
 * Return the English or French label for a row field.
 * e.g. langField(row, 'region', 'fr') → row['region_f'] ?? row['region_e']
 */
export function langField(
  row: Record<string, unknown>,
  field: string,
  lang: string
): string | null {
  const suffix = lang === 'fr' ? 'f' : 'e';
  const primary = row[`${field}_${suffix}`];
  const fallback = row[`${field}_e`];
  if (typeof primary === 'string' && primary) return primary;
  if (typeof fallback === 'string' && fallback) return fallback;
  return null;
}
