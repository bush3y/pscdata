import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';
import {
  useStaffingInflow,
  useStaffingOutflow,
  useStaffingMobility,
  useStaffingAdvAggregate,
  useStaffingAdvType,
  useStaffingDemo,
  useStaffingSummary,
  useStaffingPriority,
  useStaffingReappointments,
  useStaffingVha,
  type StaffingSummary,
} from '../api/staffing';
import { useAdvertisementAggregate } from '../api/advertisements';
import {
  BarChart, Bar, LineChart, Line, Cell, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import ChartCard from '../components/charts/ChartCard';
import LoadingSpinner from '../components/common/LoadingSpinner';
import MultiSelectCombobox from '../components/common/MultiSelectCombobox';

// ── Department autocomplete ─────────────────────────────────────────────────

function DeptAutocomplete({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [input, setInput] = useState(value);
  const [open, setOpen]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  const { data: departments = [] } = useQuery<string[]>({
    queryKey: ['staffing-departments'],
    queryFn: () => client.get('/staffing/departments').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    return q ? departments.filter(d => d.toLowerCase().includes(q)) : departments;
  }, [input, departments]);

  useEffect(() => { setInput(value); }, [value]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!inputRef.current?.contains(e.target as Node) && !listRef.current?.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function select(dept: string) {
    setInput(dept);
    onChange(dept);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <input
        ref={inputRef}
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setInput(value); }}
        onKeyDown={e => { if (e.key === 'Escape') { setInput(value); setOpen(false); } if (e.key === 'Enter' && filtered.length === 1) select(filtered[0]); }}
        placeholder="Type a department name…"
        style={{
          width: '100%', padding: '6px 30px 6px 10px', fontSize: 13,
          border: '1px solid #ced4da', borderRadius: 4,
          boxSizing: 'border-box', outline: 'none', background: '#fff', color: '#212529',
        }}
      />
      {input && (
        <button
          onClick={() => { setInput(''); onChange(''); setOpen(false); }}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, padding: 0, lineHeight: 1 }}
        >×</button>
      )}
      {open && filtered.length > 0 && (
        <ul ref={listRef} style={{
          position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0,
          margin: 0, padding: '4px 0', listStyle: 'none',
          background: '#fff', border: '1px solid #ced4da', borderRadius: 4,
          zIndex: 200, boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.slice(0, 80).map(opt => (
            <li
              key={opt}
              onMouseDown={() => select(opt)}
              style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', color: '#374151' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f8ff')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{opt}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Constants ──────────────────────────────────────────────────────────────

const FISCAL_YEARS = [
  '2011-2012','2012-2013','2013-2014','2014-2015','2015-2016',
  '2016-2017','2017-2018','2018-2019','2019-2020','2020-2021',
  '2021-2022','2022-2023','2023-2024','2024-2025','2025-2026',
];

const TABS = [
  { key: 'advertisements', label: 'Advertisements' },
  { key: 'inflow',         label: 'Inflow' },
  { key: 'outflow',        label: 'Outflow' },
  { key: 'mobility',       label: 'Internal Mobility' },
  { key: 'demographics',   label: 'Demographics' },
  { key: 'priority',       label: 'Priority & Veterans' },
] as const;

type TabKey = typeof TABS[number]['key'];

// Dimensions available when metric uses raw_advertisements
const ADV_DIMS = [
  { key: 'recruitment_program_e',  label: 'Program' },
  { key: 'advertisement_type_e',   label: 'Ad Type' },
  { key: 'administrator_region_e', label: 'Region' },
  { key: 'classifications',        label: 'Classification' },
  { key: 'status_e',               label: 'Status' },
] as const;

// Dimensions available for applications (dash_advertisements source)
const APP_DIMS = [
  { key: 'program_e',  label: 'Program' },
  { key: 'days_cat_e', label: 'Days to Close' },
] as const;

const PROGRAM_LABELS: Record<string, string> = {
  FSWEP: 'Fed. Student Work Experience',
  INT:   'Internal',
  JOP:   'Jobs open to the public',
  PSR:   'Post-Secondary Recruitment',
  RAP:   'Research Affiliate Program',
  RPL:   'Recruitment of Policy Leaders',
};


const STACKED_TOP_N = 7; // max categories in stacked chart before collapsing to "Other"

const PALETTE = [
  '#1d3557', '#457b9d', '#2a9d8f', '#e9c46a',
  '#f4a261', '#e63946', '#6a4c93', '#adb5bd',
];

/**
 * Returns the max fiscal year if it is a partial FYTD year, or null if complete.
 * PSC publishes one row per year stamped with the current publishing quarter.
 * Q4 = full year complete; anything else = FYTD partial.
 */
function detectPartialYear(rows: Record<string, unknown>[]): string | null {
  if (!rows.length) return null;

  const maxYear = rows.reduce((max, r) => {
    const y = String(r.fiscal_year ?? r.x ?? '');
    return y > max ? y : max;
  }, '');
  if (!maxYear) return null;

  // PSC publishes one row per year — Q4 means the year is complete, anything else is FYTD
  const maxYearQuarter = rows.find(r => (r.fiscal_year ?? r.x) === maxYear)?.quarter;
  return maxYearQuarter === 'Q4' ? null : maxYear;
}

/**
 * Splits a sorted single-line series into two dataKey columns:
 *   _solid   — full value for all years except the partial year (null there)
 *   _partial — full value only for the last complete year AND the partial year (null elsewhere)
 * This lets us render a solid line ending at the last full year and a dashed
 * bridge continuing to the partial year.
 */
function splitPartial<T extends Record<string, unknown>>(
  rows: T[],
  valueKey: string,
  partialYear: string | null,
): (T & { _solid: number | null; _partial: number | null })[] {
  const sorted = [...rows].sort((a, b) =>
    String(a.fiscal_year).localeCompare(String(b.fiscal_year)),
  );
  const partialIdx = partialYear
    ? sorted.findIndex(r => r.fiscal_year === partialYear)
    : -1;
  const prevFY = partialIdx > 0 ? String(sorted[partialIdx - 1].fiscal_year) : null;

  return sorted.map(r => {
    const fy = String(r.fiscal_year);
    const val = Number(r[valueKey] ?? 0);
    return {
      ...r,
      _solid: fy === partialYear ? null : val,
      _partial: fy === partialYear || fy === prevFY ? val : null,
    };
  });
}

// ── Pivot helper ──────────────────────────────────────────────────────────

function pivotToStacked(
  data: { x: string; category: string; y: number }[],
  xKey: string,
): { rows: Record<string, string | number>[]; categories: string[] } {
  // Find top N categories by total, collapse the rest into "Other"
  const totals: Record<string, number> = {};
  for (const r of data) totals[r.category] = (totals[r.category] ?? 0) + r.y;
  const topCats = Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, STACKED_TOP_N)
    .map(([cat]) => cat);
  const topSet = new Set(topCats);
  const hasOther = data.some(r => !topSet.has(r.category));

  const rowMap: Record<string, Record<string, number>> = {};
  for (const r of data) {
    if (!rowMap[r.x]) rowMap[r.x] = {};
    const cat = topSet.has(r.category) ? r.category : 'Other';
    rowMap[r.x][cat] = (rowMap[r.x][cat] ?? 0) + r.y;
  }

  const rows = Object.entries(rowMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([x, vals]) => ({ [xKey]: x, ...vals }));

  return { rows, categories: [...topCats, ...(hasOther ? ['Other'] : [])] };
}

// ── Types ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

// ── Styles ─────────────────────────────────────────────────────────────────

const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  alignItems: 'flex-start',
  marginBottom: 24,
  flexWrap: 'wrap',
};

const filterGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 200,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6c757d',
};

const inputStyle: React.CSSProperties = {
  padding: '5px 10px',
  border: '1px solid #ced4da',
  borderRadius: 4,
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 0,
  borderBottom: '2px solid #dee2e6',
  marginBottom: 24,
  overflowX: 'auto',
  WebkitOverflowScrolling: 'touch',
  scrollbarWidth: 'none',
};

const chartGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))',
  gap: 24,
};

const subTabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginBottom: 20,
  flexWrap: 'wrap',
};

