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

interface EeRow { ee_group_e: string; fiscal_year: string; count: number | null }

interface PeerBenchmark {
  label: string;
  peer_label: string;
  peer_count: number;
  hiring: number | null;
  hiring_yoy: number | null;
  separations: number | null;
  separations_yoy: number | null;
  mobility_rate: number | null;
  adv_pct: number | null;
}

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
  inflow_by_type:  { fiscal_year: string; hire_e: string; count: number | null }[];
  mobility_trend:  { fiscal_year: string; mob_type_e: string; count: number | null }[];
  adv_by_type:     { fiscal_year: string; adv_e: string; count: number | null }[];
  ee_snapshot:     { dept: EeRow[]; ps: EeRow[] };
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
  else if (hiringUp && leavingDown && (() => {
    const a = Math.abs(p.hiringYoy!), b = Math.abs(p.leavingYoy!);
    return Math.min(a, b) / Math.max(a, b) >= 0.5;
  })())
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

// ── Tooltip icon ────────────────────────────────────────────────────────────

function TooltipIcon({ text }: { text: string }) {
  return (
    <span
      title={text}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 14, height: 14, borderRadius: '50%',
        border: '1px solid #d1d5db', color: '#9ca3af',
        fontSize: 9, fontWeight: 700, cursor: 'help',
        marginLeft: 4, flexShrink: 0, verticalAlign: 'middle',
      }}
    >i</span>
  );
}

// ── KPI card ────────────────────────────────────────────────────────────────

function KpiRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
      <span style={{ fontSize: 11.5, color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: color ?? '#374151' }}>{value}</span>
    </div>
  );
}

