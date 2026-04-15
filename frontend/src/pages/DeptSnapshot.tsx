import { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import client from '../api/client';

// ── Types ──────────────────────────────────────────────────────────────────

interface KpiSeries { fiscal_year: string; total: number | null; qtr_total?: number | null }
interface KpiGroup  { dept: KpiSeries[]; ps: KpiSeries[] }

interface SnapshotData {
  department: string;
  is_ps_total: boolean;
  q_count: number;
  kpis: {
    total_inflow: KpiGroup;
    separations:  KpiGroup;
    promotions:   KpiGroup;
    acting:       KpiGroup;
    lateral:      KpiGroup;
  };
  adv_pct: { dept: number | null; ps: number | null };
  workforce_trend: {
    inflow:  { fiscal_year: string; total: number | null }[];
    outflow: { fiscal_year: string; total: number | null }[];
  };
  inflow_by_type: { fiscal_year: string; hire_e: string; count: number | null }[];
  tbs_headcount: { year: number; count: number } | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function latestVal(arr: KpiSeries[]): number | null {
  return arr?.[0]?.total ?? null;
}

function fmt(n: number | null, decimals = 0): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number | null, decimals = 1): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

function yoyPct(arr: KpiSeries[], qCount: number): number | null {
  const curr  = arr?.[0]?.total;
  const prior = arr?.[1];
  if (curr == null || prior == null) return null;
  const priorFytd = prior.qtr_total != null
    ? prior.qtr_total
    : prior.total != null ? prior.total * (qCount / 4) : null;
  if (priorFytd == null || priorFytd === 0) return null;
  return ((curr - priorFytd) / priorFytd) * 100;
}

function sizeTierFromHeadcount(hc: number): string {
  if (hc < 100)  return 'Micro - Average';
  if (hc < 500)  return 'Small - Average';
  if (hc < 2000) return 'Medium - Average';
  return 'Large - Average';
}

function sizeTierLabel(tier: string): string {
  const map: Record<string, string> = {
    'Micro - Average': 'Micro', 'Small - Average': 'Small',
    'Medium - Average': 'Medium', 'Large - Average': 'Large',
  };
  return map[tier] ?? 'Peer';
}

// ── Opinionated headline ────────────────────────────────────────────────────

interface HeadlineParams {
  net: number | null;
  hiringYoy: number | null;
  leavingYoy: number | null;
  advPctDept: number | null;
  advPctPs: number | null;
}

function getHeadline(p: HeadlineParams): string {
  const base = p.net == null ? 'Hiring and departures are balanced'
    : p.net > 0 ? 'Hiring remains higher than departures'
    : p.net < 0 ? 'Departures remain higher than hiring'
    : 'Hiring and departures are balanced';

  const advDiff = p.advPctDept != null && p.advPctPs != null ? p.advPctDept - p.advPctPs : null;
  const hiringUp     = p.hiringYoy  != null && p.hiringYoy  >= 20;
  const hiringDown   = p.hiringYoy  != null && p.hiringYoy  <= -25;
  const leavingUp    = p.leavingYoy != null && p.leavingYoy >= 15;
  const leavingDown  = p.leavingYoy != null && p.leavingYoy <= -15;

  let modifier = '';
  if (hiringDown)
    modifier = 'despite a sharp decline in hiring';
  else if (hiringUp && leavingDown)
    modifier = 'driven by strong hiring growth and falling departures';
  else if (leavingUp)
    modifier = 'driven by rising departures';
  else if (hiringUp)
    modifier = 'driven by strong hiring growth';
  else if (leavingDown)
    modifier = 'driven by falling departures';
  else if (advDiff != null && advDiff <= -10)
    modifier = 'with greater reliance on non-advertised hiring';
  else if (advDiff != null && advDiff >= 10)
    modifier = 'with higher use of advertised hiring processes';

  return modifier ? `${base}, ${modifier}.` : `${base}.`;
}

// ── PS comparison badge ─────────────────────────────────────────────────────

function PsBadge({ diff, higherIsGood, suffix = 'pp' }: {
  diff: number | null;
  higherIsGood: boolean;
  suffix?: string;
}) {
  if (diff == null) return null;
  const abs   = Math.abs(diff);
  const above = diff > 0;
  const good  = higherIsGood ? above : !above;
  const color = Math.abs(diff) < 2 ? '#6b7280' : good ? '#15803d' : '#dc2626';
  const bg    = Math.abs(diff) < 2 ? '#f1f5f9' : good ? '#f0fdf4' : '#fff5f5';
  const label = Math.abs(diff) < 2
    ? 'At PS avg'
    : `${above ? '+' : '−'}${abs.toFixed(0)}${suffix} vs PS`;

  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, color, background: bg,
      marginTop: 4,
    }}>
      {label}
    </span>
  );
}