// ── Tab components ─────────────────────────────────────────────────────────

interface TabProps {
  filters: { fiscal_year: string[]; department: string };
}


function applyLabels2d(
  data: { x: string; category: string; y: number }[],
  dimKey: string,
): { x: string; category: string; y: number }[] {
  if (dimKey !== 'recruitment_program_e') return data;
  return data.map(r => ({ ...r, category: PROGRAM_LABELS[r.category] ?? r.category }));
}

const ADV_METRICS = [
  { key: 'adv_count',    label: 'Advertisements', source: 'raw' },
  { key: 'applications', label: 'Applications',   source: 'dash' },
  { key: 'total_in_sup', label: 'Screened In',    source: 'raw' },
] as const;

const ADV_METRIC_DESCRIPTIONS: Record<string, string> = {
  adv_count:    'How many job postings were advertised each year. Use the dimension selector to see what types of jobs were posted, where they were located, or which hiring programs were used.',
  applications: 'How many people applied to advertised positions each year. Note: student program (FSWEP) application counts appear higher than expected for 2023–2024 onward — this is a known issue with the PSC source data and should correct itself when the data is next updated.',
  total_in_sup: 'How many applicants made it past the initial screening stage — meaning they met the basic requirements and were considered further. Totals may be slightly lower than actual because some small counts are withheld in the source data to protect privacy.',
};

