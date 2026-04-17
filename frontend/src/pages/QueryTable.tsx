import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';
import { useFilterOptions } from '../api/advertisements';
import MultiSelectCombobox from '../components/common/MultiSelectCombobox';
import DataTable from '../components/common/DataTable';
import BarChartWrapper from '../components/charts/BarChartWrapper';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';
import ChartCard from '../components/charts/ChartCard';

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMN_GROUPS: { label: string; columns: { key: string; label: string }[] }[] = [
  {
    label: 'Identifiers',
    columns: [
      { key: 'fiscal_year',              label: 'Fiscal Year' },
      { key: 'selection_process_number', label: 'Selection Process #' },
      { key: 'reference_number',         label: 'Reference #' },
      { key: 'car_chc_id',               label: 'car_chc_id' },
      { key: 'open_date',                label: 'Open Date' },
      { key: 'close_date',               label: 'Close Date' },
      { key: 'creation_date',            label: 'Creation Date' },
      { key: 'number_days_open',         label: 'Days Open' },
    ],
  },
  {
    label: 'Position',
    columns: [
      { key: 'position_title_e',      label: 'Position Title' },
      { key: 'classifications',       label: 'Classification' },
      { key: 'advertisement_type_e',  label: 'Ad Type' },
      { key: 'recruitment_program_e', label: 'Recruitment Program' },
    ],
  },
  {
    label: 'Location',
    columns: [
      { key: 'administrator_region_e', label: 'Region' },
      { key: 'province_name_e',        label: 'Province' },
      { key: 'city_name_e',            label: 'City' },
    ],
  },
  {
    label: 'Organization',
    columns: [
      { key: 'organization_e',    label: 'Organization' },
      { key: 'organization_code', label: 'Org Code' },
    ],
  },
  {
    label: 'Status',
    columns: [
      { key: 'status_e',            label: 'Status' },
      { key: 'internal_indicator',  label: 'Internal' },
      { key: 'external_indicator',  label: 'External' },
    ],
  },
  {
    label: 'Metrics',
    columns: [
      { key: 'total_submitted_sup', label: 'Submitted' },
      { key: 'total_in_sup',        label: 'Screened In' },
      { key: 'total_out_sup',       label: 'Screened Out' },
      { key: 'caf_in',              label: 'CAF Members' },
    ],
  },
  {
    label: 'EE Applicants',
    columns: [
      { key: 'women_submitted_sup',      label: 'Women' },
      { key: 'vismin_submitted_sup',     label: 'Visible Minority' },
      { key: 'indigenous_submitted_sup', label: 'Indigenous' },
      { key: 'pwd_submitted_sup',        label: 'Persons w/ Disabilities' },
      { key: 'french_submitted_sup',     label: 'Francophone' },
      { key: 'english_submitted_sup',    label: 'Anglophone' },
    ],
  },
  {
    label: 'Tenure',
    columns: [
      { key: 'indeterminate',  label: 'Indeterminate' },
      { key: 'specified_term', label: 'Specified Term' },
      { key: 'acting',         label: 'Acting' },
      { key: 'assignment',     label: 'Assignment' },
      { key: 'deployment',     label: 'Deployment' },
      { key: 'secondment',     label: 'Secondment' },
    ],
  },
];

const ALL_COLUMNS = COLUMN_GROUPS.flatMap(g => g.columns);

const DEFAULT_SELECTED = new Set([
  'fiscal_year', 'organization_e', 'position_title_e',
  'administrator_region_e', 'advertisement_type_e', 'status_e',
  'total_submitted_sup', 'total_in_sup',
]);

const NUMERIC_COLS = new Set([
  'total_submitted_sup', 'total_in_sup', 'total_out_sup', 'caf_in',
  'number_days_open',
  'women_submitted_sup', 'vismin_submitted_sup', 'indigenous_submitted_sup',
  'pwd_submitted_sup', 'french_submitted_sup', 'english_submitted_sup',
]);

