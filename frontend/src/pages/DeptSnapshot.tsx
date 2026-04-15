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
    total_inflow:  KpiGroup;
    separations:   KpiGroup;
    promotions:    KpiGroup;
    acting:        KpiGroup;
    lateral:       KpiGroup;
  };
  adv_pct: { dept: number | null; ps: number | null };
  workforce_trend: {
    inflow:  { fiscal_year: string; total: number | null }[];
    outflow: { fiscal_year: string; total: number | null }[];
  };
  tbs_headcount: { year: number; count: number } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function latestVal(arr: KpiSeries[]): number | null {
  return arr?.[0]?.total ?? null;
}

function yoyPct(arr: KpiSeries[], qCount: number): number | null {
  const curr = arr?.[0]?.total;
  const prior = arr?.[1];
  if (curr == null || prior == null) return null;
  const priorFytd = prior.qtr_total != null
    ? prior.qtr_total
    : prior.total != null ? prior.total * (qCount / 4) : null;
  if (priorFytd == null || priorFytd === 0) return null;
  return ((curr - priorFytd) / priorFytd) * 100;
}

function fmt(n: number | null, decimals = 0): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number | null, decimals = 1): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

function sizeTierFromHeadcount(hc: number): string {
  if (hc < 100)   return 'Micro - Average';
  if (hc < 500)   return 'Small - Average';
  if (hc < 2000)  return 'Medium - Average';
  return 'Large - Average';
}

function sizeTierLabel(tier: string): string {
  if (tier === 'Micro - Average')  return 'Micro';
  if (tier === 'Small - Average')  return 'Small';
  if (tier === 'Medium - Average') return 'Medium';
  if (tier === 'Large - Average')  return 'Large';
  return 'Peer';
}

// ── Status & insight ───────────────────────────────────────────────────────

type Status = 'Growing' | 'Stable' | 'Declining' | 'At risk';

function getStatus(net: number | null, leavingYoy: number | null): Status {
  if (leavingYoy !== null && leavingYoy > 20) return 'At risk';
  if (net === null) return 'Stable';
  if (net > 0) return 'Growing';
  if (net < 0) return 'Declining';
  return 'Stable';
}

const STATUS_STYLE: Record<Status, { bg: string; border: string; color: string; icon: string }> = {
  Growing:   { bg: '#f0fdf4', border: '#86efac', color: '#15803d', icon: '↑' },
  Stable:    { bg: '#f8fafc', border: '#cbd5e1', color: '#475569', icon: '→' },
  Declining: { bg: '#fff5f5', border: '#fca5a5', color: '#dc2626', icon: '↓' },
  'At risk': { bg: '#fffbeb', border: '#fde68a', color: '#b45309', icon: '⚠' },
};

interface InsightParams {
  isPsTotal: boolean;
  net: number | null;
  hiringYoy: number | null;
  leavingYoy: number | null;
  hiringYoyPs: number | null;
  leavingYoyPs: number | null;
  advPctDept: number | null;
  advPctPs: number | null;
}