function AdvertisementsTab({ filters }: TabProps) {
  const [metric, setMetric] = useState<typeof ADV_METRICS[number]['key']>(ADV_METRICS[0].key);
  const [breakdown, setBreakdown] = useState(false);
  const [pct, setPct] = useState(false);

  const isDash = ADV_METRICS.find(m => m.key === metric)?.source === 'dash';
  const availDims = isDash ? APP_DIMS : ADV_DIMS;
  const [dim, setDim] = useState<string>(ADV_DIMS[0].key);
  // Reset dim when switching sources if current dim isn't valid
  const activeDim = availDims.find(d => d.key === dim) ? dim : availDims[0].key;

  const dimLabel = availDims.find(d => d.key === activeDim)?.label ?? activeDim;
  const metricLabel = ADV_METRICS.find(m => m.key === metric)?.label ?? metric;
  // raw_advertisements has no org-size aggregate rows — department filter intentionally omitted
  const rawFilters = { fiscal_year: filters.fiscal_year };
  // dash_advertisements has org-size rows (Micro/Small/Medium/Large averages) — pass department
  const dashFilters = { fiscal_year: filters.fiscal_year, department: filters.department };

  // raw_advertisements source (adv_count, screened_in)
  const rawMetricKey = metric === 'applications' ? 'adv_count' : metric;
  const rawTrend2d = useAdvertisementAggregate('fiscal_year', rawMetricKey, rawFilters, activeDim);

  // dash_advertisements source (applications)
  const dashTrend2d = useStaffingAdvAggregate('fiscal_year', dashFilters, activeDim);

  const trend2d = isDash ? dashTrend2d : rawTrend2d;

  const raw2d = useMemo(
    () => applyLabels2d(
      (trend2d.data ?? []) as { x: string; category: string; y: number }[],
      activeDim,
    ),
    [trend2d.data, activeDim],
  );

  const { rows: multiRows, categories } = useMemo(
    () => raw2d.length ? pivotToStacked(raw2d, 'fiscal_year') : { rows: [], categories: [] },
    [raw2d],
  );

  const pctRows = useMemo(() =>
    multiRows.map(row => {
      const total = categories.reduce((s, c) => s + (Number(row[c]) || 0), 0);
      if (!total) return row;
      const out: Record<string, string | number> = { fiscal_year: row.fiscal_year };
      for (const c of categories) out[c] = Math.round((Number(row[c]) || 0) / total * 1000) / 10;
      return out;
    }),
    [multiRows, categories],
  );

  const singleRows = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const r of raw2d) agg[r.x] = (agg[r.x] ?? 0) + r.y;
    return Object.entries(agg).sort(([a], [b]) => a.localeCompare(b))
      .map(([fiscal_year, value]) => ({ fiscal_year, value }));
  }, [raw2d]);

  const partialYear = useMemo(
    () => detectPartialYear((trend2d.data ?? []) as Record<string, unknown>[]),
    [trend2d.data],
  );
  const formatFY = (v: string) => v === partialYear ? `${v} FYTD` : v;

  const splitRows = useMemo(() => splitPartial(singleRows, 'value', partialYear), [singleRows, partialYear]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: '#6c757d', marginBottom: 4 }}>Metric</div>
          <div style={subTabBarStyle}>
            {ADV_METRICS.map(m => (
              <button key={m.key} onClick={() => setMetric(m.key)}
                style={{
                  padding: '4px 12px', borderRadius: 4, border: '1px solid', fontSize: 12, cursor: 'pointer',
                  borderColor: metric === m.key ? '#2a9d8f' : '#ced4da',
                  background: metric === m.key ? '#2a9d8f' : '#fff',
                  color: metric === m.key ? '#fff' : '#495057',
                  fontWeight: metric === m.key ? 600 : 400,
                }}
              >{m.label}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#6c757d', marginBottom: 4 }}>Dimension</div>
          <div style={subTabBarStyle}>
            {availDims.map(d => (
              <button key={d.key} onClick={() => { setDim(d.key); setBreakdown(false); }}
                style={{
                  padding: '4px 12px', borderRadius: 4, border: '1px solid', fontSize: 12, cursor: 'pointer',
                  borderColor: activeDim === d.key ? '#1d3557' : '#ced4da',
                  background: activeDim === d.key ? '#1d3557' : '#fff',
                  color: activeDim === d.key ? '#fff' : '#495057',
                  fontWeight: activeDim === d.key ? 600 : 400,
                }}
              >{d.label}</button>
            ))}
          </div>
        </div>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', paddingBottom: 2 }}>
          <input type="checkbox" checked={breakdown} onChange={e => setBreakdown(e.target.checked)} />
          Show by {dimLabel}
        </label>
      </div>

      {ADV_METRIC_DESCRIPTIONS[metric] && (
        <p style={{ fontSize: 12, color: '#6c757d', margin: '0 0 16px', lineHeight: 1.5, maxWidth: 860 }}>
          {ADV_METRIC_DESCRIPTIONS[metric]}
        </p>
      )}
      {filters.department && !isDash && (
        <p style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '6px 10px', margin: '0 0 14px', maxWidth: 600 }}>
          Organization size filters apply to the <strong>Applications</strong> metric only — Advertisements and Screened In are sourced from raw postings which don't have org-size aggregates.
        </p>
      )}

      <div style={chartGridStyle}>
        <ChartCard
          title={breakdown ? `${metricLabel} over time by ${dimLabel}` : `${metricLabel} over time`}
          tableData={breakdown
            ? multiRows.map(r => ({ 'Year': String(r.fiscal_year), ...Object.fromEntries(categories.map(c => [c, r[c] ?? 0])) }))
            : singleRows.map(r => ({ 'Year': r.fiscal_year, [metricLabel]: r.value }))
          }
        >
          {trend2d.isLoading ? <LoadingSpinner /> : breakdown ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={multiRows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip labelFormatter={formatFY} />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
                {categories.map((cat, i) => (
                  <Line key={cat} type="monotone" dataKey={cat}
                    stroke={PALETTE[i % PALETTE.length]} strokeWidth={2}
                    dot={{ r: 3 }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={splitRows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const val = payload.find(p => p.value != null)?.value;
                    return (
                      <div style={{ background: '#fff', border: '1px solid #dee2e6', padding: '8px 12px', borderRadius: 4, fontSize: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{formatFY(String(label))}</div>
                        <div style={{ color: '#1d3557' }}>{metricLabel}: {Number(val).toLocaleString()}</div>
                      </div>
                    );
                  }}
                />
                <Line type="monotone" dataKey="_solid" name={metricLabel} stroke="#1d3557" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} legendType="none" />
                <Line type="monotone" dataKey="_partial" name={metricLabel} stroke="#1d3557" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} legendType="none" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        <ChartCard
          title={`${metricLabel} by ${dimLabel}`}
          tableData={multiRows.map(r => ({ 'Year': String(r.fiscal_year), ...Object.fromEntries(categories.map(c => [c, r[c] ?? 0])) }))}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              onClick={() => setPct(v => !v)}
              style={{
                padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                border: '1px solid', borderColor: pct ? '#1d3557' : '#ced4da',
                background: pct ? '#1d3557' : '#fff',
                color: pct ? '#fff' : '#495057',
              }}
            >
              100%
            </button>
          </div>
          {trend2d.isLoading ? <LoadingSpinner /> : (() => {
            const barRows = pct ? pctRows : multiRows;
            return (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barRows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                  <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={pct ? (v: number) => `${Math.round(v)}%` : undefined} domain={pct ? [0, 100] : undefined} />
                  <Tooltip formatter={pct ? (v: number) => `${v}%` : undefined} labelFormatter={formatFY} />
                  <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
                  {categories.map((cat, i) => (
                    <Bar key={cat} dataKey={cat} stackId="a" fill={PALETTE[i % PALETTE.length]}>
                      {barRows.map((row, idx) => (
                        <Cell key={idx} fill={PALETTE[i % PALETTE.length]} fillOpacity={row.fiscal_year === partialYear ? 0.45 : 1} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
        </ChartCard>
      </div>
    </div>
  );
}

// ── Shared trend+mix component used by Inflow, Outflow, Mobility, Demographics ──

type Measure = 'count' | 'fytd' | 'pct' | 'pct_fytd';

interface TrendMixProps {
  data: Row[];
  isLoading: boolean;
  catCol: string;
  catLabel: string;
  title: string;
  color: string;
  description?: string;
  hideMix?: boolean;
}

function TrendMixCharts({ data, isLoading, catCol, catLabel, title, color, description, hideMix }: TrendMixProps) {
  const [breakdown, setBreakdown] = useState(hideMix ?? false);
  const [show100, setShow100] = useState(false);
  const [measure, setMeasure] = useState<Measure>('count');

  const isFytd = measure === 'fytd' || measure === 'pct_fytd';
  const isPct  = measure === 'pct'  || measure === 'pct_fytd';

  // Detect publishing quarter from data for label (e.g. Q3)
  const qCount = useMemo(() => {
    if (!data.length) return null;
    const maxYear = data.reduce((max, r) => {
      const y = String(r.fiscal_year ?? '');
      return y > max ? y : max;
    }, '');
    const row = data.find(r => String(r.fiscal_year ?? '') === maxYear);
    const m = String(row?.quarter ?? '').match(/^Q(\d)$/);
    return m ? parseInt(m[1]) : null;
  }, [data]);

  const qLabel = qCount ? ` - Q${qCount}` : '';
  const MEASURES: { key: Measure; label: string }[] = [
    { key: 'count',    label: 'Count' },
    { key: 'fytd',     label: `Count, FYTD${qLabel}` },
    { key: 'pct',      label: '% Change' },
    { key: 'pct_fytd', label: `% Change, FYTD${qLabel}` },
  ];

  const partialYear = useMemo(() => detectPartialYear(data as Record<string, unknown>[]), [data]);
  const formatFY = (v: string) => v === partialYear ? `${v} FYTD` : v;

  // Use qtr_count when FYTD measure is selected
  const flat = useMemo(() =>
    data.map(r => ({
      x: String(r.fiscal_year ?? ''),
      category: String(r[catCol] ?? 'Unknown'),
      y: Number(isFytd ? (r.qtr_count ?? r.count ?? 0) : (r.count ?? 0)),
    })),
    [data, catCol, isFytd],
  );

  const { rows: multiRows, categories } = useMemo(
    () => flat.length ? pivotToStacked(flat, 'fiscal_year') : { rows: [], categories: [] },
    [flat],
  );

  const singleRows = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const r of flat) agg[r.x] = (agg[r.x] ?? 0) + r.y;
    return Object.entries(agg).sort(([a], [b]) => a.localeCompare(b))
      .map(([fiscal_year, count]) => ({ fiscal_year, count }));
  }, [flat]);

  // Apply YoY % change (drops the first year — no prior to compare against)
  const displaySingleRows = useMemo(() => {
    if (!isPct) return singleRows;
    return singleRows.slice(1).map((r, i) => {
      const prior = singleRows[i].count;
      return {
        fiscal_year: r.fiscal_year,
        count: prior ? Math.round((r.count - prior) / Math.abs(prior) * 1000) / 10 : 0,
      };
    });
  }, [singleRows, isPct]);

  const displayMultiRows = useMemo(() => {
    if (!isPct) return multiRows;
    return multiRows.slice(1).map((row, i) => {
      const prior = multiRows[i];
      const out: Record<string, string | number> = { fiscal_year: row.fiscal_year };
      for (const cat of categories) {
        const curr = Number(row[cat]) || 0;
        const prev = Number(prior[cat]) || 0;
        out[cat] = prev ? Math.round((curr - prev) / Math.abs(prev) * 1000) / 10 : 0;
      }
      return out;
    });
  }, [multiRows, categories, isPct]);

  const splitRows = useMemo(() => splitPartial(displaySingleRows, 'count', partialYear), [displaySingleRows, partialYear]);

  const stackedPctRows = useMemo(() =>
    displayMultiRows.map(row => {
      const total = categories.reduce((s, c) => s + (Number(row[c]) || 0), 0);
      if (!total) return row;
      const out: Record<string, string | number> = { fiscal_year: row.fiscal_year };
      for (const c of categories) out[c] = Math.round((Number(row[c]) || 0) / total * 1000) / 10;
      return out;
    }),
    [displayMultiRows, categories],
  );

  const barRows = show100 ? stackedPctRows : displayMultiRows;

  const yTickFmt = isPct ? (v: number) => `${v}%` : undefined;

  if (isLoading) return <LoadingSpinner />;
  if (!data.length) return <p style={{ color: '#6c757d' }}>No data. Try ingesting first.</p>;

  return (
    <div>
      {description && (
        <p style={{ fontSize: 12.5, color: '#6b7280', margin: '0 0 14px', lineHeight: 1.5, maxWidth: 800 }}>
          {description}
        </p>
      )}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 11, color: '#6c757d', marginBottom: 4 }}>Measure</div>
          <div style={subTabBarStyle}>
            {MEASURES.map(m => (
              <button key={m.key} onClick={() => setMeasure(m.key)}
                style={{
                  padding: '4px 12px', borderRadius: 4, border: '1px solid', fontSize: 12, cursor: 'pointer',
                  borderColor: measure === m.key ? '#2a9d8f' : '#ced4da',
                  background: measure === m.key ? '#2a9d8f' : '#fff',
                  color: measure === m.key ? '#fff' : '#495057',
                  fontWeight: measure === m.key ? 600 : 400,
                  flexShrink: 0,
                }}
              >{m.label}</button>
            ))}
          </div>
        </div>
        {!hideMix && (
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', paddingBottom: 2 }}>
            <input type="checkbox" checked={breakdown} onChange={e => setBreakdown(e.target.checked)} />
            Show by {catLabel}
          </label>
        )}
      </div>
      <div style={hideMix || isPct ? {} : chartGridStyle}>
        <ChartCard
          title={breakdown ? `${title} by ${catLabel}` : title}
          tableData={breakdown
            ? displayMultiRows.map(r => ({ 'Year': String(r.fiscal_year), ...Object.fromEntries(categories.map(c => [c, r[c] ?? 0])) }))
            : displaySingleRows.map(r => ({ 'Year': r.fiscal_year, [isPct ? '% Change' : 'Count']: r.count }))
          }
        >
          {breakdown ? (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={displayMultiRows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={yTickFmt} />
                {isPct && <ReferenceLine y={0} stroke="#adb5bd" strokeDasharray="3 3" />}
                <Tooltip formatter={isPct ? (v: number) => `${v}%` : undefined} />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
                {categories.map((cat, i) => (
                  <Line key={cat} type="monotone" dataKey={cat}
                    stroke={PALETTE[i % PALETTE.length]} strokeWidth={2}
                    dot={{ r: 3 }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={splitRows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={yTickFmt} />
                {isPct && <ReferenceLine y={0} stroke="#adb5bd" strokeDasharray="3 3" />}
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const val = payload.find(p => p.value != null)?.value;
                    return (
                      <div style={{ background: '#fff', border: '1px solid #dee2e6', padding: '8px 12px', borderRadius: 4, fontSize: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{formatFY(String(label))}</div>
                        <div style={{ color }}>{title}: {isPct ? `${Number(val)}%` : Number(val).toLocaleString()}</div>
                      </div>
                    );
                  }}
                />
                <Line type="monotone" dataKey="_solid" name={title} stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} legendType="none" />
                <Line type="monotone" dataKey="_partial" name={title} stroke={color} strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} legendType="none" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        {!hideMix && !isPct && (
          <ChartCard
            title={`Breakdown by ${catLabel}`}
            tableData={barRows.map(r => ({ 'Year': String(r.fiscal_year), ...Object.fromEntries(categories.map(c => [c, r[c] ?? 0])) }))}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button onClick={() => setShow100(v => !v)} style={{
                padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                border: '1px solid', borderColor: show100 ? '#1d3557' : '#ced4da',
                background: show100 ? '#1d3557' : '#fff', color: show100 ? '#fff' : '#495057',
              }}>100%</button>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barRows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={show100 ? (v: number) => `${Math.round(v)}%` : undefined} domain={show100 ? [0, 100] : undefined} />
                <Tooltip formatter={show100 ? (v: number) => `${v}%` : undefined} labelFormatter={formatFY} />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
                {categories.map((cat, i) => (
                  <Bar key={cat} dataKey={cat} stackId="a" fill={PALETTE[i % PALETTE.length]}>
                    {barRows.map((row, idx) => (
                      <Cell key={idx} fill={PALETTE[i % PALETTE.length]} fillOpacity={row.fiscal_year === partialYear ? 0.45 : 1} />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>
    </div>
  );
}

function InflowTab({ filters }: TabProps) {
  const { data = [], isLoading } = useStaffingInflow(filters);
  return (
    <TrendMixCharts
      data={data as Row[]} isLoading={isLoading}
      catCol="hire_e" catLabel="Hire Type"
      title="Inflow" color="#2a9d8f"
      description="Annual appointments by hire type — indeterminate, term, casual, and student. Tracks workforce renewal over time."
    />
  );
}

function OutflowTab({ filters }: TabProps) {
  const { data = [], isLoading } = useStaffingOutflow(filters);
  return (
    <TrendMixCharts
      data={data as Row[]} isLoading={isLoading}
      catCol="sep_reason_e" catLabel="Separation Reason"
      title="Outflow" color="#e63946"
      description="Annual separations by reason — retirement, resignation, end of term, and other. Compare with inflow to gauge whether the workforce is growing or shrinking."
    />
  );
}

function MobilityTab({ filters }: TabProps) {
  const { data = [], isLoading } = useStaffingMobility(filters);
  return (
    <TrendMixCharts
      data={data as Row[]} isLoading={isLoading}
      catCol="mob_type_e" catLabel="Mobility Type"
      title="Internal Mobility" color="#f4a261"
      description="Career movement within the public service — promotions, acting assignments, and lateral or downward moves. Separate from external hiring."
    />
  );
}

const DEMO_HIRE_TYPES = [
  { key: 'New Indeterminate',                    label: 'New Indeterminate' },
  { key: 'New Term',                             label: 'New Term' },
  { key: 'Casual',                               label: 'Casual' },
  { key: 'Term to Indeterminate',                label: 'Term to Indeterminate' },
  { key: 'Indeterminate from other organization', label: 'Indet. from other org' },
  { key: 'Term from other organization',          label: 'Term from other org' },
  { key: '',                                      label: 'All hire types' },
];

const DEMO_CHART_DIMS = [
  { key: 'age',    label: 'Age Group',       catCol: 'age_group_e', hideMix: false },
  { key: 'group',  label: 'Classification',  catCol: 'occ_group_e', hideMix: false },
  { key: 'region', label: 'Region',          catCol: 'region_e',    hideMix: false },
];


const ADV_STATS_CATS = [
  { key: 'ee',       label: 'Employment Equity',        catCol: 'ee_group_e', source: 'ee'  as const },
  { key: 'adv',      label: 'Advertised / Non-advertised', catCol: 'adv_e',   source: 'adv' as const },
  { key: 'fol',      label: 'First Official Language',  catCol: 'fol_e',      source: 'fol' as const },
  { key: 'priority', label: 'Priority Appointments',    catCol: '',           source: 'priority' as const },
];

function PriorityApptsChart({ data, isLoading }: { data: Row[]; isLoading: boolean }) {
  const partialYear = useMemo(() => detectPartialYear(data), [data]);
  const formatFY = (v: string) => v === partialYear ? `${v} FYTD` : v;

  const rows = useMemo(() =>
    [...data].sort((a, b) => String(a.fiscal_year).localeCompare(String(b.fiscal_year)))
      .map(r => ({
        fiscal_year: String(r.fiscal_year ?? ''),
        count: Number(r.count ?? 0),
        priority_count: Number(r.priority_count ?? 0),
      })),
    [data],
  );

  if (isLoading) return <LoadingSpinner />;
  if (!data.length) return <p style={{ color: '#6c757d' }}>No data.</p>;

  return (
    <div style={chartGridStyle}>
      <ChartCard
        title="Priority appointments over time"
        tableData={rows.map(r => ({ 'Year': r.fiscal_year, 'Total indeterminate': r.count, 'Priority appointments': r.priority_count }))}
      >
        <p style={{ fontSize: 12, color: '#6c757d', margin: '0 0 8px', lineHeight: 1.5 }}>
          Total indeterminate staffing actions each year (advertised + non-advertised), with priority appointments highlighted — showing how many were made under priority entitlements (e.g. surplus employees, persons with disabilities, veterans).
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={rows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip labelFormatter={formatFY} />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="count" name="Total indeterminate" stroke="#1d3557" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="priority_count" name="Priority appointments" stroke="#e63946" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard
        title="Priority appointments as % of total indeterminate"
        tableData={rows.map(r => ({ 'Year': r.fiscal_year, 'Priority %': r.count > 0 ? `${Math.round(r.priority_count / r.count * 1000) / 10}%` : '—' }))}
      >
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={rows.map(r => ({ ...r, pct: r.count > 0 ? Math.round(r.priority_count / r.count * 1000) / 10 : 0 }))}
            margin={{ top: 5, right: 20, left: 10, bottom: 50 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip labelFormatter={formatFY} formatter={(v: number) => `${v}%`} />
            <Line type="monotone" dataKey="pct" name="Priority %" stroke="#e63946" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function DemographicsTab({ filters }: TabProps) {
  const [section, setSection]     = useState<'tenure' | 'advanced'>('tenure');
  const [hire, setHire]           = useState(DEMO_HIRE_TYPES[0].key);
  const [chartDim, setChartDim]   = useState(DEMO_CHART_DIMS[0]);
  const [advCat, setAdvCat]       = useState(ADV_STATS_CATS[0]);

  const hireParam = hire || undefined;
  const { data = [], isLoading }                         = useStaffingDemo(chartDim.key, filters, hireParam);
  const { data: eeData = [],  isLoading: eeLoading }     = useStaffingDemo('ee', filters);
  const { data: advData = [], isLoading: advLoading }    = useStaffingAdvType(filters);
  const { data: folData = [], isLoading: folLoading }    = useStaffingDemo('fol', filters);
  const { data: reappData = [], isLoading: reappLoading } = useStaffingReappointments(filters);

  const hireLabel  = DEMO_HIRE_TYPES.find(h => h.key === hire)?.label ?? 'All hire types';
  const advStatsData    = advCat.source === 'ee' ? eeData : advCat.source === 'fol' ? folData : advData;
  const advStatsLoading = advCat.source === 'ee' ? eeLoading : advCat.source === 'fol' ? folLoading : advLoading;

  return (
    <div>
      <div style={{ ...subTabBarStyle, marginBottom: 20 }}>
        {([{ key: 'tenure', label: 'By Hire Type' }, { key: 'advanced', label: 'Advanced Statistics' }] as const).map(t => (
          <button key={t.key} onClick={() => setSection(t.key)} style={{
            padding: '5px 14px', borderRadius: 4, border: '1px solid', fontSize: 13, cursor: 'pointer',
            borderColor: section === t.key ? '#1d3557' : '#ced4da',
            background: section === t.key ? '#1d3557' : '#fff',
            color: section === t.key ? '#fff' : '#495057',
            fontWeight: section === t.key ? 600 : 400,
          }}>{t.label}</button>
        ))}
      </div>

      {section === 'tenure' ? (
        <>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6c757d', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Hire Type</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DEMO_HIRE_TYPES.map(h => (
                <button key={h.key} onClick={() => setHire(h.key)} style={{
                  padding: '3px 10px', borderRadius: 4, border: '1px solid', fontSize: 12, cursor: 'pointer',
                  borderColor: hire === h.key ? '#1d3557' : '#ced4da',
                  background: hire === h.key ? '#1d3557' : '#fff',
                  color: hire === h.key ? '#fff' : '#495057',
                }}>{h.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6c757d', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Breakdown</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {DEMO_CHART_DIMS.map(d => (
                <button key={d.key} onClick={() => setChartDim(d)} style={{
                  padding: '3px 10px', borderRadius: 4, border: '1px solid', fontSize: 12, cursor: 'pointer',
                  borderColor: chartDim.key === d.key ? '#457b9d' : '#ced4da',
                  background: chartDim.key === d.key ? '#457b9d' : '#fff',
                  color: chartDim.key === d.key ? '#fff' : '#495057',
                }}>{d.label}</button>
              ))}
            </div>
          </div>
          <TrendMixCharts
            data={data as Row[]} isLoading={isLoading}
            catCol={chartDim.catCol} catLabel={chartDim.label}
            title={`${hireLabel} — by ${chartDim.label}`} color="#6a4c93"
            hideMix={chartDim.hideMix}
          />
        </>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6c757d', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Category</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ADV_STATS_CATS.map(c => (
                <button key={c.key} onClick={() => setAdvCat(c)} style={{
                  padding: '3px 10px', borderRadius: 4, border: '1px solid', fontSize: 12, cursor: 'pointer',
                  borderColor: advCat.key === c.key ? '#1d3557' : '#ced4da',
                  background: advCat.key === c.key ? '#1d3557' : '#fff',
                  color: advCat.key === c.key ? '#fff' : '#495057',
                }}>{c.label}</button>
              ))}
            </div>
            {advCat.source === 'ee' && (
              <p style={{ fontSize: 11.5, color: '#6b7280', margin: '8px 0 0', lineHeight: 1.5 }}>
                EE data is released annually with a ~1 year delay — the most recent fiscal year shown may lag behind other metrics.
              </p>
            )}
          </div>
          {advCat.source === 'priority' ? (
            <PriorityApptsChart data={reappData as Row[]} isLoading={reappLoading} />
          ) : (
            <TrendMixCharts
              data={advStatsData as Row[]} isLoading={advStatsLoading}
              catCol={advCat.catCol} catLabel={advCat.label}
              title={advCat.label} color="#6a4c93"
            />
          )}
        </>
      )}
    </div>
  );
}

const VHA_SUB_TABS = [
  { key: 'reappointments', label: 'Reappointments' },
  { key: 'priority',       label: 'Priority (current)' },
  { key: 'vha1',           label: 'VHA — Applications' },
  { key: 'vha2',           label: 'VHA — Registrations' },
  { key: 'vha3',           label: 'VHA — Eligibility' },
] as const;

type VhaSubKey = typeof VHA_SUB_TABS[number]['key'];

function PriorityVeteransTab({ filters }: TabProps) {
  const [sub, setSub] = useState<VhaSubKey>('reappointments');

  const reapp    = useStaffingReappointments(filters);
  const priority = useStaffingPriority();
  const vha1     = useStaffingVha(1, { fiscal_year: filters.fiscal_year });
  const vha2     = useStaffingVha(2, { fiscal_year: filters.fiscal_year });
  const vha3     = useStaffingVha(3, { fiscal_year: filters.fiscal_year });

  return (
    <div>
      <div style={{ ...subTabBarStyle, marginBottom: 20 }}>
        {VHA_SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setSub(t.key)} style={{
            padding: '5px 14px', borderRadius: 4, border: '1px solid', fontSize: 13, cursor: 'pointer',
            borderColor: sub === t.key ? '#1d3557' : '#ced4da',
            background: sub === t.key ? '#1d3557' : '#fff',
            color: sub === t.key ? '#fff' : '#495057',
            fontWeight: sub === t.key ? 600 : 400,
          }}>{t.label}</button>
        ))}
      </div>

      {sub === 'reappointments' && (
        <ReappointmentsCharts data={(reapp.data ?? []) as Row[]} isLoading={reapp.isLoading} />
      )}

      {sub === 'priority' && (
        <PrioritySnapshot data={(priority.data ?? []) as Row[]} isLoading={priority.isLoading} />
      )}

      {sub === 'vha1' && (
        <Vha1Charts data={(vha1.data ?? []) as Row[]} isLoading={vha1.isLoading} />
      )}

      {sub === 'vha2' && (
        <Vha2Charts data={(vha2.data ?? []) as Row[]} isLoading={vha2.isLoading} />
      )}

      {sub === 'vha3' && (
        <Vha3Charts data={(vha3.data ?? []) as Row[]} isLoading={vha3.isLoading} />
      )}
    </div>
  );
}

function ReappointmentsCharts({ data, isLoading }: { data: Row[]; isLoading: boolean }) {
  const partialYear = useMemo(() => detectPartialYear(data), [data]);
  const formatFY = (v: string) => v === partialYear ? `${v} FYTD` : v;

  const rows = useMemo(() =>
    [...data].sort((a, b) => String(a.fiscal_year).localeCompare(String(b.fiscal_year)))
      .map(r => ({
        fiscal_year: String(r.fiscal_year ?? ''),
        count: Number(r.count ?? 0),
        priority_count: Number(r.priority_count ?? 0),
      })),
    [data],
  );

  if (isLoading) return <LoadingSpinner />;
  if (!data.length) return <p style={{ color: '#6c757d' }}>No data. Try ingesting first.</p>;

  return (
    <div style={chartGridStyle}>
      <ChartCard
        title="Indeterminate appointments & priority appointments"
        tableData={rows.map(r => ({ 'Year': r.fiscal_year, 'Total indeterminate': r.count, 'Priority appointments': r.priority_count }))}
      >
        <p style={{ fontSize: 12, color: '#6c757d', margin: '0 0 8px', lineHeight: 1.5 }}>
          Total indeterminate staffing actions each year (advertised + non-advertised), with priority appointments highlighted — showing how many were made under priority entitlements (e.g. surplus employees, persons with disabilities, veterans).
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={rows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip labelFormatter={formatFY} />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="count" name="Total indeterminate" stroke="#1d3557" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="priority_count" name="Priority appointments" stroke="#e63946" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Priority appointments as % of total indeterminate">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={rows.map(r => ({ ...r, pct: r.count > 0 ? Math.round(r.priority_count / r.count * 1000) / 10 : 0 }))}
            margin={{ top: 5, right: 20, left: 10, bottom: 50 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip labelFormatter={formatFY} formatter={(v: number) => `${v}%`} />
            <Line type="monotone" dataKey="pct" name="Priority %" stroke="#e63946" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function PrioritySnapshot({ data, isLoading }: { data: Row[]; isLoading: boolean }) {
  const byProvince = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const r of data) {
      const prov = String(r.province_e ?? 'Unknown');
      agg[prov] = (agg[prov] ?? 0) + Number(r.count ?? 0);
    }
    return Object.entries(agg).sort(([, a], [, b]) => b - a).map(([province_e, count]) => ({ province_e, count }));
  }, [data]);

  const byClass = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const r of data) {
      const cls = String(r.class_e ?? 'Unknown');
      agg[cls] = (agg[cls] ?? 0) + Number(r.count ?? 0);
    }
    return Object.entries(agg).sort(([, a], [, b]) => b - a).slice(0, 15).map(([class_e, count]) => ({ class_e, count }));
  }, [data]);

  const total = useMemo(() => data.reduce((s, r) => s + Number(r.count ?? 0), 0), [data]);
  const date = data[0] ? String(data[0].processing_date ?? '') : '';

  if (isLoading) return <LoadingSpinner />;
  if (!data.length) return <p style={{ color: '#6c757d' }}>No data. Try ingesting first.</p>;

  return (
    <div>
      <p style={{ fontSize: 12, color: '#6c757d', marginBottom: 16, lineHeight: 1.5 }}>
        A snapshot of the <strong>{total.toLocaleString()}</strong> people currently on the priority list as of {date}. Priority persons have a legal right to be considered for positions ahead of the general applicant pool — this includes employees who were laid off, injured on the job, or returned from leave. The charts show where these individuals are located and what types of jobs they held.
      </p>
      <div style={chartGridStyle}>
        <ChartCard title="Priority persons by province"
          tableData={byProvince.map(r => ({ 'Province': r.province_e, 'Count': r.count }))}
        >
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={byProvince} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="province_e" tick={{ fontSize: 11 }} width={80} />
              <Tooltip />
              <Bar dataKey="count" name="Priority Persons" fill="#1d3557" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Top 15 classifications"
          tableData={byClass.map(r => ({ 'Classification': r.class_e, 'Count': r.count }))}
        >
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={byClass} layout="vertical" margin={{ top: 5, right: 30, left: 50, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="class_e" tick={{ fontSize: 11 }} width={50} />
              <Tooltip />
              <Bar dataKey="count" name="Priority Persons" fill="#457b9d" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function Vha1Charts({ data, isLoading }: { data: Row[]; isLoading: boolean }) {
  const partialYear = useMemo(() => detectPartialYear(data), [data]);
  const formatFY = (v: string) => v === partialYear ? `${v} FYTD` : v;

  const flat = useMemo(() =>
    data.map(r => ({
      x: String(r.fiscal_year ?? ''),
      category: String(r.application_type_e ?? 'Unknown'),
      y: Number(r.applications_count ?? 0),
    })),
    [data],
  );

  const { rows: multiRows, categories } = useMemo(
    () => flat.length ? pivotToStacked(flat, 'fiscal_year') : { rows: [], categories: [] },
    [flat],
  );

  if (isLoading) return <LoadingSpinner />;
  if (!data.length) return <p style={{ color: '#6c757d' }}>No data. Try ingesting first.</p>;

  return (
    <div style={chartGridStyle}>
      <ChartCard title="VHA — CAF applications to advertisements"
        tableData={multiRows.map(r => ({ 'Year': String(r.fiscal_year), ...Object.fromEntries(categories.map(c => [c, r[c] ?? 0])) }))}
      >
        <p style={{ fontSize: 12, color: '#6c757d', margin: '0 0 8px', lineHeight: 1.5 }}>
          How many Canadian Armed Forces (CAF) members and veterans applied to public service job postings each year, under the Veterans Hiring Act. Shows whether they applied to positions open only to current employees (internal) or to the general public (external).
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={multiRows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip labelFormatter={formatFY} />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
            {categories.map((cat, i) => (
              <Line key={cat} type="monotone" dataKey={cat} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="VHA — Applications by type (stacked)"
        tableData={multiRows.map(r => ({ 'Year': String(r.fiscal_year), ...Object.fromEntries(categories.map(c => [c, r[c] ?? 0])) }))}
      >
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={multiRows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip labelFormatter={formatFY} />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
            {categories.map((cat, i) => (
              <Bar key={cat} dataKey={cat} stackId="a" fill={PALETTE[i % PALETTE.length]}>
                {multiRows.map((row, idx) => (
                  <Cell key={idx} fill={PALETTE[i % PALETTE.length]} fillOpacity={row.fiscal_year === partialYear ? 0.45 : 1} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function Vha2Charts({ data, isLoading }: { data: Row[]; isLoading: boolean }) {
  const partialYear = useMemo(() => detectPartialYear(data), [data]);
  const formatFY = (v: string) => v === partialYear ? `${v} FYTD` : v;

  // Pivot: fiscal_year × type_e × reg_app_e (registrations / appointments)
  const registrations = useMemo(() => {
    const flat = data
      .filter(r => String(r.reg_app_e ?? '').toLowerCase().includes('registration'))
      .map(r => ({ x: String(r.fiscal_year ?? ''), category: String(r.type_e ?? 'Unknown'), y: Number(r.count ?? 0) }));
    return flat.length ? pivotToStacked(flat, 'fiscal_year') : { rows: [], categories: [] };
  }, [data]);

  const appointments = useMemo(() => {
    const flat = data
      .filter(r => String(r.reg_app_e ?? '').toLowerCase().includes('appointment'))
      .map(r => ({ x: String(r.fiscal_year ?? ''), category: String(r.type_e ?? 'Unknown'), y: Number(r.count ?? 0) }));
    return flat.length ? pivotToStacked(flat, 'fiscal_year') : { rows: [], categories: [] };
  }, [data]);

  if (isLoading) return <LoadingSpinner />;
  if (!data.length) return <p style={{ color: '#6c757d' }}>No data. Try ingesting first.</p>;

  return (
    <div>
      <p style={{ fontSize: 12, color: '#6c757d', margin: '0 0 16px', lineHeight: 1.5 }}>
        Under the Veterans Hiring Act, CAF members and veterans can register as priority candidates for public service jobs. This shows how many registered each year (by priority type) and how many were ultimately appointed — giving a sense of how well the priority system is converting eligible veterans into public service hires.
      </p>
    <div style={chartGridStyle}>
      <ChartCard title="VHA — Registrations by priority type"
        tableData={registrations.rows.map(r => ({ 'Year': String(r.fiscal_year), ...Object.fromEntries(registrations.categories.map(c => [c, r[c] ?? 0])) }))}
      >
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={registrations.rows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip labelFormatter={formatFY} />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
            {registrations.categories.map((cat, i) => (
              <Bar key={cat} dataKey={cat} stackId="a" fill={PALETTE[i % PALETTE.length]}>
                {registrations.rows.map((row, idx) => (
                  <Cell key={idx} fill={PALETTE[i % PALETTE.length]} fillOpacity={row.fiscal_year === partialYear ? 0.45 : 1} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="VHA — Appointments by priority type"
        tableData={appointments.rows.map(r => ({ 'Year': String(r.fiscal_year), ...Object.fromEntries(appointments.categories.map(c => [c, r[c] ?? 0])) }))}
      >
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={appointments.rows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip labelFormatter={formatFY} />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
            {appointments.categories.map((cat, i) => (
              <Bar key={cat} dataKey={cat} stackId="a" fill={PALETTE[i % PALETTE.length]}>
                {appointments.rows.map((row, idx) => (
                  <Cell key={idx} fill={PALETTE[i % PALETTE.length]} fillOpacity={row.fiscal_year === partialYear ? 0.45 : 1} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
    </div>
  );
}

function Vha3Charts({ data, isLoading }: { data: Row[]; isLoading: boolean }) {
  const partialYear = useMemo(() => detectPartialYear(data), [data]);
  const formatFY = (v: string) => v === partialYear ? `${v} FYTD` : v;

  const flat = useMemo(() =>
    data.map(r => ({ x: String(r.fiscal_year ?? ''), category: String(r.eligibility_reason_e ?? 'Unknown'), y: Number(r.count ?? 0) })),
    [data],
  );
  const { rows: multiRows, categories } = useMemo(
    () => flat.length ? pivotToStacked(flat, 'fiscal_year') : { rows: [], categories: [] },
    [flat],
  );

  if (isLoading) return <LoadingSpinner />;
  if (!data.length) return <p style={{ color: '#6c757d' }}>No data. Try ingesting first.</p>;

  return (
    <div style={chartGridStyle}>
      <ChartCard title="VHA — Eligible CAF members by reason"
        tableData={multiRows.map(r => ({ 'Year': String(r.fiscal_year), ...Object.fromEntries(categories.map(c => [c, r[c] ?? 0])) }))}
      >
        <p style={{ fontSize: 12, color: '#6c757d', margin: '0 0 8px', lineHeight: 1.5 }}>
          How many Canadian Armed Forces members were eligible for veterans hiring preference each year, broken down by the reason they qualify. This gives a sense of the size of the eligible veteran population the Veterans Hiring Act is designed to support.
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={multiRows} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
            <XAxis dataKey="fiscal_year" tickFormatter={formatFY} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip labelFormatter={formatFY} />
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
            {categories.map((cat, i) => (
              <Line key={cat} type="monotone" dataKey={cat} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

// ── KPI summary cards ──────────────────────────────────────────────────────

type SummaryRow = { fiscal_year: string; total: number; qtr_total?: number };

const Q_LABEL: Record<number, string> = { 1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4' };

function KpiCard({ label, rows, accent, qCount }: { label: string; rows: SummaryRow[]; accent: string; qCount: number }) {
  const cur      = rows[0];
  const prev     = rows[1];
  const prevPrev = rows[2];
  if (!cur) return null;

  // FYTD comparison: use actual prior-year FYTD (qtr_total) when available
  const prevFytd = prev ? (prev.qtr_total ?? (prev.total / 4) * qCount) : null;
  const isEstimated = prev ? prev.qtr_total == null : false;
  const pct = prevFytd && prevFytd > 0
    ? ((cur.total - prevFytd) / prevFytd * 100)
    : null;
  const up   = pct !== null && pct > 0;
  const down = pct !== null && pct < 0;
  const qLabel = Q_LABEL[qCount] ?? `Q${qCount}`;

  const fullPct = prev && prevPrev && prevPrev.total > 0
    ? ((prev.total - prevPrev.total) / prevPrev.total * 100)
    : null;
  const fullUp   = fullPct !== null && fullPct > 0;
  const fullDown = fullPct !== null && fullPct < 0;

  return (
    <div style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* FYTD card — lighter */}
      <div style={{
        borderLeft: `3px solid ${accent}`,
        borderRadius: 4,
        padding: '8px 12px',
        background: '#fff',
        border: '1px solid #e9ecef',
        borderLeftWidth: 3,
        borderLeftColor: accent,
      }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#6c757d', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1d3557', lineHeight: 1, marginBottom: 2 }}>
          {Math.round(cur.total).toLocaleString()}
        </div>
        <div style={{ fontSize: 10, color: '#6c757d', marginBottom: 3 }}>
          {cur.fiscal_year} FYTD {qLabel}
        </div>
        {pct !== null && prevFytd !== null && (
          <div style={{ fontSize: 11, fontWeight: 500, color: up ? '#2a9d8f' : down ? '#e63946' : '#6c757d' }}>
            {up ? '▲' : down ? '▼' : '—'} {Math.abs(Math.round(pct))}%
            <span style={{ fontWeight: 400, color: '#adb5bd', marginLeft: 3 }}>
              vs {isEstimated ? '~' : ''}{Math.round(prevFytd).toLocaleString()}{isEstimated ? ' est.' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Full-year sub-card — slightly shaded */}
      {prev && prevPrev && (
        <div style={{
          border: '1px solid #e9ecef',
          borderLeftWidth: 3,
          borderLeftColor: accent,
          borderRadius: 4,
          padding: '5px 12px',
          background: '#eef0f3',
        }}>
          <div style={{ fontSize: 10, marginBottom: 4 }}>
            <span style={{ color: '#495057', fontWeight: 500 }}>{prev.fiscal_year}</span>
            <span style={{ color: '#adb5bd' }}> vs {prevPrev.fiscal_year}</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#495057', lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            {Math.round(prev.total).toLocaleString()}
            {fullPct !== null && (
              <span style={{ fontSize: 11, fontWeight: 600, color: fullUp ? '#2a9d8f' : fullDown ? '#e63946' : '#6c757d' }}>
                {fullUp ? '▲' : fullDown ? '▼' : '—'}{Math.abs(Math.round(fullPct))}%
              </span>
            )}
            <span style={{ fontSize: 10, fontWeight: 400, color: '#adb5bd' }}>
              vs {Math.round(prevPrev.total).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCards({ summary }: { summary: StaffingSummary }) {
  const { q_count: qCount } = summary;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, color: '#6c757d', marginBottom: 8 }}>
        Key metrics — FYTD {Q_LABEL[qCount] ?? `Q${qCount}`}.{' '}
        <span style={{ color: '#adb5bd' }}>
          % change vs same period last year.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <KpiCard label="Advertisements"     rows={summary.advertisements}   accent="#1d3557" qCount={qCount} />
        <KpiCard label="Applications"       rows={summary.applications}     accent="#457b9d" qCount={qCount} />
        <KpiCard label="New Indeterminate"  rows={summary.new_indeterminate} accent="#2a9d8f" qCount={qCount} />
        <KpiCard label="Separations"        rows={summary.separations}       accent="#e63946" qCount={qCount} />
        <KpiCard label="Promotions"         rows={summary.promotions}        accent="#f4a261" qCount={qCount} />
        <KpiCard label="Lateral / Downward" rows={summary.lateral}           accent="#e9c46a" qCount={qCount} />
        <KpiCard label="Acting"             rows={summary.acting}            accent="#6a4c93" qCount={qCount} />
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function StaffingDashboard() {
  const [fiscalYears, setFiscalYears] = useState<string[]>(() => FISCAL_YEARS.slice(-10));
  const [searchParams, setSearchParams] = useSearchParams();
  const department = searchParams.get('dept') ?? '';
  const activeTab = (searchParams.get('tab') as TabKey | null) ?? 'advertisements';
  const setDepartment = (dept: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (dept) next.set('dept', dept);
      else next.delete('dept');
      return next;
    }, { replace: false });
  };
  const setActiveTab = (tab: TabKey) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: false });
  };

  const filters = useMemo(
    () => ({ fiscal_year: fiscalYears, department }),
    [fiscalYears, department],
  );

  const { data: summary } = useStaffingSummary();

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
        Staffing Dashboard{department ? <span style={{ color: '#6b7280', fontWeight: 400 }}> — {department}</span> : ''}
      </h2>
      <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 13 }}>
        Workforce activity across the federal public service
      </p>

      {/* KPI summary cards */}
      {summary && <SummaryCards summary={summary} />}

      {/* Filters */}
      <div style={filterBarStyle}>
        <div style={{ ...filterGroupStyle, maxWidth: 280 }}>
          <span style={labelStyle}>Fiscal Year</span>
          <MultiSelectCombobox
            value={fiscalYears}
            onChange={setFiscalYears}
            options={FISCAL_YEARS}
            placeholder="All years…"
          />
        </div>
        <div style={{ ...filterGroupStyle, minWidth: 260 }}>
          <span style={labelStyle}>Department</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {([
              { label: 'PS Total', value: '' },
              { label: 'Micro avg', value: 'Micro - Average' },
              { label: 'Small avg', value: 'Small - Average' },
              { label: 'Medium avg', value: 'Medium - Average' },
              { label: 'Large avg', value: 'Large - Average' },
            ] as { label: string; value: string }[]).map(opt => (
              <button
                key={opt.label}
                onClick={() => setDepartment(opt.value)}
                style={{
                  padding: '3px 9px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                  border: '1px solid',
                  borderColor: department === opt.value ? '#1d3557' : '#ced4da',
                  background: department === opt.value ? '#1d3557' : '#fff',
                  color: department === opt.value ? '#fff' : '#495057',
                  fontWeight: department === opt.value ? 600 : 400,
                  flexShrink: 0,
                }}
              >{opt.label}</button>
            ))}
          </div>
          <DeptAutocomplete value={department} onChange={setDepartment} />
        </div>
      </div>

      {/* Tab bar */}
      <div style={tabBarStyle}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #1d3557' : '2px solid transparent',
              background: 'none',
              color: activeTab === tab.key ? '#1d3557' : '#6c757d',
              fontWeight: activeTab === tab.key ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
              marginBottom: -2,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'advertisements' && <AdvertisementsTab      filters={filters} />}
      {activeTab === 'inflow'         && <InflowTab              filters={filters} />}
      {activeTab === 'outflow'        && <OutflowTab             filters={filters} />}
      {activeTab === 'mobility'       && <MobilityTab            filters={filters} />}
      {activeTab === 'demographics'   && <DemographicsTab        filters={filters} />}
      {activeTab === 'priority'       && <PriorityVeteransTab    filters={filters} />}
    </div>
  );
}