const VIZ_METRICS = [
  { key: 'adv_count',                label: 'Advertisements' },
  { key: 'total_submitted_sup',      label: 'Submitted' },
  { key: 'total_in_sup',             label: 'Screened In' },
  { key: 'total_out_sup',            label: 'Screened Out' },
  { key: 'caf_in',                   label: 'CAF Members' },
  { key: 'number_days_open',         label: 'Days Open' },
  { key: 'women_submitted_sup',      label: 'Women Applicants' },
  { key: 'vismin_submitted_sup',     label: 'Visible Minority Applicants' },
  { key: 'indigenous_submitted_sup', label: 'Indigenous Applicants' },
  { key: 'pwd_submitted_sup',        label: 'Persons w/ Disabilities Applicants' },
  { key: 'french_submitted_sup',     label: 'Francophone Applicants' },
  { key: 'english_submitted_sup',    label: 'Anglophone Applicants' },
];

const FISCAL_YEARS = [
  '2017-2018','2018-2019','2019-2020','2020-2021',
  '2021-2022','2022-2023','2023-2024','2024-2025','2025-2026',
];

// Available tables for the SQL helper hint
const AVAILABLE_TABLES = [
  'raw_advertisements',
  'dash_inflow', 'dash_outflow', 'dash_internal_mobility',
  'dash_adv_type', 'dash_advertisements', 'dash_demo_ee',
  'dash_demo_age', 'dash_demo_region', 'dash_demo_group',
  'dash_priority', 'dash_reappointments',
  'dash_vha_1', 'dash_vha_2', 'dash_vha_3',
  'tbs_pop_dept', 'tbs_pop_tenure',
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Filters {
  fiscal_year: string[];
  organization: string[];
  region: string[];
  status: string[];
  advertisement_type: string[];
  recruitment_program: string[];
  classifications: string[];
}

interface RunConfig {
  columns: string[];
  filters: Filters;
  limit: number;
}

interface VizConfig {
  xCol: string;
  yCol: string;
  chartType: 'bar' | 'line';
  asPct: boolean;
}

const EMPTY_FILTERS: Filters = {
  fiscal_year: [],
  organization: [],
  region: [],
  status: [],
  advertisement_type: [],
  recruitment_program: [],
  classifications: [],
};

// ── Styles ────────────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  background: '#f8f9fa',
  border: '1px solid #dee2e6',
  borderRadius: 6,
  padding: '14px 16px',
  marginBottom: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#6c757d',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 10,
};


const selectStyle: React.CSSProperties = {
  padding: '5px 10px',
  border: '1px solid #ced4da',
  borderRadius: 4,
  fontSize: 13,
  background: '#fff',
};

const btnStyle = (variant: 'primary' | 'secondary' | 'green'): React.CSSProperties => ({
  padding: '6px 16px',
  borderRadius: 4,
  border: variant === 'primary' ? 'none' : variant === 'green' ? '1px solid #28a745' : '1px solid #ced4da',
  background: variant === 'primary' ? '#1d3557' : '#fff',
  color: variant === 'primary' ? '#fff' : variant === 'green' ? '#28a745' : '#495057',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: variant === 'primary' ? 600 : 400,
});

const checkboxLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  cursor: 'pointer',
  userSelect: 'none',
};

const VIZ_BAR_LIMIT = 30;

// ── SQL generator ────────────────────────────────────────────────────────────

const FILTER_COL_MAP: Record<keyof Filters, string> = {
  fiscal_year:        'fiscal_year',
  organization:       'organization_e',
  region:             'administrator_region_e',
  status:             'status_e',
  advertisement_type: 'advertisement_type_e',
  recruitment_program:'recruitment_program_e',
  classifications:    'classifications',
};