function KpiCard({ label, value, yoy, psYoy, extra, highlight }: {
  label: string;
  value: number | null;
  yoy: number | null;
  psYoy?: number | null;
  extra?: React.ReactNode;
  highlight?: boolean;
}) {
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
      <div style={{ fontSize: highlight ? 32 : 26, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 12 }}>
        {value != null ? value.toLocaleString() : '—'}
      </div>
      {(yoy != null || psYoy != null) && (
        <div style={{ marginBottom: extra ? 10 : 0 }}>
          {yoy != null && (
            <KpiRow
              label="This year"
              value={`${yoy >= 0 ? '↑' : '↓'} ${Math.abs(yoy).toFixed(1)}%`}
              color={yoy >= 0 ? '#16a34a' : '#dc2626'}
            />
          )}
          {psYoy != null && (
            <KpiRow
              label="PS average"
              value={`${psYoy >= 0 ? '↑' : '↓'} ${Math.abs(psYoy).toFixed(1)}%`}
              color="#9ca3af"
            />
          )}
        </div>
      )}
      {extra && (
        <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 10 }}>
          {extra}
        </div>
      )}
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
  tooltip?: string;
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
              <td style={{ padding: '9px 12px', color: '#374151' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {row.label}
                  {row.tooltip && <TooltipIcon text={row.tooltip} />}
                </span>
              </td>
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

// ── Context module card shell ────────────────────────────────────────────────

function ModuleCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '18px 20px', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: subtitle ? 2 : 12 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11.5, color: '#6b7280', marginBottom: 14 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

// ── Module 1: Hiring activity pipeline ──────────────────────────────────────

function HiringPipelineModule({ adv_by_type, isPsTotal, advPctPs }: {
  adv_by_type: { fiscal_year: string; adv_e: string; count: number | null }[];
  isPsTotal: boolean;
  advPctPs: number | null;
}) {
  const years = useMemo(() => {
    const map: Record<string, { total: number; advertised: number }> = {};
    for (const r of adv_by_type) {
      if (!map[r.fiscal_year]) map[r.fiscal_year] = { total: 0, advertised: 0 };
      map[r.fiscal_year].total += r.count ?? 0;
      if (r.adv_e === 'Advertised Process') map[r.fiscal_year].advertised += r.count ?? 0;
    }
    return Object.entries(map)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 3)
      .map(([fy, v]) => ({ fy, ...v, pct: v.total > 0 ? (v.advertised / v.total) * 100 : null }));
  }, [adv_by_type]);

  if (!years.length) return null;

  const latest = years[0];
  const prior  = years[1];
  const advYoy = latest.pct != null && prior?.pct != null ? latest.pct - prior.pct : null;

  return (
    <ModuleCard title="Advertised appointment rate" subtitle="Share of indeterminate appointments made through an open, advertised competitive process">
      <div style={{ fontSize: 28, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 8 }}>
        {latest.pct != null ? `${latest.pct.toFixed(0)}%` : '—'}
        <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280', marginLeft: 6 }}>advertised · {latest.fy}</span>
      </div>
      <div style={{ height: 6, background: '#f3f4f6', borderRadius: 99, marginBottom: 14 }}>
        <div style={{ height: 6, width: `${Math.min(latest.pct ?? 0, 100)}%`, background: '#1d3557', borderRadius: 99, transition: 'width 0.4s' }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <KpiRow label="Advertised appointments" value={latest.advertised.toLocaleString()} />
        <KpiRow label="Total appointments" value={latest.total.toLocaleString()} color="#9ca3af" />
        {advYoy != null && (
          <KpiRow
            label="Change vs prior year"
            value={`${advYoy > 0 ? '↑' : advYoy < 0 ? '↓' : '→'} ${Math.abs(advYoy).toFixed(1)} pts`}
            color={Math.abs(advYoy) < 2 ? '#9ca3af' : advYoy > 0 ? '#15803d' : '#dc2626'}
          />
        )}
        {!isPsTotal && advPctPs != null && (
          <KpiRow label="PS average" value={`${advPctPs.toFixed(0)}%`} color="#9ca3af" />
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
            <th style={{ textAlign: 'left', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>Year</th>
            <th style={{ textAlign: 'right', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>Total</th>
            <th style={{ textAlign: 'right', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>Advertised</th>
            <th style={{ textAlign: 'right', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>% advertised</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y, i) => (
            <tr key={y.fy} style={{ background: i % 2 === 1 ? '#f9fafb' : 'transparent' }}>
              <td style={{ padding: '5px 0', color: '#374151' }}>{y.fy}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', color: '#6b7280' }}>{y.total.toLocaleString()}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', color: '#374151', fontWeight: i === 0 ? 600 : 400 }}>{y.advertised.toLocaleString()}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', color: '#374151', fontWeight: i === 0 ? 600 : 400 }}>{y.pct != null ? `${y.pct.toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ModuleCard>
  );
}

// ── Module 2: EE self-identification rate ────────────────────────────────────

function eeRate(rows: EeRow[], fy: string): number | null {
  const ee  = rows.find(r => r.fiscal_year === fy && r.ee_group_e === 'Self-identified as EE')?.count ?? null;
  const non = rows.find(r => r.fiscal_year === fy && r.ee_group_e === 'Did not self-identify as EE')?.count ?? null;
  if (ee == null || non == null) return null;
  const total = ee + non;
  return total > 0 ? (ee / total) * 100 : null;
}

function EERepresentationModule({ ee_snapshot, isPsTotal }: {
  ee_snapshot: { dept: EeRow[]; ps: EeRow[] };
  isPsTotal: boolean;
}) {
  const { dept, ps } = ee_snapshot;
  if (!dept.length) return null;

  const fyList = [...new Set(dept.map(r => r.fiscal_year))].sort().reverse();
  if (!fyList.length) return null;

  const years = fyList.slice(0, 3).map(fy => ({
    fy,
    rate:   eeRate(dept, fy),
    ratePs: eeRate(ps, fy),
  }));

  const latest = years[0];
  const prior  = years[1];
  const yoy = latest.rate != null && prior?.rate != null ? latest.rate - prior.rate : null;

  const gap = latest.rate != null && latest.ratePs != null ? latest.rate - latest.ratePs : null;
  const insightText = (() => {
    if (isPsTotal || gap == null) return null;
    const dir = gap > 1 ? 'above' : gap < -1 ? 'below' : 'in line with';
    const trend = yoy == null ? '' : yoy > 0.5 ? ' trending upward' : yoy < -0.5 ? ' trending downward' : ' holding steady';
    return `EE self-identification in this department is ${dir} the PS average (${latest.rate?.toFixed(1)}% vs ${latest.ratePs?.toFixed(1)}%)${trend}.`;
  })();

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '20px 24px', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Employment equity in hiring</div>
          <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>Share of new hires who self-identified as EE · ~1 year data lag</div>
        </div>
        {/* Prior years */}
        {(years[1]?.rate != null || years[2]?.rate != null) && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {years[2]?.rate != null && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: '#9ca3af' }}>{years[2].rate.toFixed(1)}%</div>
                <div style={{ fontSize: 10, color: '#d1d5db' }}>{years[2].fy}</div>
              </div>
            )}
            {years[1]?.rate != null && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{years[1].rate.toFixed(1)}%</div>
                <div style={{ fontSize: 10, color: '#9ca3af' }}>{years[1].fy}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main stats row */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, marginBottom: 20 }}>
        {/* Dept rate */}
        <div style={{ paddingRight: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: '#111827', lineHeight: 1 }}>
            {latest.rate != null ? `${latest.rate.toFixed(1)}%` : '—'}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{latest.fy}</div>
          {yoy != null && (
            <div style={{ fontSize: 12, fontWeight: 600, color: Math.abs(yoy) < 0.5 ? '#9ca3af' : yoy > 0 ? '#15803d' : '#dc2626', marginTop: 4 }}>
              {yoy > 0 ? '↑' : yoy < 0 ? '↓' : '→'} {Math.abs(yoy).toFixed(1)} pts vs prior year
            </div>
          )}
        </div>
        {/* PS average — separated by border-left */}
        {!isPsTotal && latest.ratePs != null && (
          <div style={{ paddingLeft: 20, borderLeft: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 22, fontWeight: 600, color: '#6b7280', lineHeight: 1 }}>
              {latest.ratePs.toFixed(1)}%
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>PS average</div>
          </div>
        )}
      </div>

      {/* Comparison bars — dept vs PS */}
      {!isPsTotal && latest.ratePs != null && latest.rate != null && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: '#374151' }}>This department</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{latest.rate.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, background: '#f3f4f6', borderRadius: 99 }}>
              <div style={{ height: 8, width: `${Math.min(latest.rate, 100)}%`, background: '#1d3557', borderRadius: 99 }} />
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>PS average</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>{latest.ratePs.toFixed(1)}%</span>
            </div>
            <div style={{ height: 8, background: '#f3f4f6', borderRadius: 99 }}>
              <div style={{ height: 8, width: `${Math.min(latest.ratePs, 100)}%`, background: '#9ca3af', borderRadius: 99 }} />
            </div>
          </div>
        </div>
      )}

      {/* Amber insight callout */}
      {insightText && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
          {insightText}
        </div>
      )}
    </div>
  );
}

// ── Module 3: Internal mobility detail ──────────────────────────────────────

const CROSS_ORG_HIRE_TYPES = new Set([
  'Indeterminate from other organization',
  'Term from other organization',
]);

function MobilityDetailModule({ mobility_trend, inflow_by_type }: {
  mobility_trend: { fiscal_year: string; mob_type_e: string; count: number | null }[];
  inflow_by_type: { fiscal_year: string; hire_e: string; count: number | null }[];
}) {
  const MOB_TYPE_LABEL: Record<string, string> = {
    'Acting':              'Acting (>4 months)',
    'Promotion':           'Promotions',
    'Lateral or downward': 'Lateral / other',
  };

  const years = useMemo(() => {
    const fys = [...new Set(mobility_trend.map(r => r.fiscal_year))].sort().reverse().slice(0, 3);
    return fys.map(fy => {
      const byType = mobility_trend.filter(r => r.fiscal_year === fy);
      const mobTotal = byType.reduce((s, r) => s + (r.count ?? 0), 0);

      const inflowTotal = inflow_by_type
        .filter(r => r.fiscal_year === fy)
        .reduce((s, r) => s + (r.count ?? 0), 0);

      const internalTransfers = inflow_by_type
        .filter(r => r.fiscal_year === fy && CROSS_ORG_HIRE_TYPES.has(r.hire_e))
        .reduce((s, r) => s + (r.count ?? 0), 0);

      const breakdown = Object.entries(MOB_TYPE_LABEL).map(([key, label]) => {
        const count = byType.find(r => r.mob_type_e === key)?.count ?? 0;
        return { label, count, pct: mobTotal > 0 ? (count / mobTotal) * 100 : null };
      });

      return {
        fy,
        mobTotal,
        breakdown,
        mobRate: inflowTotal > 0 ? (mobTotal / inflowTotal) * 100 : null,
        internalPct: inflowTotal > 0 ? (internalTransfers / inflowTotal) * 100 : null,
      };
    });
  }, [mobility_trend, inflow_by_type]);

  if (!years.length) return null;

  const latest = years[0];
  const prior  = years[1];
  const mobYoy = latest.mobRate != null && prior?.mobRate != null ? latest.mobRate - prior.mobRate : null;

  return (
    <ModuleCard title="Internal movement rate" subtitle="Acting, promotions, and lateral moves as a share of total appointments">
      <div style={{ fontSize: 24, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 8 }}>
        {latest.mobRate != null ? `${latest.mobRate.toFixed(0)}%` : '—'}
        <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280', marginLeft: 6 }}>mobility rate · {latest.fy}</span>
      </div>
      <div style={{ height: 6, background: '#f3f4f6', borderRadius: 99, marginBottom: 12 }}>
        <div style={{ height: 6, width: `${Math.min(latest.mobRate ?? 0, 100)}%`, background: '#457b9d', borderRadius: 99, transition: 'width 0.4s' }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <KpiRow label="Total mobility actions" value={latest.mobTotal.toLocaleString()} />
        {latest.internalPct != null && (
          <KpiRow label="From other departments" value={`${latest.internalPct.toFixed(0)}% of hiring`} color="#6b7280" />
        )}
        {mobYoy != null && (
          <KpiRow
            label="Change vs prior year"
            value={`${mobYoy > 0 ? '↑' : mobYoy < 0 ? '↓' : '→'} ${Math.abs(mobYoy).toFixed(1)} pts`}
            color={Math.abs(mobYoy) < 1 ? '#9ca3af' : mobYoy > 0 ? '#15803d' : '#dc2626'}
          />
        )}
      </div>

      {/* Breakdown by move type */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
            <th style={{ textAlign: 'left', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>Action type</th>
            <th style={{ textAlign: 'right', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>Count</th>
            <th style={{ textAlign: 'right', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>% of moves</th>
          </tr>
        </thead>
        <tbody>
          {latest.breakdown.map((row, i) => (
            <tr key={row.label} style={{ background: i % 2 === 1 ? '#f9fafb' : 'transparent' }}>
              <td style={{ padding: '5px 0', color: '#374151' }}>{row.label}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', color: '#6b7280' }}>{row.count.toLocaleString()}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 600, color: '#374151' }}>{row.pct != null ? `${row.pct.toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
            <th style={{ textAlign: 'left', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>Year</th>
            <th style={{ textAlign: 'right', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>Actions</th>
            <th style={{ textAlign: 'right', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>Mobility rate</th>
            <th style={{ textAlign: 'right', padding: '4px 0', color: '#9ca3af', fontWeight: 600 }}>From other depts</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y, i) => (
            <tr key={y.fy} style={{ background: i % 2 === 1 ? '#f9fafb' : 'transparent' }}>
              <td style={{ padding: '5px 0', color: '#374151' }}>{y.fy}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', color: '#6b7280' }}>{y.mobTotal.toLocaleString()}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', color: '#374151', fontWeight: i === 0 ? 600 : 400 }}>{y.mobRate != null ? `${y.mobRate.toFixed(0)}%` : '—'}</td>
              <td style={{ padding: '5px 0', textAlign: 'right', color: '#374151', fontWeight: i === 0 ? 600 : 400 }}>{y.internalPct != null ? `${y.internalPct.toFixed(0)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ModuleCard>
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

  const { data: peerBenchmark } = useQuery<PeerBenchmark | null>({
    queryKey: ['dept-peer-benchmark', selectedDept],
    queryFn: () =>
      client.get('/staffing/peer-benchmark', { params: { department: selectedDept! } })
        .then(r => r.data),
    enabled: !isPsTotal && !!selectedDept,
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

  const psHiringVal   = latestVal(data?.kpis.total_inflow.ps ?? []);
  const mobilityPct   = mobilityVal != null && hiringVal   != null && hiringVal   > 0 ? (mobilityVal   / hiringVal)   * 100 : null;
  const mobilityPctPs = mobilityValPs != null && psHiringVal != null && psHiringVal > 0 ? (mobilityValPs / psHiringVal) * 100 : null;

  const advDiff = data?.adv_pct.dept != null && data?.adv_pct.ps != null
    ? data.adv_pct.dept - data.adv_pct.ps
    : null;

  // Status label
  const status = leavingYoy != null && leavingYoy > 20 ? 'Departures rising'
    : netChange === null ? 'Stable'
    : netChange > 0 ? 'Net inflow'
    : netChange < 0 ? 'Net outflow'
    : 'Stable';

  // Opinionated headline
  const headline = data ? getHeadline({
    net: netChange,
    hiringYoy,
    leavingYoy,
    advPctDept: data.adv_pct.dept,
    advPctPs: data.adv_pct.ps,
  }) : null;

  // Flow trend chart data
  const flowTrend = useMemo(() => {
    if (!data) return [];
    const map: Record<string, Record<string, unknown>> = {};
    data.workforce_trend.inflow.forEach(r => { map[r.fiscal_year] = { fiscal_year: r.fiscal_year, Hiring: r.total }; });
    data.workforce_trend.outflow.forEach(r => {
      if (!map[r.fiscal_year]) map[r.fiscal_year] = { fiscal_year: r.fiscal_year };
      map[r.fiscal_year].Departures = r.total;
    });
    return Object.values(map).sort((a, b) => String(a.fiscal_year).localeCompare(String(b.fiscal_year)));
  }, [data]);

  const compRows: CompRow[] = useMemo(() => {
    if (!data) return [];
    const psHiring  = latestVal(data.kpis.total_inflow.ps);
    const psLeaving = latestVal(data.kpis.separations.ps);
    const pb = peerBenchmark ?? null;
    return [
      {
        label: 'Hiring (latest year)',
        dept: fmt(hiringVal),
        peer: pb ? fmt(pb.hiring) : undefined,
        ps:   fmt(psHiring),
        deptNum: hiringVal, psNum: psHiring, higherIsBetter: true,
      },
      {
        label: 'Departures (latest year)',
        dept: fmt(leavingVal),
        peer: pb ? fmt(pb.separations) : undefined,
        ps:   fmt(psLeaving),
        deptNum: leavingVal, psNum: psLeaving, higherIsBetter: false,
      },
      {
        label: 'Hiring YoY',
        dept: fmtPct(hiringYoy),
        peer: pb ? fmtPct(pb.hiring_yoy) : undefined,
        ps:   fmtPct(hiringYoyPs),
        deptNum: hiringYoy, psNum: hiringYoyPs, higherIsBetter: true,
      },
      {
        label: 'Departures YoY',
        dept: fmtPct(leavingYoy),
        peer: pb ? fmtPct(pb.separations_yoy) : undefined,
        ps:   fmtPct(leavingYoyPs),
        deptNum: leavingYoy, psNum: leavingYoyPs, higherIsBetter: false,
      },
      {
        label: 'Internal movement rate',
        tooltip: 'Acting, promotions, and lateral/downward moves as a percentage of total appointments',
        dept: mobilityPct   != null ? `${mobilityPct.toFixed(0)}%`           : '—',
        peer: pb ? (pb.mobility_rate != null ? `${pb.mobility_rate.toFixed(0)}%` : '—') : undefined,
        ps:   mobilityPctPs != null ? `${mobilityPctPs.toFixed(0)}%`         : '—',
      },
      {
        label: 'Advertised appointment %',
        tooltip: 'Percentage of indeterminate appointments made through an advertised competitive process',
        dept: data.adv_pct.dept != null ? `${data.adv_pct.dept.toFixed(0)}%` : '—',
        peer: pb ? (pb.adv_pct != null ? `${pb.adv_pct.toFixed(0)}%` : '—') : undefined,
        ps:   data.adv_pct.ps  != null ? `${data.adv_pct.ps.toFixed(0)}%`   : '—',
        deptNum: data.adv_pct.dept, psNum: data.adv_pct.ps, higherIsBetter: undefined,
      },
    ];
  }, [data, isPsTotal, peerBenchmark, hiringVal, leavingVal, hiringYoy, leavingYoy,
      hiringYoyPs, leavingYoyPs, mobilityPct, mobilityPctPs]);

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
                color: status === 'Net inflow' ? '#15803d' : status === 'Departures rising' ? '#b45309' : status === 'Net outflow' ? '#dc2626' : '#475569',
                textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {status}
              </span>
              {latestFy && (
                <span style={{ fontSize: 11.5, color: '#9ca3af' }}>
                  · {latestFy}{qCount < 4 ? ` FYTD Q${qCount}` : ''}
                </span>
              )}
              {peerBenchmark && !isPsTotal && (
                <span style={{ fontSize: 11, color: '#6b7280', background: '#f1f5f9', borderRadius: 4, padding: '2px 7px' }}>
                  {peerBenchmark.peer_label} · {peerBenchmark.peer_count} depts
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
            {qCount < 4 && latestFy && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>
                Data reflects Q{qCount} year-to-date figures for {latestFy}.
              </p>
            )}
          </div>

          {/* ── 4 KPI cards ─────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>

            {/* Hiring */}
            <KpiCard
              label="Hiring"
              value={hiringVal}
              yoy={hiringYoy}
              psYoy={!isPsTotal ? hiringYoyPs : undefined}
              highlight
            />

            {/* Departures */}
            <KpiCard
              label="Departures"
              value={leavingVal}
              yoy={leavingYoy}
              psYoy={!isPsTotal ? leavingYoyPs : undefined}
            />

            {/* Net Change */}
            <NetCard net={netChange} status={status} />

            {/* Internal Movement */}
            <div style={{ flex: 1, minWidth: 150, background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, display: 'flex', alignItems: 'center' }}>
                Internal Movement
                <TooltipIcon text="Acting, promotions, and lateral/downward moves as a percentage of total appointments" />
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 12 }}>
                {mobilityPct != null ? `${mobilityPct.toFixed(0)}%` : mobilityVal != null ? mobilityVal.toLocaleString() : '—'}
              </div>
              <div>
                {mobilityVal != null && (
                  <KpiRow label="Total actions" value={mobilityVal.toLocaleString()} />
                )}
                {!isPsTotal && mobilityPctPs != null && (
                  <KpiRow label="PS average" value={`${mobilityPctPs.toFixed(0)}%`} color="#9ca3af" />
                )}
              </div>
            </div>
          </div>

          {/* ── Hiring vs Departures — single chart ─────────────────────────── */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '20px 24px', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 2 }}>Hiring vs departures over time</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>All available years · {displayName}</div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={flowTrend} margin={{ top: 5, right: 20, left: 10, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
                <XAxis dataKey="fiscal_year" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Hiring"     stroke="#1d3557" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="Departures" stroke="#e63946" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
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
              peerLabel={peerBenchmark?.peer_label}
            />
            <p style={{ fontSize: 11, color: '#9ca3af', margin: '10px 0 0' }}>
              YoY comparisons are FYTD-normalized when current year is partial.
              {peerBenchmark && ` Peer avg across ${peerBenchmark.peer_count} ${peerBenchmark.label} org departments.`}
            </p>
          </div>

          {/* ── PSC oversight indicators ──────────────────────────────────── */}
          <div style={{ margin: '32px 0 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>PSC oversight indicators</span>
            <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
            <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic', whiteSpace: 'nowrap' }}>Appointment integrity &amp; employment equity</span>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <HiringPipelineModule
              adv_by_type={data.adv_by_type ?? []}
              isPsTotal={isPsTotal}
              advPctPs={data.adv_pct.ps}
            />
            <MobilityDetailModule mobility_trend={data.mobility_trend ?? []} inflow_by_type={data.inflow_by_type ?? []} />
          </div>

          {data.ee_snapshot?.dept?.length > 0 && (
            <EERepresentationModule ee_snapshot={data.ee_snapshot} isPsTotal={isPsTotal} />
          )}
        </>
      )}
    </div>
  );
}