// ── KPI card ────────────────────────────────────────────────────────────────

function KpiCard({ label, value, yoy, psYoy, extra, highlight }: {
  label: string;
  value: number | null;
  yoy: number | null;
  psYoy?: number | null;
  extra?: React.ReactNode;
  highlight?: boolean;
}) {
  const upColor   = '#16a34a';
  const downColor = '#dc2626';

  return (
    <div style={{
      flex: 1, minWidth: 150,
      background: '#fff',
      border: highlight ? '2px solid #1d3557' : '1.5px solid #e5e7eb',
      borderRadius: 10,
      padding: '18px 20px',
      boxShadow: highlight ? '0 2px 8px rgba(29,53,87,0.1)' : '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ fontSize: highlight ? 32 : 26, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 10 }}>
        {value != null ? value.toLocaleString() : '—'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {yoy != null && (
          <span style={{ fontSize: 13, fontWeight: 600, color: yoy >= 0 ? upColor : downColor }}>
            {yoy >= 0 ? '↑' : '↓'} {Math.abs(yoy).toFixed(1)}% YoY
          </span>
        )}
        {psYoy != null && (
          <span style={{ fontSize: 11.5, color: '#6b7280' }}>
            PS: {psYoy >= 0 ? '+' : ''}{psYoy.toFixed(1)}%
          </span>
        )}
        {extra}
      </div>
    </div>
  );
}

function NetCard({ net, status }: { net: number | null; status: string }) {
  const positive = net !== null && net > 0;
  const negative = net !== null && net < 0;
  return (
    <div style={{
      flex: 1, minWidth: 150,
      background: negative ? '#fff5f5' : positive ? '#f0fdf4' : '#fff',
      border: `1.5px solid ${negative ? '#fca5a5' : positive ? '#86efac' : '#e5e7eb'}`,
      borderRadius: 10,
      padding: '18px 20px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
        Net Change
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: negative ? '#dc2626' : positive ? '#15803d' : '#111827', lineHeight: 1, marginBottom: 10 }}>
        {net != null ? `${positive ? '+' : ''}${net.toLocaleString()}` : '—'}
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: negative ? '#dc2626' : positive ? '#15803d' : '#6b7280' }}>
        {status}
      </span>
    </div>
  );
}

// ── Hiring composition ───────────────────────────────────────────────────────

const HIRE_PALETTE = ['#1d3557', '#457b9d', '#2a9d8f', '#e9c46a', '#f4a261', '#e63946', '#adb5bd'];

const HIRE_LABEL_SHORT: Record<string, string> = {
  'New Indeterminate': 'New Indet.',
  'New Term': 'New Term',
  'Casual': 'Casual',
  'Student': 'Student',
  'Term to Indeterminate': 'Term → Indet.',
  'Indeterminate from other organization': 'Indet. other org',
  'Term from other organization': 'Term other org',
};

function HiringComposition({ inflow_by_type }: { inflow_by_type: { fiscal_year: string; hire_e: string; count: number | null }[] }) {
  if (!inflow_by_type.length) return null;

  const latestFy = inflow_by_type.reduce((max, r) => r.fiscal_year > max ? r.fiscal_year : max, '');
  const latestRows = inflow_by_type.filter(r => r.fiscal_year === latestFy);
  const total = latestRows.reduce((s, r) => s + (r.count ?? 0), 0);
  if (total === 0) return null;

  // Sort by count desc, keep top 6
  const sorted = [...latestRows]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 6);

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 8,
      padding: '20px 24px', background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      marginBottom: 0,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 2 }}>
        What's driving hiring?
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 18 }}>
        Hiring breakdown by type · {latestFy}
      </div>

      <div style={{ height: 16, borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 16 }}>
        {sorted.map((r, i) => {
          const pct = total > 0 ? (r.count ?? 0) / total * 100 : 0;
          return (
            <div key={r.hire_e} style={{ width: `${pct}%`, background: HIRE_PALETTE[i % HIRE_PALETTE.length] }} />
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map((r, i) => {
          const pct = total > 0 ? (r.count ?? 0) / total * 100 : 0;
          const label = HIRE_LABEL_SHORT[r.hire_e] ?? r.hire_e;
          return (
            <div key={r.hire_e}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: HIRE_PALETTE[i % HIRE_PALETTE.length], display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: '#374151' }}>{label}</span>
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#111827' }}>
                  {pct.toFixed(0)}%
                  <span style={{ fontSize: 11, fontWeight: 400, color: '#9ca3af', marginLeft: 5 }}>
                    {(r.count ?? 0).toLocaleString()}
                  </span>
                </span>
              </div>
              <div style={{ height: 5, background: '#f3f4f6', borderRadius: 99 }}>
                <div style={{ height: 5, width: `${pct}%`, background: HIRE_PALETTE[i % HIRE_PALETTE.length], borderRadius: 99 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Comparison table ────────────────────────────────────────────────────────

interface CompRow {
  label: string;
  dept: string;
  peer?: string;
  ps: string;
  deptNum?: number | null;
  psNum?: number | null;
  higherIsBetter?: boolean;
}

function ComparisonTable({ rows, deptName, peerLabel }: {
  rows: CompRow[];
  deptName: string;
  peerLabel?: string;
}) {
  const hasPeer = rows.some(r => r.peer !== undefined);

  function cellColor(deptNum: number | null | undefined, psNum: number | null | undefined, higherIsBetter: boolean | undefined): string {
    if (deptNum == null || psNum == null || higherIsBetter == null) return '#374151';
    if (higherIsBetter) return deptNum >= psNum ? '#15803d' : '#dc2626';
    return deptNum <= psNum ? '#15803d' : '#dc2626';
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#6b7280', fontWeight: 600, fontSize: 11 }}>Metric</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#1d3557', fontWeight: 700, fontSize: 11 }}>
              {deptName.length > 30 ? 'This dept' : deptName}
            </th>
            {hasPeer && peerLabel && (
              <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6b7280', fontWeight: 600, fontSize: 11 }}>
                {peerLabel}
              </th>
            )}
            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6b7280', fontWeight: 600, fontSize: 11 }}>PS Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.label} style={{ background: i % 2 === 1 ? '#f9fafb' : '#fff', borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '9px 12px', color: '#374151' }}>{row.label}</td>
              <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, color: cellColor(row.deptNum, row.psNum, row.higherIsBetter) }}>
                {row.dept}
              </td>
              {hasPeer && (
                <td style={{ padding: '9px 12px', textAlign: 'right', color: '#6b7280' }}>
                  {row.peer ?? '—'}
                </td>
              )}
              <td style={{ padding: '9px 12px', textAlign: 'right', color: '#6b7280' }}>{row.ps}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Department selector ─────────────────────────────────────────────────────

function DeptSelector({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [input, setInput] = useState('');
  const [open, setOpen]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  const { data: departments = [] } = useQuery<string[]>({
    queryKey: ['staffing-departments'],
    queryFn: () => client.get('/staffing/departments').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const options  = useMemo(() => ['All Public Service', ...departments], [departments]);
  const filtered = input.trim()
    ? options.filter(o => o.toLowerCase().includes(input.toLowerCase()))
    : options;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!inputRef.current?.contains(e.target as Node) && !listRef.current?.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => { setInput(value ?? ''); }, [value]);

  function select(opt: string) {
    const isTotal = opt === 'All Public Service';
    setInput(isTotal ? '' : opt);
    onChange(isTotal ? null : opt);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 440 }}>
      <input
        ref={inputRef}
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true); }}
        onFocus={e => { setOpen(true); e.currentTarget.style.borderColor = '#1d3557'; }}
        onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="All Public Service"
        style={{
          width: '100%', padding: '9px 34px 9px 14px', fontSize: 13,
          border: '1.5px solid #e5e7eb', borderRadius: 8,
          boxSizing: 'border-box', outline: 'none',
          background: '#fafafa', color: '#111827',
          transition: 'border-color 0.15s',
        }}
      />
      {input && (
        <button
          onClick={() => { setInput(''); onChange(null); setOpen(false); }}
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, padding: 0, lineHeight: 1 }}
        >×</button>
      )}
      {open && filtered.length > 0 && (
        <ul ref={listRef} style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          margin: 0, padding: '4px 0', listStyle: 'none',
          background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 8,
          zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
          maxHeight: 260, overflowY: 'auto',
        }}>
          {filtered.slice(0, 80).map(opt => (
            <li
              key={opt}
              onMouseDown={() => select(opt)}
              style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: '#374151', fontWeight: opt === 'All Public Service' ? 600 : 400, borderBottom: '1px solid #f3f4f6' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f8ff')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{opt}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function DeptSnapshot() {
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const isPsTotal = !selectedDept;

  const { data, isLoading } = useQuery<SnapshotData>({
    queryKey: ['dept-snapshot', selectedDept],
    queryFn: () =>
      client.get('/staffing/department-overview', {
        params: selectedDept ? { department: selectedDept } : {},
      }).then(r => r.data),
    staleTime: 60_000,
  });

  const sizeTier = useMemo(() => {
    const hc = data?.tbs_headcount?.count;
    if (!hc || isPsTotal) return null;
    return sizeTierFromHeadcount(hc);
  }, [data, isPsTotal]);

  const { data: peerData } = useQuery<SnapshotData>({
    queryKey: ['dept-snapshot-peer', sizeTier],
    queryFn: () =>
      client.get('/staffing/department-overview', { params: { department: sizeTier! } }).then(r => r.data),
    enabled: !!sizeTier,
    staleTime: 5 * 60_000,
  });

  // ── Computed values ──────────────────────────────────────────────────────

  const qCount = data?.q_count ?? 4;

  const hiringVal   = latestVal(data?.kpis.total_inflow.dept ?? []);
  const leavingVal  = latestVal(data?.kpis.separations.dept  ?? []);
  const netChange   = hiringVal != null && leavingVal != null ? hiringVal - leavingVal : null;

  const hiringYoy    = yoyPct(data?.kpis.total_inflow.dept ?? [], qCount);
  const leavingYoy   = yoyPct(data?.kpis.separations.dept  ?? [], qCount);
  const hiringYoyPs  = yoyPct(data?.kpis.total_inflow.ps   ?? [], qCount);
  const leavingYoyPs = yoyPct(data?.kpis.separations.ps    ?? [], qCount);

  const mobilityVal = useMemo(() => {
    if (!data) return null;
    const p = latestVal(data.kpis.promotions.dept);
    const a = latestVal(data.kpis.acting.dept);
    const l = latestVal(data.kpis.lateral.dept);
    if (p == null && a == null && l == null) return null;
    return (p ?? 0) + (a ?? 0) + (l ?? 0);
  }, [data]);

  const mobilityValPs = useMemo(() => {
    if (!data) return null;
    const p = latestVal(data.kpis.promotions.ps);
    const a = latestVal(data.kpis.acting.ps);
    const l = latestVal(data.kpis.lateral.ps);
    if (p == null && a == null && l == null) return null;
    return (p ?? 0) + (a ?? 0) + (l ?? 0);
  }, [data]);

  const peerMobilityPct = useMemo(() => {
    if (!peerData || !sizeTier) return null;
    const peerHiring = latestVal(peerData.kpis.total_inflow.dept);
    const peerMob = (latestVal(peerData.kpis.promotions.dept) ?? 0)
      + (latestVal(peerData.kpis.acting.dept) ?? 0)
      + (latestVal(peerData.kpis.lateral.dept) ?? 0);
    return peerHiring && peerHiring > 0 ? (peerMob / peerHiring) * 100 : null;
  }, [peerData, sizeTier]);

  const psHiringVal   = latestVal(data?.kpis.total_inflow.ps ?? []);
  const mobilityPct   = mobilityVal != null && hiringVal   != null && hiringVal   > 0 ? (mobilityVal   / hiringVal)   * 100 : null;
  const mobilityPctPs = mobilityValPs != null && psHiringVal != null && psHiringVal > 0 ? (mobilityValPs / psHiringVal) * 100 : null;

  const hiringVsPs  = hiringYoy  != null && hiringYoyPs  != null ? hiringYoy  - hiringYoyPs  : null;
  const leavingVsPs = leavingYoy != null && leavingYoyPs != null ? leavingYoy - leavingYoyPs : null;

  const advDiff = data?.adv_pct.dept != null && data?.adv_pct.ps != null
    ? data.adv_pct.dept - data.adv_pct.ps
    : null;

  // Status label
  const status = leavingYoy != null && leavingYoy > 20 ? 'At risk'
    : netChange === null ? 'Stable'
    : netChange > 0 ? 'Growing'
    : netChange < 0 ? 'Declining'
    : 'Stable';

  // Opinionated headline
  const headline = data ? getHeadline({
    net: netChange,
    hiringYoy,
    leavingYoy,
    advPctDept: data.adv_pct.dept,
    advPctPs: data.adv_pct.ps,
  }) : null;

  // Peer metrics (for comparison table)
  const peerHiringVal  = peerData ? latestVal(peerData.kpis.total_inflow.dept) : null;
  const peerLeavingVal = peerData ? latestVal(peerData.kpis.separations.dept)  : null;
  const peerHiringYoy  = peerData ? yoyPct(peerData.kpis.total_inflow.dept, peerData.q_count) : null;
  const peerLeavingYoy = peerData ? yoyPct(peerData.kpis.separations.dept,  peerData.q_count) : null;
  const peerAdvPct     = peerData?.adv_pct.dept ?? null;

  // Flow trend chart data
  const flowTrend = useMemo(() => {
    if (!data) return [];
    const map: Record<string, Record<string, unknown>> = {};
    data.workforce_trend.inflow.forEach(r => { map[r.fiscal_year] = { fiscal_year: r.fiscal_year, Hiring: r.total }; });
    data.workforce_trend.outflow.forEach(r => {
      if (!map[r.fiscal_year]) map[r.fiscal_year] = { fiscal_year: r.fiscal_year };
      map[r.fiscal_year].Leaving = r.total;
    });
    return Object.values(map).sort((a, b) => String(a.fiscal_year).localeCompare(String(b.fiscal_year)));
  }, [data]);

  const compRows: CompRow[] = useMemo(() => {
    if (!data) return [];
    const psHiring  = latestVal(data.kpis.total_inflow.ps);
    const psLeaving = latestVal(data.kpis.separations.ps);
    return [
      {
        label: 'Hiring (latest year)',
        dept: fmt(hiringVal),
        peer: fmt(peerHiringVal),
        ps:   fmt(psHiring),
        deptNum: hiringVal, psNum: psHiring, higherIsBetter: true,
      },
      {
        label: 'Departures (latest year)',
        dept: fmt(leavingVal),
        peer: fmt(peerLeavingVal),
        ps:   fmt(psLeaving),
        deptNum: leavingVal, psNum: psLeaving, higherIsBetter: false,
      },
      {
        label: 'Hiring YoY',
        dept: fmtPct(hiringYoy),
        peer: fmtPct(peerHiringYoy),
        ps:   fmtPct(hiringYoyPs),
        deptNum: hiringYoy, psNum: hiringYoyPs, higherIsBetter: true,
      },
      {
        label: 'Departures YoY',
        dept: fmtPct(leavingYoy),
        peer: fmtPct(peerLeavingYoy),
        ps:   fmtPct(leavingYoyPs),
        deptNum: leavingYoy, psNum: leavingYoyPs, higherIsBetter: false,
      },
      {
        label: 'Mobility rate',
        dept: mobilityPct    != null ? `${mobilityPct.toFixed(0)}%`    : '—',
        peer: peerMobilityPct != null ? `${peerMobilityPct.toFixed(0)}%` : '—',
        ps:   mobilityPctPs  != null ? `${mobilityPctPs.toFixed(0)}%`  : '—',
      },
      {
        label: 'Advertised %',
        dept: data.adv_pct.dept != null ? `${data.adv_pct.dept.toFixed(0)}%` : '—',
        peer: peerAdvPct        != null ? `${peerAdvPct.toFixed(0)}%`        : '—',
        ps:   data.adv_pct.ps  != null ? `${data.adv_pct.ps.toFixed(0)}%`   : '—',
        deptNum: data.adv_pct.dept, psNum: data.adv_pct.ps, higherIsBetter: undefined,
      },
    ];
  }, [data, hiringVal, leavingVal, hiringYoy, leavingYoy, hiringYoyPs, leavingYoyPs,
      mobilityPct, mobilityPctPs, peerMobilityPct,
      peerHiringVal, peerLeavingVal, peerHiringYoy, peerLeavingYoy, peerAdvPct]);

  const latestFy  = data?.kpis.total_inflow.dept?.[0]?.fiscal_year;
  const displayName = selectedDept ?? 'All Public Service';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 860, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
        Department Snapshot
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>
        What's happening in this department?
      </p>
      <DeptSelector value={selectedDept} onChange={setSelectedDept} />

      {isLoading && (
        <div style={{ padding: '48px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading…</div>
      )}

      {data && (
        <>
          {/* ── Headline block ─────────────────────────────────────────────── */}
          <div style={{ margin: '28px 0 24px', borderLeft: '4px solid #1d3557', paddingLeft: 16 }}>

            {/* Status + period — small, above the headline */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 11.5, fontWeight: 700,
                color: status === 'Growing' ? '#15803d' : status === 'At risk' ? '#b45309' : status === 'Declining' ? '#dc2626' : '#475569',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {status}
              </span>
              {latestFy && (
                <span style={{ fontSize: 11.5, color: '#9ca3af' }}>
                  · {latestFy}{qCount < 4 ? ` FYTD Q${qCount}` : ''}
                </span>
              )}
              {sizeTier && !isPsTotal && (
                <span style={{ fontSize: 11, color: '#6b7280', background: '#f1f5f9', borderRadius: 4, padding: '2px 7px' }}>
                  {sizeTierLabel(sizeTier)} org
                </span>
              )}
            </div>

            {/* The headline — this is the anchor */}
            {headline && (
              <p style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#111827', lineHeight: 1.3, letterSpacing: '-0.02em' }}>
                {headline}
              </p>
            )}

            {/* Supporting context — smaller */}
            <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>
              {hiringYoy != null && leavingYoy != null && (
                <span>
                  Hiring {hiringYoy >= 0 ? 'up' : 'down'} {Math.abs(hiringYoy).toFixed(0)}%,{' '}
                  departures {leavingYoy >= 0 ? 'up' : 'down'} {Math.abs(leavingYoy).toFixed(0)}% year-over-year.
                </span>
              )}
              {!isPsTotal && advDiff != null && Math.abs(advDiff) >= 5 && (
                <span style={{ marginLeft: 6 }}>
                  {advDiff < 0 ? 'Less reliant on advertised processes' : 'More reliant on advertised processes'} than PS ({data.adv_pct.dept?.toFixed(0)}% vs {data.adv_pct.ps?.toFixed(0)}%).
                </span>
              )}
            </div>
          </div>

          {/* ── 4 KPI cards ─────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>

            {/* Hiring */}
            <KpiCard
              label="Hiring"
              value={hiringVal}
              yoy={hiringYoy}
              psYoy={hiringYoyPs}
              highlight
              extra={<>
                {hiringVsPs != null && <PsBadge diff={hiringVsPs} higherIsGood={true} />}
                {data.adv_pct.dept != null && (
                  <span style={{ fontSize: 11.5, color: '#6b7280', marginTop: 4 }}>
                    {data.adv_pct.dept.toFixed(0)}% advertised
                    {!isPsTotal && data.adv_pct.ps != null && (
                      <span style={{ color: '#9ca3af' }}> · PS: {data.adv_pct.ps.toFixed(0)}%</span>
                    )}
                  </span>
                )}
              </>}
            />

            {/* Leaving */}
            <KpiCard
              label="Leaving"
              value={leavingVal}
              yoy={leavingYoy}
              psYoy={leavingYoyPs}
              extra={!isPsTotal && leavingVsPs != null ? <PsBadge diff={-leavingVsPs} higherIsGood={true} /> : undefined}
            />

            {/* Net Change */}
            <NetCard net={netChange} status={status} />

            {/* Mobility */}
            <div style={{ flex: 1, minWidth: 150, background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Internal Movement</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 10 }}>
                {mobilityPct != null ? `${mobilityPct.toFixed(0)}%` : mobilityVal != null ? mobilityVal.toLocaleString() : '—'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {mobilityVal != null && (
                  <span style={{ fontSize: 11.5, color: '#6b7280' }}>{mobilityVal.toLocaleString()} actions</span>
                )}
                {mobilityPctPs != null && (
                  <span style={{ fontSize: 11.5, color: '#6b7280' }}>PS: {mobilityPctPs.toFixed(0)}%</span>
                )}
                {!isPsTotal && mobilityPct != null && mobilityPctPs != null && (
                  <PsBadge diff={mobilityPct - mobilityPctPs} higherIsGood={true} />
                )}
                {peerMobilityPct != null && (
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>{sizeTierLabel(sizeTier!)} avg: {peerMobilityPct.toFixed(0)}%</span>
                )}
              </div>
            </div>
          </div>

          {/* ── Hiring vs Leaving — single chart ────────────────────────────── */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '20px 24px', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 2 }}>Hiring vs Leaving</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>All available years · {displayName}</div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={flowTrend} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="fiscal_year" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Hiring"  stroke="#1d3557" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="Leaving" stroke="#e63946" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ── Hiring composition ────────────────────────────────────────── */}
          {data.inflow_by_type?.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <HiringComposition inflow_by_type={data.inflow_by_type} />
            </div>
          )}

          {/* ── Comparison table ──────────────────────────────────────────── */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '20px 24px', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 12 }}>
              How does this compare?
            </div>
            <ComparisonTable
              rows={compRows}
              deptName={displayName}
              peerLabel={sizeTier ? `${sizeTierLabel(sizeTier)} avg` : undefined}
            />
            <p style={{ fontSize: 11, color: '#9ca3af', margin: '10px 0 0' }}>
              YoY comparisons are FYTD-normalized when current year is partial.
              {sizeTier && ` Peer avg = ${sizeTier} from PSC open data.`}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
