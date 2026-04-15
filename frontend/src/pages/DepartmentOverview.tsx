import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import client from '../api/client';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';
import ChartCard from '../components/charts/ChartCard';

// ── Types ──────────────────────────────────────────────────────────────────────

interface KpiSeries { fiscal_year: string; total: number | null; qtr_total?: number | null }
interface KpiGroup  { dept: KpiSeries[]; ps: KpiSeries[] }

interface TrendRow    { fiscal_year: string; total: number | null }
interface TypeRow     { fiscal_year: string; hire_e: string; count: number | null }
interface ReasonRow   { fiscal_year: string; sep_reason_e: string; count: number | null }
interface AdvTypeRow  { fiscal_year: string; adv_e: string; count: number | null }
interface MobilityRow { fiscal_year: string; mob_type_e: string; count: number | null }
interface AgeRow      { age_group_e: string; count: number | null }
interface PopHeadcount { year: number; count: number | null }
interface PopTenure    { year: number; tenure_e: string; count: number | null }
interface PopData {
  department: string | null;
  matched_dept: string | null;
  headcount: PopHeadcount[];
  tenure: PopTenure[];
}

interface RankEntry { rnk: number; total_depts: number }

interface OverviewData {
  department: string;
  is_ps_total: boolean;
  q_count: number;
  kpis: {
    new_indeterminate: KpiGroup;
    separations:       KpiGroup;
    promotions:        KpiGroup;
    acting:            KpiGroup;
    lateral:           KpiGroup;
    applications:      KpiGroup;
  };
  ranks: {
    new_indeterminate: RankEntry | null;
    separations:       RankEntry | null;
    promotions:        RankEntry | null;
    acting:            RankEntry | null;
    lateral:           RankEntry | null;
  };
  tbs_headcount: { year: number; count: number } | null;
  workforce_trend: { inflow: TrendRow[]; outflow: TrendRow[] };
  inflow_by_type:    TypeRow[];
  mobility_trend:    MobilityRow[];
  applications_trend: TrendRow[];
  outflow_by_reason:  ReasonRow[];
  adv_by_type:        AdvTypeRow[];
  ee_snapshot: {
    dept: { ee_group_e: string; count: number | null }[];
    ps:   { ee_group_e: string; count: number | null }[];
  };
  age_snapshot: {
    dept: AgeRow[];
    ps:   AgeRow[];
  };
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HIRE_COLORS = [
  '#1d3557', '#457b9d', '#a8dadc', '#f4a261',
  '#2a9d8f', '#e9c46a', '#e76f51', '#264653',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function latestVal(arr: KpiSeries[]): number | null {
  return arr?.[0]?.total ?? null;
}

// Compare current FYTD against same period last year.
// Uses qtr_total (actual FYTD) when available; falls back to estimating from full year.
function yoyChange(arr: KpiSeries[], qCount: number): number | null {
  const current  = arr?.[0]?.total;
  const priorRow = arr?.[1];
  if (current == null || priorRow == null) return null;
  const priorFytd = priorRow.qtr_total != null
    ? priorRow.qtr_total
    : (priorRow.total != null ? priorRow.total * (qCount / 4) : null);
  if (priorFytd == null || priorFytd === 0) return null;
  return ((current - priorFytd) / priorFytd) * 100;
}

// ── Section divider ───────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
      <span style={{
        fontSize: 10.5, fontWeight: 700, color: '#9ca3af',
        textTransform: 'uppercase', letterSpacing: '0.1em', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
    </div>
  );
}

// ── Stacked bar chart (shared helper) ─────────────────────────────────────────

const CHART_H = 230;
const CHART_MARGIN = { top: 4, right: 20, left: 10, bottom: 42 };

function StackedBarChart({ data, keys }: { data: Record<string, unknown>[]; keys: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
        <XAxis dataKey="fiscal_year" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
        <YAxis tick={{ fontSize: 11 }} width={42} />
        <Tooltip />
        <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 10.5, paddingTop: 4 }} />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} name={k} stackId="a" fill={HIRE_COLORS[i % HIRE_COLORS.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  kpi: KpiGroup;
  isPsTotal: boolean;
  qCount?: number;
  rank?: RankEntry | null;
  headcount?: number | null;
}

function KpiCard({ label, kpi, isPsTotal, qCount = 4, rank, headcount }: KpiCardProps) {
  const val    = latestVal(kpi.dept);
  const change = yoyChange(kpi.dept, qCount);
  const fy     = kpi.dept[0]?.fiscal_year;
  const up     = change !== null && change >= 0;

  const rate1k = val != null && headcount != null && headcount > 0
    ? (val / headcount) * 1000
    : null;

  // Rank colour: top third green, bottom third red, middle grey
  const rankColour = (rank && rank.total_depts > 0)
    ? rank.rnk <= Math.ceil(rank.total_depts / 3) ? '#15803d'
      : rank.rnk > Math.floor((rank.total_depts * 2) / 3) ? '#dc2626'
      : '#6b7280'
    : '#6b7280';

  return (
    <div style={{
      flex: 1, minWidth: 160,
      background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10,
      padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 8 }}>
        {val != null ? val.toLocaleString() : '—'}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
        {change !== null && (
          <span style={{ fontSize: 12, fontWeight: 600, color: up ? '#16a34a' : '#dc2626' }}>
            {up ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
          </span>
        )}
        {val == null && (
          <span style={{ fontSize: 12, color: '#d1d5db' }}>No data</span>
        )}
      </div>
      {rate1k !== null && (
        <div style={{ fontSize: 11.5, color: '#374151', marginBottom: 3 }}>
          <span style={{ fontWeight: 600 }}>{rate1k.toFixed(1)}</span>
          <span style={{ color: '#9ca3af' }}> / 1,000 emp.</span>
        </div>
      )}
      {!isPsTotal && rank && (
        <div style={{ fontSize: 11, color: rankColour, fontWeight: 600, marginBottom: 3 }}>
          #{rank.rnk} of {rank.total_depts} depts
        </div>
      )}
      {fy && (
        <div style={{ fontSize: 11, color: '#c3c8ce' }}>
          {fy} FYTD{qCount < 4 ? ' · vs same period last year' : ''}
        </div>
      )}
    </div>
  );
}

// ── Net Flow Card ─────────────────────────────────────────────────────────────

function NetFlowCard({ inflow, outflow }: { inflow: TrendRow[]; outflow: TrendRow[] }) {
  const latestFy = inflow.at(-1)?.fiscal_year ?? outflow.at(-1)?.fiscal_year;
  const inflowLatest  = inflow.find(r => r.fiscal_year === latestFy)?.total ?? null;
  const outflowLatest = outflow.find(r => r.fiscal_year === latestFy)?.total ?? null;
  const net = inflowLatest != null && outflowLatest != null ? inflowLatest - outflowLatest : null;
  const positive = net !== null && net >= 0;

  return (
    <div style={{
      flex: 1, minWidth: 160,
      background: net === null ? '#fff' : positive ? '#f0fdf4' : '#fff5f5',
      border: `1.5px solid ${net === null ? '#e5e7eb' : positive ? '#bbf7d0' : '#fecaca'}`,
      borderRadius: 10,
      padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        Net Flow
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: net === null ? '#111827' : positive ? '#15803d' : '#dc2626', lineHeight: 1, marginBottom: 8 }}>
        {net != null ? `${positive ? '+' : ''}${net.toLocaleString()}` : '—'}
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
        {inflowLatest != null ? `In: ${inflowLatest.toLocaleString()}` : 'In: —'}
        &nbsp;·&nbsp;
        {outflowLatest != null ? `Out: ${outflowLatest.toLocaleString()}` : 'Out: —'}
      </div>
      {latestFy && <div style={{ fontSize: 11, color: '#c3c8ce' }}>{latestFy} FYTD</div>}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function DepartmentOverview() {
  const [deptInput,    setDeptInput]    = useState('');
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  // ── Department list ───────────────────────────────────────────────────────
  const { data: departments = [] } = useQuery<string[]>({
    queryKey: ['staffing-departments'],
    queryFn: () => client.get('/staffing/departments').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const allOptions = useMemo(
    () => ['Public Service (Total)', ...departments],
    [departments],
  );

  const filtered = deptInput.trim()
    ? allOptions.filter(o => o.toLowerCase().includes(deptInput.toLowerCase()))
    : allOptions;

  // ── Overview data ─────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ['dept-overview', selectedDept],
    queryFn: () =>
      client
        .get('/staffing/department-overview', {
          params: selectedDept ? { department: selectedDept } : {},
        })
        .then(r => r.data),
    staleTime: 60_000,
  });

  // ── TBS population data ───────────────────────────────────────────────────
  const { data: popData } = useQuery<PopData>({
    queryKey: ['dept-population', selectedDept],
    queryFn: () =>
      client
        .get('/staffing/population', {
          params: selectedDept ? { department: selectedDept } : {},
        })
        .then(r => r.data),
    staleTime: 60_000,
  });

  // ── Dropdown close on outside click ──────────────────────────────────────
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        !inputRef.current?.contains(e.target as Node) &&
        !listRef.current?.contains(e.target as Node)
      ) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function selectDept(opt: string) {
    const isTotal = opt === 'Public Service (Total)';
    setDeptInput(isTotal ? '' : opt);
    setSelectedDept(isTotal ? null : opt);
    setDropdownOpen(false);
  }

  // ── Data transforms ───────────────────────────────────────────────────────

  const flowTrend = useMemo(() => {
    if (!data) return [];
    const map: Record<string, Record<string, unknown>> = {};
    data.workforce_trend.inflow.forEach(r => {
      map[r.fiscal_year] = { fiscal_year: r.fiscal_year, Inflow: r.total };
    });
    data.workforce_trend.outflow.forEach(r => {
      if (!map[r.fiscal_year]) map[r.fiscal_year] = { fiscal_year: r.fiscal_year };
      map[r.fiscal_year].Outflow = r.total;
    });
    return Object.values(map).sort((a, b) =>
      String(a.fiscal_year).localeCompare(String(b.fiscal_year)),
    );
  }, [data]);

  const { hireTypeRows, hireTypes } = useMemo(() => {
    if (!data) return { hireTypeRows: [], hireTypes: [] as string[] };
    // Rank hire types by total volume, keep top 7
    const totals: Record<string, number> = {};
    data.inflow_by_type.forEach(r => {
      totals[r.hire_e] = (totals[r.hire_e] ?? 0) + (r.count ?? 0);
    });
    const topTypes = Object.entries(totals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 7)
      .map(([k]) => k);

    const map: Record<string, Record<string, unknown>> = {};
    data.inflow_by_type.forEach(r => {
      if (!topTypes.includes(r.hire_e)) return;
      if (!map[r.fiscal_year]) map[r.fiscal_year] = { fiscal_year: r.fiscal_year };
      map[r.fiscal_year][r.hire_e] = r.count;
    });
    return {
      hireTypeRows: Object.values(map).sort((a, b) =>
        String(a.fiscal_year).localeCompare(String(b.fiscal_year)),
      ),
      hireTypes: topTypes,
    };
  }, [data]);

  const eeData = useMemo(() => {
    if (!data) return [];
    const deptTotal = data.ee_snapshot.dept.reduce((s, r) => s + (r.count ?? 0), 0);
    const psTotal   = data.ee_snapshot.ps.reduce((s, r)   => s + (r.count ?? 0), 0);
    const psMap = Object.fromEntries(
      data.ee_snapshot.ps.map(r => [r.ee_group_e, r.count ?? 0]),
    );
    return data.ee_snapshot.dept
      .filter(r => r.ee_group_e && r.count != null)
      .map(r => ({
        group:   r.ee_group_e,
        deptPct: deptTotal > 0 ? ((r.count ?? 0) / deptTotal) * 100 : 0,
        psPct:   psTotal   > 0 ? ((psMap[r.ee_group_e] ?? 0) / psTotal) * 100 : 0,
        deptAbs: r.count ?? 0,
      }));
  }, [data]);

  const { mobilityTrendRows, mobilityTypes } = useMemo(() => {
    if (!data) return { mobilityTrendRows: [], mobilityTypes: [] as string[] };
    const totals: Record<string, number> = {};
    data.mobility_trend.forEach(r => {
      totals[r.mob_type_e] = (totals[r.mob_type_e] ?? 0) + (r.count ?? 0);
    });
    const types = Object.entries(totals)
      .sort(([, a], [, b]) => b - a)
      .map(([k]) => k);
    const map: Record<string, Record<string, unknown>> = {};
    data.mobility_trend.forEach(r => {
      if (!map[r.fiscal_year]) map[r.fiscal_year] = { fiscal_year: r.fiscal_year };
      map[r.fiscal_year][r.mob_type_e] = r.count;
    });
    return {
      mobilityTrendRows: Object.values(map).sort((a, b) =>
        String(a.fiscal_year).localeCompare(String(b.fiscal_year)),
      ),
      mobilityTypes: types,
    };
  }, [data]);

  const ageData = useMemo(() => {
    if (!data) return [];
    const deptTotal = data.age_snapshot.dept.reduce((s, r) => s + (r.count ?? 0), 0);
    const psTotal   = data.age_snapshot.ps.reduce((s, r)   => s + (r.count ?? 0), 0);
    const psMap = Object.fromEntries(
      data.age_snapshot.ps.map(r => [r.age_group_e, r.count ?? 0]),
    );
    return data.age_snapshot.dept
      .filter(r => r.age_group_e && r.count != null)
      .map(r => ({
        group:   r.age_group_e,
        deptPct: deptTotal > 0 ? ((r.count ?? 0) / deptTotal) * 100 : 0,
        psPct:   psTotal   > 0 ? ((psMap[r.age_group_e] ?? 0) / psTotal) * 100 : 0,
        deptAbs: r.count ?? 0,
      }));
  }, [data]);

  const headcountKpi = useMemo(() => {
    const hc = popData?.headcount ?? [];
    if (hc.length === 0) return null;
    const latest = hc[hc.length - 1];
    const prev   = hc[hc.length - 2];
    const change = latest.count != null && prev?.count != null && prev.count > 0
      ? ((latest.count - prev.count) / prev.count) * 100
      : null;
    return { year: latest.year, count: latest.count, change };
  }, [popData]);

  const { tenureRows, tenureTypes } = useMemo(() => {
    if (!popData || popData.tenure.length === 0) return { tenureRows: [], tenureTypes: [] as string[] };
    const types = [...new Set(popData.tenure.map(r => r.tenure_e))].sort();
    const map: Record<number, Record<string, unknown>> = {};
    popData.tenure.forEach(r => {
      if (!map[r.year]) map[r.year] = { fiscal_year: `${r.year - 1}-${r.year}` };
      map[r.year][r.tenure_e] = r.count;
    });
    return {
      tenureRows: Object.values(map).sort((a, b) =>
        String(a.fiscal_year).localeCompare(String(b.fiscal_year)),
      ),
      tenureTypes: types,
    };
  }, [popData]);

  const { outflowReasonRows, outflowReasons } = useMemo(() => {
    if (!data) return { outflowReasonRows: [], outflowReasons: [] as string[] };
    const totals: Record<string, number> = {};
    data.outflow_by_reason.forEach(r => {
      totals[r.sep_reason_e] = (totals[r.sep_reason_e] ?? 0) + (r.count ?? 0);
    });
    const topReasons = Object.entries(totals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([k]) => k);
    const map: Record<string, Record<string, unknown>> = {};
    data.outflow_by_reason.forEach(r => {
      if (!topReasons.includes(r.sep_reason_e)) return;
      if (!map[r.fiscal_year]) map[r.fiscal_year] = { fiscal_year: r.fiscal_year };
      map[r.fiscal_year][r.sep_reason_e] = r.count;
    });
    return {
      outflowReasonRows: Object.values(map).sort((a, b) =>
        String(a.fiscal_year).localeCompare(String(b.fiscal_year)),
      ),
      outflowReasons: topReasons,
    };
  }, [data]);



  // Merge applications trend with ad count totals (summed from adv_by_type) for combo chart
  // Derive advertisement count KPI from adv_by_type (sum across types per fiscal year)
  const advsKpi = useMemo((): KpiGroup => {
    if (!data) return { dept: [], ps: [] };
    const byYear: Record<string, number> = {};
    data.adv_by_type.forEach(r => {
      byYear[r.fiscal_year] = (byYear[r.fiscal_year] ?? 0) + (r.count ?? 0);
    });
    const dept = Object.entries(byYear)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 3)
      .map(([fiscal_year, total]) => ({ fiscal_year, total }));
    return { dept, ps: dept };
  }, [data]);

  const recruitmentTrend = useMemo(() => {
    if (!data) return [];
    const advCountMap: Record<string, number> = {};
    data.adv_by_type.forEach(r => {
      advCountMap[r.fiscal_year] = (advCountMap[r.fiscal_year] ?? 0) + (r.count ?? 0);
    });
    const map: Record<string, Record<string, unknown>> = {};
    data.applications_trend.forEach(r => {
      map[r.fiscal_year] = { fiscal_year: r.fiscal_year, Applications: r.total };
    });
    Object.entries(advCountMap).forEach(([fy, count]) => {
      if (!map[fy]) map[fy] = { fiscal_year: fy };
      map[fy].Advertisements = count;
    });
    return Object.values(map).sort((a, b) =>
      String(a.fiscal_year).localeCompare(String(b.fiscal_year)),
    );
  }, [data]);

  const isPsTotal   = !selectedDept;
  const displayName = selectedDept ?? 'Public Service (Total)';
  const latestFy    = data?.kpis.new_indeterminate.dept?.[0]?.fiscal_year;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1100, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header + Selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, gap: 24, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
            {displayName}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
            Staffing Overview{latestFy ? ` · Latest data: ${latestFy}` : ''}
          </p>
        </div>

        <div style={{ position: 'relative', width: 380 }}>
          <input
            ref={inputRef}
            value={deptInput}
            onChange={e => { setDeptInput(e.target.value); setDropdownOpen(true); }}
            onFocus={e => { setDropdownOpen(true); e.currentTarget.style.borderColor = '#1d3557'; }}
            onKeyDown={e => { if (e.key === 'Escape') setDropdownOpen(false); }}
            placeholder="Search department… (default: PS Total)"
            style={{
              width: '100%', padding: '9px 36px 9px 14px', fontSize: 13,
              border: '1.5px solid #e5e7eb', borderRadius: 8,
              boxSizing: 'border-box', outline: 'none',
              background: deptInput ? '#fff' : '#fafafa', color: '#111827',
              transition: 'border-color 0.15s',
            }}
            onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
          />
          {deptInput && (
            <button
              onClick={() => { setDeptInput(''); setSelectedDept(null); setDropdownOpen(false); }}
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#9ca3af', fontSize: 18, padding: 0, lineHeight: 1,
              }}
            >×</button>
          )}
          {dropdownOpen && filtered.length > 0 && (
            <ul ref={listRef} style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
              margin: 0, padding: '4px 0', listStyle: 'none',
              background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 8,
              zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
              maxHeight: 280, overflowY: 'auto',
            }}>
              {filtered.map(opt => (
                <li
                  key={opt}
                  onMouseDown={() => selectDept(opt)}
                  style={{
                    padding: '8px 14px', fontSize: 13, cursor: 'pointer',
                    color: '#374151',
                    fontWeight: opt === 'Public Service (Total)' ? 600 : 400,
                    borderBottom: '1px solid #f3f4f6',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f3f8ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {opt}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {isLoading && <p style={{ color: '#6b7280', fontSize: 14 }}>Loading…</p>}

      {data && (
        <>
          {/* ── Workforce Activity ── */}
          <SectionDivider label="Workforce Activity" />

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            {headcountKpi && (
              <div style={{
                flex: 1, minWidth: 160,
                background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10,
                padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  Headcount (TBS)
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 8 }}>
                  {headcountKpi.count != null ? headcountKpi.count.toLocaleString() : '—'}
                </div>
                {headcountKpi.change !== null && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: headcountKpi.change >= 0 ? '#16a34a' : '#dc2626', marginBottom: 4 }}>
                    {headcountKpi.change >= 0 ? '↑' : '↓'} {Math.abs(headcountKpi.change).toFixed(1)}%
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#c3c8ce' }}>Mar {headcountKpi.year}</div>
              </div>
            )}
            <KpiCard label="New Indeterminate"  kpi={data.kpis.new_indeterminate} isPsTotal={isPsTotal} qCount={data.q_count} rank={data.ranks?.new_indeterminate} headcount={data.tbs_headcount?.count} />
            <KpiCard label="Separations"        kpi={data.kpis.separations}       isPsTotal={isPsTotal} qCount={data.q_count} rank={data.ranks?.separations}       headcount={data.tbs_headcount?.count} />
            <NetFlowCard inflow={data.workforce_trend.inflow} outflow={data.workforce_trend.outflow} />
            <KpiCard label="Promotions"         kpi={data.kpis.promotions}        isPsTotal={isPsTotal} qCount={data.q_count} rank={data.ranks?.promotions}         headcount={data.tbs_headcount?.count} />
            <KpiCard label="Acting"             kpi={data.kpis.acting}            isPsTotal={isPsTotal} qCount={data.q_count} rank={data.ranks?.acting}             headcount={data.tbs_headcount?.count} />
            <KpiCard label="Lateral / Downward" kpi={data.kpis.lateral}           isPsTotal={isPsTotal} qCount={data.q_count} rank={data.ranks?.lateral}            headcount={data.tbs_headcount?.count} />
          </div>

          <ChartCard title="Workforce Flow" subtitle="Total inflow vs. outflow">
            <TimeSeriesChart
              data={flowTrend as Record<string, number | string>[]}
              xKey="fiscal_year"
              height={CHART_H}
              series={[
                { key: 'Inflow',  name: 'Inflow',  color: '#1d3557' },
                { key: 'Outflow', name: 'Outflow', color: '#e63946' },
              ]}
            />
          </ChartCard>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <ChartCard title="Inflow by Hire Type" subtitle="Appointments by classification">
              {hireTypeRows.length === 0
                ? <p style={{ color: '#6b7280', fontSize: 13 }}>No data.</p>
                : <StackedBarChart data={hireTypeRows} keys={hireTypes} />
              }
            </ChartCard>

            <ChartCard title="Separations by Reason" subtitle="Outflow breakdown by reason">
              {outflowReasonRows.length === 0
                ? <p style={{ color: '#6b7280', fontSize: 13 }}>No data.</p>
                : <StackedBarChart data={outflowReasonRows} keys={outflowReasons} />
              }
            </ChartCard>
          </div>

          <ChartCard title="Internal Mobility" subtitle="Promotions, acting, and lateral/downward movements over time">
            {mobilityTrendRows.length === 0
              ? <p style={{ color: '#6b7280', fontSize: 13 }}>No data.</p>
              : <TimeSeriesChart
                  data={mobilityTrendRows as Record<string, number | string>[]}
                  xKey="fiscal_year"
                  height={CHART_H}
                  series={mobilityTypes.map((t, i) => ({
                    key: t,
                    name: t,
                    color: HIRE_COLORS[i % HIRE_COLORS.length],
                  }))}
                />
            }
          </ChartCard>

          {tenureRows.length > 0 && (
            <ChartCard
              title="Workforce Tenure Mix (TBS)"
              subtitle="Headcount as of March 31 each year — Indeterminate · Term · Casual · Student"
            >
              <StackedBarChart data={tenureRows} keys={tenureTypes} />
            </ChartCard>
          )}

          {/* ── Recruitment & Staffing ── */}
          <SectionDivider label="Recruitment & Staffing" />

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <KpiCard label="Applications"   kpi={data.kpis.applications} isPsTotal={isPsTotal} qCount={data.q_count} />
            <KpiCard label="Advertisements" kpi={advsKpi}                isPsTotal={true}      qCount={data.q_count} />
          </div>

          <ChartCard
            title="Applications & Advertisements"
            subtitle="Bars = advertisements (right axis) · Line = applications (left axis)"
          >
            {recruitmentTrend.length === 0
              ? <p style={{ color: '#6b7280', fontSize: 13 }}>No data.</p>
              : (
                <ResponsiveContainer width="100%" height={CHART_H}>
                  <ComposedChart data={recruitmentTrend} margin={CHART_MARGIN}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                    <XAxis dataKey="fiscal_year" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11 }}
                      width={48}
                      tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)}
                    />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={40} />
                    <Tooltip />
                    <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 10.5, paddingTop: 4 }} />
                    <Bar yAxisId="right" dataKey="Advertisements" name="Advertisements" fill="#e9c46a" opacity={0.75} />
                    <Line yAxisId="left" type="monotone" dataKey="Applications" name="Applications" stroke="#457b9d" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )
            }
          </ChartCard>

          {/* ── Demographics ── */}
          {(eeData.length > 0 || ageData.length > 0) && (
            <>
              <SectionDivider label="Demographics" />
              <div style={{ display: 'grid', gridTemplateColumns: eeData.length > 0 && ageData.length > 0 ? '1fr 1fr' : '1fr', gap: 16 }}>

                {/* EE Group Distribution */}
                {eeData.length > 0 && (
                  <div style={{
                    border: '1px solid #dee2e6', borderRadius: 8,
                    padding: '16px 20px', background: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#1d3557' }}>EE Group Distribution</span>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>
                        Latest year · % of appointments
                        {!isPsTotal && <> · <span style={{ color: '#1d3557', fontWeight: 600 }}>■</span> Dept &nbsp;<span style={{ color: '#a8dadc', fontWeight: 600 }}>■</span> PS</>}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {eeData.map(g => (
                        <div key={g.group}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12.5, color: '#374151', fontWeight: 500 }}>{g.group}</span>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111827' }}>
                              {g.deptPct.toFixed(1)}%
                              <span style={{ fontSize: 10.5, fontWeight: 400, color: '#9ca3af', marginLeft: 4 }}>
                                ({g.deptAbs.toLocaleString()})
                              </span>
                            </span>
                          </div>
                          <div style={{ height: 7, background: '#f3f4f6', borderRadius: 99, marginBottom: !isPsTotal ? 4 : 0 }}>
                            <div style={{ height: 7, width: `${Math.min(g.deptPct, 100)}%`, background: '#1d3557', borderRadius: 99, transition: 'width 0.4s ease' }} />
                          </div>
                          {!isPsTotal && (
                            <>
                              <div style={{ height: 4, background: '#f3f4f6', borderRadius: 99 }}>
                                <div style={{ height: 4, width: `${Math.min(g.psPct, 100)}%`, background: '#a8dadc', borderRadius: 99, transition: 'width 0.4s ease' }} />
                              </div>
                              <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>PS: {g.psPct.toFixed(1)}%</div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Age Distribution */}
                {ageData.length > 0 && (
                  <div style={{
                    border: '1px solid #dee2e6', borderRadius: 8,
                    padding: '16px 20px', background: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#1d3557' }}>Age Distribution</span>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>
                        Latest year · % of appointments
                        {!isPsTotal && <> · <span style={{ color: '#1d3557', fontWeight: 600 }}>■</span> Dept &nbsp;<span style={{ color: '#a8dadc', fontWeight: 600 }}>■</span> PS</>}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {ageData.map(g => (
                        <div key={g.group}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 12.5, color: '#374151', fontWeight: 500 }}>{g.group}</span>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#111827' }}>
                              {g.deptPct.toFixed(1)}%
                              <span style={{ fontSize: 10.5, fontWeight: 400, color: '#9ca3af', marginLeft: 4 }}>
                                ({g.deptAbs.toLocaleString()})
                              </span>
                            </span>
                          </div>
                          <div style={{ height: 7, background: '#f3f4f6', borderRadius: 99, marginBottom: !isPsTotal ? 4 : 0 }}>
                            <div style={{ height: 7, width: `${Math.min(g.deptPct, 100)}%`, background: '#457b9d', borderRadius: 99, transition: 'width 0.4s ease' }} />
                          </div>
                          {!isPsTotal && (
                            <>
                              <div style={{ height: 4, background: '#f3f4f6', borderRadius: 99 }}>
                                <div style={{ height: 4, width: `${Math.min(g.psPct, 100)}%`, background: '#a8dadc', borderRadius: 99, transition: 'width 0.4s ease' }} />
                              </div>
                              <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>PS: {g.psPct.toFixed(1)}%</div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <p style={{ marginTop: 16, fontSize: 10.5, color: '#9ca3af', lineHeight: 1.5 }}>
            Staffing activity (inflow, outflow, mobility, demographics): PSC Staffing and Non-Partisanship Survey Dashboard open data.
            Headcount and tenure mix: TBS Federal Public Service Statistics (March 31 snapshot each year — year N corresponds to PSC fiscal year {'{'}N-1{'}'}-N).
            {!isPsTotal && ' TBS and PSC use independent department name lists — headcount may not appear if the names differ between sources.'}
            {!isPsTotal && ' Rank compares to all PSC-covered departments in the same fiscal year. Rate per 1,000 uses TBS March 31 headcount as the denominator.'}
          </p>
        </>
      )}
    </div>
  );
}