function buildInsight(p: InsightParams): string[] {
  const sentences: string[] = [];

  // Sentence 1: net direction
  if (p.net !== null) {
    if (p.net < 0) sentences.push('The workforce is shrinking.');
    else if (p.net > 0) sentences.push('The workforce is growing.');
    else sentences.push('The workforce is stable.');
  }

  // Sentence 2: hiring vs leaving dynamics
  if (p.hiringYoy !== null && p.leavingYoy !== null) {
    const diff = p.leavingYoy - p.hiringYoy;
    if (diff > 5) {
      sentences.push('Departures are increasing faster than hiring.');
    } else if (p.hiringYoy - p.leavingYoy > 5) {
      sentences.push('Hiring is outpacing departures.');
    } else if (!p.isPsTotal && p.hiringYoyPs !== null && p.leavingYoyPs !== null) {
      const deptTrend = p.hiringYoy - p.leavingYoy;
      const psTrend   = p.hiringYoyPs - p.leavingYoyPs;
      if (deptTrend < psTrend - 5) {
        sentences.push('Net flow is weaker than the PSC average.');
      } else if (deptTrend > psTrend + 5) {
        sentences.push('Net flow is stronger than the PSC average.');
      }
    }
  }

  // Sentence 3: advertised % vs PSC (skip for PS Total)
  if (!p.isPsTotal && p.advPctDept !== null && p.advPctPs !== null) {
    const diff = p.advPctDept - p.advPctPs;
    if (diff <= -10) {
      sentences.push(
        `Hiring relies more on non-advertised processes than the PSC average (${p.advPctDept.toFixed(0)}% vs ${p.advPctPs.toFixed(0)}% advertised).`
      );
    } else if (diff >= 10) {
      sentences.push(
        `Advertised processes are used more than the PSC average (${p.advPctDept.toFixed(0)}% vs ${p.advPctPs.toFixed(0)}%).`
      );
    }
  }

  return sentences;
}