function buildSQL(selectedCols: Set<string>, filters: Filters, limit: number): string {
  const cols = ALL_COLUMNS.map(c => c.key).filter(k => selectedCols.has(k));
  const colList = cols.length > 0 ? cols.join(',\n  ') : '*';

  const conditions: string[] = [];
  (Object.keys(filters) as (keyof Filters)[]).forEach(key => {
    const vals = filters[key];
    if (!vals.length) return;
    const col = FILTER_COL_MAP[key];
    const quoted = vals.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
    conditions.push(`${col} IN (${quoted})`);
  });

  const where = conditions.length > 0 ? `\nWHERE ${conditions.join('\n  AND ')}` : '';
  const limitClause = limit > 0 ? `\nLIMIT ${limit}` : '';

  return `SELECT\n  ${colList}\nFROM raw_advertisements${where}${limitClause}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function QueryTable() {
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(DEFAULT_SELECTED));
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [limit, setLimit] = useState(1000);
  const [runConfig, setRunConfig] = useState<RunConfig | null>(null);
  const [showViz, setShowViz] = useState(false);
  const [viz, setViz] = useState<VizConfig>({ xCol: 'fiscal_year', yCol: 'adv_count', chartType: 'bar', asPct: false });

  // Advanced SQL mode
  const [advancedMode, setAdvancedMode] = useState(false);
  const [sqlText, setSqlText] = useState('');
  const [advancedRunSql, setAdvancedRunSql] = useState<{ sql: string; limit: number } | null>(null);

  const { data: filterOptions } = useFilterOptions();

  // Columns actually present in the loaded result (frozen at run time)
  const loadedCols = ALL_COLUMNS.filter(c => runConfig?.columns.includes(c.key));
  const loadedDimCols = loadedCols.filter(c => !NUMERIC_COLS.has(c.key));

  // Reset viz defaults whenever a new query is run
  useEffect(() => {
    if (!runConfig) return;
    const cols = ALL_COLUMNS.filter(c => runConfig.columns.includes(c.key));
    const dims = cols.filter(c => !NUMERIC_COLS.has(c.key));
    setViz({
      xCol: dims[0]?.key ?? cols[0]?.key ?? '',
      yCol: 'adv_count',
      chartType: 'bar',
      asPct: false,
    });
  }, [runConfig]);

  const {
    data: advData,
    isLoading: advLoading,
    isError: advIsError,
    error: advError,
  } = useQuery<{ rows: Record<string, unknown>[]; row_count: number; capped: boolean; columns: string[] }>({
    queryKey: ['raw-query', advancedRunSql],
    queryFn: () => {
      if (!advancedRunSql) return Promise.resolve({ rows: [], row_count: 0, capped: false, columns: [] });
      return client.post('/query/raw', advancedRunSql).then(r => r.data);
    },
    enabled: advancedRunSql !== null,
    retry: false,
  });

  const { data, isLoading, isError } = useQuery<Record<string, unknown>[]>({
    queryKey: ['custom-query', runConfig],
    queryFn: () => {
      if (!runConfig) return Promise.resolve([]);
      const params = new URLSearchParams();
      runConfig.columns.forEach(c => params.append('columns', c));
      const f = runConfig.filters;
      f.fiscal_year.forEach(v => params.append('fiscal_year', v));
      f.organization.forEach(v => params.append('organization', v));
      f.region.forEach(v => params.append('region', v));
      f.status.forEach(v => params.append('status', v));
      f.advertisement_type.forEach(v => params.append('advertisement_type', v));
      f.recruitment_program.forEach(v => params.append('recruitment_program', v));
      f.classifications.forEach(v => params.append('classifications', v));
      params.set('limit', String(runConfig.limit));
      return client.get('/advertisements', { params }).then(r => r.data);
    },
    enabled: runConfig !== null,
  });

  const toggleCol = (key: string) => {
    setSelectedCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroupAll = (keys: string[], allSelected: boolean) => {
    setSelectedCols(prev => {
      const next = new Set(prev);
      if (allSelected) keys.forEach(k => next.delete(k));
      else keys.forEach(k => next.add(k));
      return next;
    });
  };

  const handleAdvancedExport = () => {
    if (!advData || advData.rows.length === 0) return;
    const cols = advData.columns;
    const escape = (v: unknown) => JSON.stringify(v ?? '');
    const csv = [cols.join(','), ...advData.rows.map(row => cols.map(c => escape(row[c])).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'query_results.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleRun = () => {
    const orderedCols = ALL_COLUMNS.map(c => c.key).filter(k => selectedCols.has(k));
    if (orderedCols.length === 0) return;
    setRunConfig({ columns: orderedCols, filters: { ...filters }, limit });
    setShowViz(false);
  };

  const handleExport = () => {
    if (!runConfig) return;
    const params = new URLSearchParams();
    runConfig.columns.forEach(c => params.append('columns', c));
    const f = runConfig.filters;
    f.fiscal_year.forEach(v => params.append('fiscal_year', v));
    f.organization.forEach(v => params.append('organization', v));
    f.region.forEach(v => params.append('region', v));
    f.status.forEach(v => params.append('status', v));
    f.advertisement_type.forEach(v => params.append('advertisement_type', v));
    f.recruitment_program.forEach(v => params.append('recruitment_program', v));
    f.classifications.forEach(v => params.append('classifications', v));
    params.set('limit', String(runConfig.limit));
    params.set('format', 'csv');
    window.location.href = `/api/v1/advertisements?${params.toString()}`;
  };

  const { data: aggRaw, isLoading: aggLoading } = useQuery<{ x: string; y: number }[]>({
    queryKey: ['adv-aggregate', runConfig, viz.xCol, viz.yCol, viz.asPct],
    queryFn: () => {
      if (!runConfig || !viz.xCol || !viz.yCol) return Promise.resolve([]);
      const params = new URLSearchParams({ group_by: viz.xCol, metric: viz.yCol, as_pct: String(viz.asPct) });
      const f = runConfig.filters;
      f.fiscal_year.forEach(v => params.append('fiscal_year', v));
      f.organization.forEach(v => params.append('organization', v));
      f.region.forEach(v => params.append('region', v));
      f.status.forEach(v => params.append('status', v));
      f.advertisement_type.forEach(v => params.append('advertisement_type', v));
      f.recruitment_program.forEach(v => params.append('recruitment_program', v));
      f.classifications.forEach(v => params.append('classifications', v));
      return client.get('/advertisements/aggregate', { params }).then(r => r.data);
    },
    enabled: showViz && !!runConfig && !!viz.xCol && !!viz.yCol,
  });

  const allVizRows = (aggRaw ?? []).map(r => ({ [viz.xCol]: r.x, [viz.yCol]: r.y }));
  const vizTruncated = allVizRows.length > VIZ_BAR_LIMIT;
  const vizData = vizTruncated
    ? [...allVizRows].sort((a, b) => (b[viz.yCol] as number) - (a[viz.yCol] as number)).slice(0, VIZ_BAR_LIMIT)
    : allVizRows;

  const yColLabel = VIZ_METRICS.find(m => m.key === viz.yCol)?.label ?? viz.yCol;
  const xColLabel = ALL_COLUMNS.find(c => c.key === viz.xCol)?.label ?? viz.xCol;
  const hasFilters = runConfig ? Object.entries(runConfig.filters).some(([, v]) => v.length > 0) : false;

  const activeData        = advancedMode ? (advData?.rows ?? null)  : (data ?? null);
  const activeLoading     = advancedMode ? advLoading               : isLoading;
  const activeIsError     = advancedMode ? advIsError               : isError;
  const activeColumns     = advancedMode ? (advData?.columns)       : loadedCols;
  const activeRowCount    = advancedMode ? advData?.row_count       : data?.length;
  const activeHasRun      = advancedMode ? advancedRunSql !== null  : runConfig !== null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>Data Explorer</h2>
        {/* Mode toggle */}
        <div style={{ display: 'flex', background: '#f1f3f5', borderRadius: 6, padding: 3, gap: 2 }}>
          {(['Standard', 'Advanced SQL'] as const).map(mode => {
            const active = (mode === 'Advanced SQL') === advancedMode;
            return (
              <button
                key={mode}
                onClick={() => {
                const goAdvanced = mode === 'Advanced SQL';
                if (goAdvanced && !sqlText.trim()) {
                  setSqlText(buildSQL(selectedCols, filters, limit));
                }
                setAdvancedMode(goAdvanced);
                setShowViz(false);
              }}
                style={{
                  padding: '5px 14px', borderRadius: 4, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: active ? 700 : 400,
                  background: active ? '#fff' : 'transparent',
                  color: active ? '#1d3557' : '#6c757d',
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {mode}
              </button>
            );
          })}
        </div>
      </div>

      {/* Column Picker (Standard only) */}
      {!advancedMode && <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Columns</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px 24px' }}>
          {COLUMN_GROUPS.map(group => {
            const groupKeys = group.columns.map(c => c.key);
            const allSelected = groupKeys.every(k => selectedCols.has(k));
            return (
              <div key={group.label}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#495057' }}>{group.label}</span>
                  <button
                    onClick={() => toggleGroupAll(groupKeys, allSelected)}
                    style={{ fontSize: 11, color: '#1d3557', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                  >
                    {allSelected ? 'none' : 'all'}
                  </button>
                </div>
                {group.columns.map(col => (
                  <label key={col.key} style={{ ...checkboxLabel, marginBottom: 4, display: 'flex' }}>
                    <input
                      type="checkbox"
                      checked={selectedCols.has(col.key)}
                      onChange={() => toggleCol(col.key)}
                    />
                    <span style={{ color: NUMERIC_COLS.has(col.key) ? '#1d3557' : '#343a40' }}>{col.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>}

      {/* Filters (Standard only) */}
      {!advancedMode && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Filters</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 4 }}>Fiscal Year</div>
              <MultiSelectCombobox
                value={filters.fiscal_year}
                onChange={val => setFilters(f => ({ ...f, fiscal_year: val }))}
                options={FISCAL_YEARS}
                placeholder="Select fiscal year…"
              />
            </div>
            {(
              [
                { field: 'organization', label: 'Organization' },
                { field: 'region', label: 'Region' },
                { field: 'status', label: 'Status' },
                { field: 'advertisement_type', label: 'Ad Type' },
                { field: 'recruitment_program', label: 'Recruitment Program' },
                { field: 'classifications', label: 'Classification' },
              ] as { field: keyof Filters; label: string }[]
            ).map(({ field, label }) => {
              const options = filterOptions?.[field as keyof typeof filterOptions] ?? [];
              return (
                <div key={field}>
                  <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 4 }}>{label}</div>
                  <MultiSelectCombobox
                    value={filters[field] as string[]}
                    onChange={val => setFilters(f => ({ ...f, [field]: val }))}
                    options={options}
                    placeholder={`Filter by ${label.toLowerCase()}…`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Advanced SQL editor */}
      {advancedMode && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={sectionTitleStyle}>SQL Query</div>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              Tables: {AVAILABLE_TABLES.join(' · ')}
            </span>
          </div>
          <textarea
            value={sqlText}
            onChange={e => setSqlText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setAdvancedRunSql({ sql: sqlText.trim(), limit });
              }
            }}
            placeholder={`SELECT organization_e, COUNT(*) AS ads\nFROM raw_advertisements\nWHERE fiscal_year = '2024-2025'\nGROUP BY organization_e\nORDER BY ads DESC`}
            spellCheck={false}
            style={{
              width: '100%', boxSizing: 'border-box',
              fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
              fontSize: 13, lineHeight: 1.6,
              padding: '10px 12px', borderRadius: 4,
              border: '1px solid #ced4da', background: '#1e1e2e', color: '#cdd6f4',
              resize: 'vertical', minHeight: 140, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>SELECT only · no semicolons · Cmd/Ctrl+Enter to run</span>
            <button
              onClick={() => setSqlText(buildSQL(selectedCols, filters, limit))}
              style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              title="Regenerate from standard column/filter selection"
            >
              ↺ Sync from standard
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          style={btnStyle('primary')}
          onClick={() => {
            if (advancedMode) {
              setAdvancedRunSql({ sql: sqlText.trim(), limit });
            } else {
              handleRun();
            }
          }}
        >
          Run Query
        </button>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#6c757d' }}>Limit</span>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={selectStyle}>
            <option value={100}>100</option>
            <option value={500}>500</option>
            <option value={1000}>1,000</option>
            <option value={5000}>5,000</option>
            <option value={10000}>10,000</option>
            <option value={25000}>25,000</option>
            <option value={50000}>50,000</option>
            <option value={100000}>100,000</option>
            <option value={0}>All rows</option>
          </select>
        </label>
        {activeRowCount != null && activeRowCount > 0 && (
          <>
            <span style={{ fontSize: 13, color: '#6c757d' }}>
              {activeRowCount.toLocaleString()} rows
              {advancedMode && advData?.capped && (
                <span style={{ color: '#f59e0b' }}> (capped — increase limit or narrow query)</span>
              )}
            </span>
            {advancedMode
              ? <button style={btnStyle('green')} onClick={handleAdvancedExport}>Export CSV</button>
              : <button style={btnStyle('green')} onClick={handleExport}>Export CSV</button>
            }
          </>
        )}
        <button
          style={{ ...btnStyle('secondary'), marginLeft: 'auto' }}
          onClick={() => {
            if (advancedMode) {
              setSqlText('');
              setAdvancedRunSql(null);
            } else {
              setFilters(EMPTY_FILTERS);
              setRunConfig(null);
            }
          }}
        >
          Clear
        </button>
      </div>

      {/* Results */}
      {activeLoading && <p style={{ color: '#6c757d', fontSize: 13 }}>Loading…</p>}

      {activeIsError && (
        <div style={{ color: '#721c24', background: '#f8d7da', padding: 12, borderRadius: 6, fontSize: 13, fontFamily: advancedMode ? 'monospace' : 'inherit' }}>
          {advancedMode
            ? (advError as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Query failed.'
            : 'Query failed. Check your filters and try again.'
          }
        </div>
      )}

      {!activeLoading && !activeIsError && activeHasRun && (activeData?.length ?? 0) === 0 && (
        <p style={{ color: '#6c757d', fontSize: 13 }}>No results.</p>
      )}

      {activeData && activeData.length > 0 && (
        <>
          <DataTable data={activeData} columns={activeColumns} pageSize={50} />

          {/* Visualize (Standard mode only — advanced results have unknown schema) */}
          {!advancedMode && (
            <div style={{ marginTop: 20 }}>
              <button
                style={{ ...btnStyle('secondary'), marginBottom: 12 }}
                onClick={() => setShowViz(v => !v)}
              >
                {showViz ? 'Hide Chart' : 'Visualize'}
              </button>

              {showViz && (
                <div style={sectionStyle}>
                  <div style={sectionTitleStyle}>Chart Options</div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
                    <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ color: '#6c757d' }}>X Axis (group by)</span>
                      <select
                        value={viz.xCol}
                        onChange={e => setViz(v => ({ ...v, xCol: e.target.value }))}
                        style={selectStyle}
                      >
                        {loadedDimCols.map(c => (
                          <option key={c.key} value={c.key}>{c.label}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ color: '#6c757d' }}>Y Axis</span>
                      <select
                        value={viz.yCol}
                        onChange={e => setViz(v => ({ ...v, yCol: e.target.value }))}
                        style={selectStyle}
                      >
                        {VIZ_METRICS.map(m => (
                          <option key={m.key} value={m.key}>{m.label}</option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ color: '#6c757d' }}>Chart Type</span>
                      <select
                        value={viz.chartType}
                        onChange={e => setViz(v => ({ ...v, chartType: e.target.value as 'bar' | 'line' }))}
                        style={selectStyle}
                      >
                        <option value="bar">Bar</option>
                        <option value="line">Line</option>
                      </select>
                    </label>
                    <label style={{
                      fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                      opacity: hasFilters ? 1 : 0.4,
                      cursor: hasFilters ? 'pointer' : 'not-allowed',
                      paddingBottom: 2,
                    }}>
                      <input
                        type="checkbox"
                        checked={viz.asPct}
                        disabled={!hasFilters}
                        onChange={e => setViz(v => ({ ...v, asPct: e.target.checked }))}
                      />
                      % of all ads
                    </label>
                  </div>

                  {loadedDimCols.length === 0 ? (
                    <p style={{ color: '#6c757d', fontSize: 13 }}>Include at least one non-metric column to use as the X axis.</p>
                  ) : aggLoading ? (
                    <p style={{ color: '#6c757d', fontSize: 13 }}>Loading chart…</p>
                  ) : (
                    <>
                      {vizTruncated && (
                        <p style={{ fontSize: 12, color: '#6c757d', marginBottom: 8 }}>
                          Showing top {VIZ_BAR_LIMIT} values by {yColLabel}. Narrow your filters to see more.
                        </p>
                      )}
                      <ChartCard title={viz.asPct ? `${yColLabel} as % of all ads, by ${xColLabel}` : `${yColLabel} by ${xColLabel}`}>
                        {viz.chartType === 'bar' ? (
                          <BarChartWrapper
                            data={vizData as Record<string, unknown>[]}
                            xKey={viz.xCol}
                            bars={[{ key: viz.yCol, name: yColLabel, color: '#1d3557' }]}
                          />
                        ) : (
                          <TimeSeriesChart
                            data={vizData as Record<string, number | string>[]}
                            xKey={viz.xCol}
                            series={[{ key: viz.yCol, name: yColLabel, color: '#1d3557' }]}
                          />
                        )}
                      </ChartCard>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