// ── Components ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, yoy, vsLabel, vsYoy, extra, netStatus,
}: {
  label: string;
  value: number | null;
  yoy: number | null;
  vsLabel?: string;
  vsYoy?: number | null;
  extra?: React.ReactNode;
  netStatus?: Status;
}) {
  const style = netStatus ? STATUS_STYLE[netStatus] : null;

  return (
    <div style={{
      flex: 1, minWidth: 150,
      background: style?.bg ?? '#fff',
      border: `1.5px solid ${style?.border ?? '#e5e7eb'}`,
      borderRadius: 10,
      padding: '16px 18px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: style?.color ?? '#111827', lineHeight: 1, marginBottom: 8 }}>
        {value != null ? value.toLocaleString() : '—'}
        {netStatus && value != null && (
          <span style={{ fontSize: 14, marginLeft: 6 }}>{style?.icon}</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {yoy !== null && (
          <span style={{ fontSize: 12, fontWeight: 600, color: yoy >= 0 ? '#16a34a' : '#dc2626' }}>
            {fmtPct(yoy)} YoY
          </span>
        )}
        {vsYoy !== null && vsYoy !== undefined && vsLabel && (
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {fmtPct(vsYoy)} {vsLabel}
          </span>
        )}
        {extra}
      </div>
    </div>
  );
}

function MobilityCard({ mobilityPct, psMobilityPct, peerMobilityPct, peerLabel }: {
  mobilityPct: number | null;
  psMobilityPct: number | null;
  peerMobilityPct?: number | null;
  peerLabel?: string;
}) {
  return (
    <div style={{
      flex: 1, minWidth: 150,
      background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10,
      padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        Internal Movement
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 8 }}>
        {mobilityPct != null ? `${mobilityPct.toFixed(0)}%` : '—'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {peerMobilityPct != null && peerLabel && (
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {peerLabel}: {peerMobilityPct.toFixed(0)}%
          </span>
        )}
        {psMobilityPct != null && (
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            PSC: {psMobilityPct.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

// ── Comparison table ───────────────────────────────────────────────────────

interface CompRow {
  label: string;
  dept: string;
  peer?: string;
  ps: string;
  deptNum?: number | null;
  psNum?: number | null;
  higherIsBetter?: boolean; // true = higher is green, false = lower is green, undefined = neutral
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
            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#6b7280', fontWeight: 600, fontSize: 11 }}>PSC Total</th>
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

// ── Department autocomplete (shared pattern) ───────────────────────────────

function DeptSelector({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [input, setInput]       = useState('');
  const [open, setOpen]         = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  const { data: departments = [] } = useQuery<string[]>({
    queryKey: ['staffing-departments'],
    queryFn: () => client.get('/staffing/departments').then(r => r.data),
    staleTime: 5 * 60_000,
  });

  const options = useMemo(() => ['All Public Service', ...departments], [departments]);
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

  // Sync display input when value changes externally
  useEffect(() => {
    setInput(value ?? '');
  }, [value]);

  function select(opt: string) {
    const isTotal = opt === 'All Public Service';
    setInput(isTotal ? '' : opt);
    onChange(isTotal ? null : opt);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 420 }}>
      <input
        ref={inputRef}
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true); }}
        onFocus={e => { setOpen(true); e.currentTarget.style.borderColor = '#1d3557'; }}
        onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="All Public Service"
        style={{
          width: '100%', padding: '8px 34px 8px 12px', fontSize: 13,
          border: '1.5px solid #e5e7eb', borderRadius: 8,
          boxSizing: 'border-box', outline: 'none',
          background: '#fafafa', color: '#111827',
          transition: 'border-color 0.15s',
        }}
      />
      {input && (
        <button
          onClick={() => { setInput(''); onChange(null); setOpen(false); }}
          style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#9ca3af', fontSize: 18, padding: 0, lineHeight: 1,
          }}
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
              style={{
                padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: '#374151',
                fontWeight: opt === 'All Public Service' ? 600 : 400,
                borderBottom: '1px solid #f3f4f6',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f8ff')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{opt}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function DeptSnapshot() {
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const isPsTotal = !selectedDept;

  // Primary overview data
  const { data, isLoading } = useQuery<SnapshotData>({
    queryKey: ['dept-snapshot', selectedDept],
    queryFn: () =>
      client.get('/staffing/department-overview', {
        params: selectedDept ? { department: selectedDept } : {},
      }).then(r => r.data),
    staleTime: 60_000,
  });

  // Determine peer size tier from TBS headcount
  const sizeTier = useMemo(() => {
    const hc = data?.tbs_headcount?.count;
    if (!hc || isPsTotal) return null;
    return sizeTierFromHeadcount(hc);
  }, [data, isPsTotal]);

  // Fetch peer-tier data when we know the size
  const { data: peerData } = useQuery<SnapshotData>({
    queryKey: ['dept-snapshot-peer', sizeTier],
    queryFn: () =>
      client.get('/staffing/department-overview', {
        params: { department: sizeTier! },
      }).then(r => r.data),
    enabled: !!sizeTier,
    staleTime: 5 * 60_000,
  });

  // ── Derived metrics ────────────────────────────────────────────────────

  const qCount = data?.q_count ?? 4;

  const hiringVal   = latestVal(data?.kpis.total_inflow.dept ?? []);
  const leavingVal  = latestVal(data?.kpis.separations.dept ?? []);
  const netChange   = hiringVal != null && leavingVal != null ? hiringVal - leavingVal : null;

  const hiringYoy   = yoyPct(data?.kpis.total_inflow.dept  ?? [], qCount);
  const leavingYoy  = yoyPct(data?.kpis.separations.dept   ?? [], qCount);
  const hiringYoyPs = yoyPct(data?.kpis.total_inflow.ps    ?? [], qCount);
  const leavingYoyPs= yoyPct(data?.kpis.separations.ps     ?? [], qCount);

  const mobilityVal  = useMemo(() => {
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

  const mobilityPct   = mobilityVal != null && hiringVal != null && hiringVal > 0 ? (mobilityVal / hiringVal) * 100 : null;
  const mobilityPctPs = mobilityValPs != null && hiringYoyPs != null ? null : (() => {
    const psHiring = latestVal(data?.kpis.total_inflow.ps ?? []);
    if (!mobilityValPs || !psHiring || psHiring === 0) return null;
    return (mobilityValPs / psHiring) * 100;
  })();

  // Peer metrics
  const peerHiringVal  = peerData ? latestVal(peerData.kpis.total_inflow.dept) : null;
  const peerLeavingVal = peerData ? latestVal(peerData.kpis.separations.dept) : null;
  const peerHiringYoy  = peerData ? yoyPct(peerData.kpis.total_inflow.dept, peerData.q_count) : null;
  const peerLeavingYoy = peerData ? yoyPct(peerData.kpis.separations.dept, peerData.q_count) : null;
  const peerMobVal     = peerData ? ((latestVal(peerData.kpis.promotions.dept) ?? 0) + (latestVal(peerData.kpis.acting.dept) ?? 0) + (latestVal(peerData.kpis.lateral.dept) ?? 0)) : null;
  const peerMobPct     = peerMobVal != null && peerHiringVal != null && peerHiringVal > 0 ? (peerMobVal / peerHiringVal) * 100 : null;
  const peerAdvPct     = peerData?.adv_pct.dept ?? null;

  const status  = getStatus(netChange, leavingYoy);
  const insight = buildInsight({
    isPsTotal,
    net: netChange,
    hiringYoy,
    leavingYoy,
    hiringYoyPs,
    leavingYoyPs,
    advPctDept: data?.adv_pct.dept ?? null,
    advPctPs:   data?.adv_pct.ps   ?? null,
  });

  // ── Trend chart data ────────────────────────────────────────────────────

  const flowTrend = useMemo(() => {
    if (!data) return [];
    const map: Record<string, Record<string, unknown>> = {};
    data.workforce_trend.inflow.forEach(r => {
      map[r.fiscal_year] = { fiscal_year: r.fiscal_year, Hiring: r.total };
    });
    data.workforce_trend.outflow.forEach(r => {
      if (!map[r.fiscal_year]) map[r.fiscal_year] = { fiscal_year: r.fiscal_year };
      map[r.fiscal_year].Leaving = r.total;
    });
    return Object.values(map).sort((a, b) =>
      String(a.fiscal_year).localeCompare(String(b.fiscal_year)),
    );
  }, [data]);

  // ── Comparison table rows ───────────────────────────────────────────────

  const compRows: CompRow[] = useMemo(() => {
    if (!data) return [];
    const psHiring = latestVal(data.kpis.total_inflow.ps);
    const psLeaving = latestVal(data.kpis.separations.ps);

    return [
      {
        label: 'Hiring (latest year)',
        dept: fmt(hiringVal),
        peer: fmt(peerHiringVal),
        ps:   fmt(psHiring),
        deptNum: hiringVal,
        psNum: psHiring,
        higherIsBetter: true,
      },
      {
        label: 'Departures (latest year)',
        dept: fmt(leavingVal),
        peer: fmt(peerLeavingVal),
        ps:   fmt(psLeaving),
        deptNum: leavingVal,
        psNum: psLeaving,
        higherIsBetter: false,
      },
      {
        label: 'Hiring YoY',
        dept: fmtPct(hiringYoy),
        peer: fmtPct(peerHiringYoy),
        ps:   fmtPct(hiringYoyPs),
        deptNum: hiringYoy,
        psNum: hiringYoyPs,
        higherIsBetter: true,
      },
      {
        label: 'Departures YoY',
        dept: fmtPct(leavingYoy),
        peer: fmtPct(peerLeavingYoy),
        ps:   fmtPct(leavingYoyPs),
        deptNum: leavingYoy,
        psNum: leavingYoyPs,
        higherIsBetter: false,
      },
      {
        label: 'Mobility rate',
        dept: mobilityPct != null ? `${mobilityPct.toFixed(0)}%` : '—',
        peer: peerMobPct  != null ? `${peerMobPct.toFixed(0)}%` : '—',
        ps:   mobilityPctPs != null ? `${mobilityPctPs.toFixed(0)}%` : '—',
      },
      {
        label: 'Advertised %',
        dept: data.adv_pct.dept != null ? `${data.adv_pct.dept.toFixed(0)}%` : '—',
        peer: peerAdvPct != null ? `${peerAdvPct.toFixed(0)}%` : '—',
        ps:   data.adv_pct.ps  != null ? `${data.adv_pct.ps.toFixed(0)}%` : '—',
        deptNum: data.adv_pct.dept,
        psNum: data.adv_pct.ps,
        higherIsBetter: undefined,
      },
    ];
  }, [data, hiringVal, leavingVal, hiringYoy, leavingYoy, hiringYoyPs, leavingYoyPs, mobilityPct, mobilityPctPs, peerHiringVal, peerLeavingVal, peerHiringYoy, peerLeavingYoy, peerMobPct, peerAdvPct]);

  const displayName = selectedDept ?? 'All Public Service';
  const latestFy    = data?.kpis.total_inflow.dept?.[0]?.fiscal_year;
  const statusStyle = STATUS_STYLE[status];

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
          Department Snapshot
        </h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#6b7280' }}>
          What's happening in this department?
        </p>
        <DeptSelector value={selectedDept} onChange={setSelectedDept} />
      </div>

      {isLoading && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
          Loading…
        </div>
      )}

      {data && (
        <>
          {/* Status badge + period */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 12px', borderRadius: 999,
              background: statusStyle.bg, border: `1px solid ${statusStyle.border}`,
              fontSize: 12.5, fontWeight: 700, color: statusStyle.color,
            }}>
              {statusStyle.icon} {status} workforce
            </span>
            {latestFy && (
              <span style={{ fontSize: 12, color: '#9ca3af' }}>
                {latestFy}{qCount < 4 ? ` FYTD Q${qCount}` : ''}
              </span>
            )}
            {sizeTier && (
              <span style={{ fontSize: 11.5, color: '#6b7280', background: '#f1f5f9', borderRadius: 4, padding: '3px 8px' }}>
                {sizeTierLabel(sizeTier)} organization
              </span>
            )}
          </div>

          {/* Auto-insight */}
          {insight.length > 0 && (
            <div style={{
              background: '#f8fafc', border: '1px solid #e2e8f0',
              borderLeft: '4px solid #1d3557',
              borderRadius: 6, padding: '12px 16px',
              marginBottom: 20, maxWidth: 700,
            }}>
              {insight.map((s, i) => (
                <p key={i} style={{ margin: i === 0 ? 0 : '6px 0 0', fontSize: 13.5, color: '#374151', lineHeight: 1.5 }}>
                  {s}
                </p>
              ))}
            </div>
          )}

          {/* 4 KPI cards */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            <KpiCard
              label="Hiring"
              value={hiringVal}
              yoy={hiringYoy}
              vsLabel="PSC"
              vsYoy={hiringYoyPs}
              extra={
                data.adv_pct.dept != null ? (
                  <span style={{ fontSize: 11, color: '#6b7280' }}>
                    {data.adv_pct.dept.toFixed(0)}% advertised
                    {!isPsTotal && data.adv_pct.ps != null && (
                      <span style={{ color: '#9ca3af' }}> (PSC: {data.adv_pct.ps.toFixed(0)}%)</span>
                    )}
                  </span>
                ) : undefined
              }
            />
            <KpiCard
              label="Leaving"
              value={leavingVal}
              yoy={leavingYoy}
              vsLabel="PSC"
              vsYoy={leavingYoyPs}
            />
            <KpiCard
              label="Net Change"
              value={netChange}
              yoy={null}
              netStatus={status}
            />
            <MobilityCard
              mobilityPct={mobilityPct}
              psMobilityPct={mobilityPctPs}
              peerMobilityPct={peerMobPct}
              peerLabel={sizeTier ? sizeTierLabel(sizeTier) : undefined}
            />
          </div>

          {/* Primary chart */}
          <div style={{
            border: '1px solid #dee2e6', borderRadius: 8,
            padding: '16px 20px', background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            marginBottom: 20,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
              {displayName} — Hiring vs Leaving
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
              Total inflow and outflow over time
            </div>
            <ResponsiveContainer width="100%" height={260}>
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

          {/* Comparison table */}
          <div style={{
            border: '1px solid #dee2e6', borderRadius: 8,
            padding: '16px 20px', background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          }}>
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
