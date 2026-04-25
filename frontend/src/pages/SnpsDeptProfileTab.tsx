import { useState, useMemo, useSyncExternalStore } from 'react';
import {
  ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  PS_TOTAL,
  useSnpsDepartments,
  useSnpsDeptProfile,
  type SnpsDeptProfileRow,
} from '../api/snps';

// ── Responsive hook ──────────────────────────────────────────────────────────

function useIsMobile(breakpoint = 768) {
  return useSyncExternalStore(
    cb => { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb); },
    () => window.innerWidth < breakpoint,
    () => false,
  );
}

// ── Theme colors ─────────────────────────────────────────────────────────────

const THEME_PALETTE = [
  '#1d3557', '#c2410c', '#0f766e', '#7c3aed', '#b45309',
  '#0369a1', '#be123c', '#15803d', '#6b21a8', '#0e7490', '#92400e', '#374151',
];

function themeColor(sortedThemes: string[], theme: string): string {
  return THEME_PALETTE[sortedThemes.indexOf(theme) % THEME_PALETTE.length];
}

// ── Dept selector ─────────────────────────────────────────────────────────────

function DeptSelector({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data: departments = [] } = useSnpsDepartments();
  return (
    <select
      value={value ?? PS_TOTAL}
      onChange={e => onChange(e.target.value === PS_TOTAL ? null : e.target.value)}
      style={{
        fontSize: 13, padding: '5px 8px', borderRadius: 5,
        border: '1px solid #e5e7eb', background: '#fff', color: '#111827',
        width: '100%', maxWidth: 320,
      }}
    >
      <option value={PS_TOTAL}>{PS_TOTAL}</option>
      {departments.map(d => <option key={d} value={d}>{d}</option>)}
    </select>
  );
}

// ── Parity line data (0,0)→(100,100) ─────────────────────────────────────────

const PARITY_LINE = [{ x: 0, y: 0 }, { x: 100, y: 100 }];

// ── Scatter tooltip ───────────────────────────────────────────────────────────

function ProfileTooltip({ active, payload, dept }: {
  active?: boolean;
  payload?: Array<{ payload: SnpsDeptProfileRow & { x: number; y: number } }>;
  dept: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const delta = d.dept_pct != null && d.ps_pct != null
    ? Math.round(d.dept_pct - d.ps_pct) : null;
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
      padding: '9px 13px', fontSize: 12, maxWidth: 280,
      boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
    }}>
      <div style={{ fontWeight: 600, color: '#111827', marginBottom: 4, lineHeight: 1.4 }}>
        {d.question_e.replace(/^[A-Z0-9_]+ --? /, '')}
      </div>
      <div style={{ color: '#374151' }}>{dept}: <strong>{d.dept_pct}%</strong></div>
      <div style={{ color: '#6b7280' }}>PS Total: {d.ps_pct}%</div>
      {delta != null && (
        <div style={{ color: delta >= 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>
          {delta >= 0 ? `+${delta}` : delta} pts vs PS
        </div>
      )}
      {d.peer_avg_pct != null && (
        <div style={{ color: '#6b7280' }}>Peer avg: {d.peer_avg_pct}%</div>
      )}
      <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 4 }}>
        {d.question} · {d.theme_e}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  dept: string | null;
  onDeptChange: (dept: string | null) => void;
  years: number[];
}

export default function SnpsDeptProfileTab({ dept, onDeptChange, years }: Props) {
  const isMobile = useIsMobile();
  const maxYear = years.length ? Math.max(...years) : null;
  const [profileYear, setProfileYear] = useState<number | null>(null);
  const effectiveYear = profileYear ?? maxYear;

  // Current year profile
  const { data: data = [], isLoading } = useSnpsDeptProfile(dept, effectiveYear);

  // Previous year for YoY delta
  const prevYear = useMemo(() => {
    if (!effectiveYear) return null;
    const idx = years.indexOf(effectiveYear);
    return idx > 0 ? years[idx - 1] : null;
  }, [years, effectiveYear]);
  const { data: prevData = [] } = useSnpsDeptProfile(dept, prevYear);

  // Derived structures
  const themes = useMemo(() =>
    [...new Set(data.map(r => r.theme_e))].sort(),
    [data]
  );

  const scatterByTheme = useMemo(() =>
    themes.map(t => ({
      theme: t,
      color: themeColor(themes, t),
      points: data
        .filter(r => r.theme_e === t && r.dept_pct != null && r.ps_pct != null)
        .map(r => ({ ...r, x: r.ps_pct!, y: r.dept_pct! })),
    })),
    [data, themes]
  );

  const prevThemeAvg = useMemo(() => {
    const map = new Map<string, number>();
    const byTheme = new Map<string, number[]>();
    for (const r of prevData) {
      if (r.dept_pct != null) {
        if (!byTheme.has(r.theme_e)) byTheme.set(r.theme_e, []);
        byTheme.get(r.theme_e)!.push(r.dept_pct);
      }
    }
    for (const [t, vals] of byTheme) {
      map.set(t, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
    }
    return map;
  }, [prevData]);

  const themeSummaryRows = useMemo(() => {
    return themes.map(t => {
      const rows = data.filter(r => r.theme_e === t);
      const deptVals = rows.map(r => r.dept_pct).filter((v): v is number => v != null);
      const psVals   = rows.map(r => r.ps_pct).filter((v): v is number => v != null);
      const peerVals = rows.map(r => r.peer_avg_pct).filter((v): v is number => v != null);
      const deptAvg  = deptVals.length ? Math.round(deptVals.reduce((a, b) => a + b, 0) / deptVals.length) : null;
      const psAvg    = psVals.length   ? Math.round(psVals.reduce((a, b) => a + b, 0) / psVals.length)     : null;
      const peerAvg  = peerVals.length ? Math.round(peerVals.reduce((a, b) => a + b, 0) / peerVals.length) : null;
      const prevAvg  = prevThemeAvg.get(t) ?? null;
      const yoyDelta = deptAvg != null && prevAvg != null ? deptAvg - prevAvg : null;
      return {
        theme: t,
        color: themeColor(themes, t),
        deptAvg,
        vsPs:    deptAvg != null && psAvg  != null ? deptAvg - psAvg   : null,
        vsPeers: deptAvg != null && peerAvg != null ? deptAvg - peerAvg : null,
        yoyDelta,
        count: rows.length,
      };
    }).sort((a, b) => (b.deptAvg ?? 0) - (a.deptAvg ?? 0));
  }, [themes, data, prevThemeAvg]);

  // Headline stats
  const scorable = data.filter(r => r.dept_pct != null && r.ps_pct != null);
  const abovePS  = scorable.filter(r => r.dept_pct! > r.ps_pct!).length;
  const tierLabel  = data[0]?.tier_label ?? null;
  const peerCount  = data[0]?.peer_count ?? 0;
  const hasPeers   = tierLabel != null && peerCount > 0;
  const totalDepts = data[0]?.total_depts ?? 0;
  const deptLabel  = dept ?? PS_TOTAL;

  return (
    <div>
      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Department
          </div>
          <DeptSelector value={dept} onChange={onDeptChange} />
        </div>
        {years.length > 1 && (
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Survey year
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {years.map(y => (
                <button
                  key={y}
                  onClick={() => setProfileYear(y === effectiveYear ? null : y)}
                  style={{
                    padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                    border: '1px solid',
                    borderColor: effectiveYear === y ? '#1d3557' : '#e5e7eb',
                    background:  effectiveYear === y ? '#1d3557' : '#fff',
                    color:       effectiveYear === y ? '#fff' : '#6b7280',
                  }}
                >{y}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Empty / loading states */}
      {!dept && (
        <div style={{
          border: '1px solid #e5e7eb', borderRadius: 8, padding: '48px 32px',
          textAlign: 'center', color: '#6b7280', fontSize: 13, background: '#fafafa',
        }}>
          Select a department above to view its survey profile.
          <br />
          <span style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
            PS Total is the benchmark — select a specific department to compare against it.
          </span>
        </div>
      )}

      {dept && isLoading && (
        <div style={{ padding: '32px 0', color: '#6b7280', fontSize: 13 }}>Loading profile…</div>
      )}

      {dept && !isLoading && data.length === 0 && (
        <div style={{
          border: '1px solid #e5e7eb', borderRadius: 8, padding: '32px 24px',
          textAlign: 'center', color: '#6b7280', fontSize: 13, background: '#fafafa',
        }}>
          No data found for {deptLabel} in {effectiveYear}.
        </div>
      )}

      {dept && !isLoading && data.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Headline */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '14px 16px' : '16px 20px', background: '#fff' }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#111827', lineHeight: 1.4, marginBottom: 4 }}>
              {deptLabel} scores above PS average on{' '}
              <span style={{ color: abovePS >= scorable.length / 2 ? '#15803d' : '#dc2626' }}>
                {abovePS} of {scorable.length}
              </span>{' '}
              questions ({effectiveYear})
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {tierLabel
                ? <span>{tierLabel} department</span>
                : <span style={{ fontStyle: 'italic' }}>Size tier unknown</span>}
              {hasPeers && <span>· Peer group: {peerCount} departments</span>}
              {totalDepts > 0 && <span>· {totalDepts} departments with data</span>}
              {prevYear && <span>· Compared to {prevYear} for trend</span>}
            </div>
          </div>

          {/* Scatter chart card */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '14px 16px' : '16px 20px', background: '#fff' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4, letterSpacing: '-0.01em' }}>
              Dept vs PS Total — by question
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 16 }}>
              Each dot is one survey question. Above the dashed line = dept scores higher than PS Total. Color = theme.
            </div>

            <ResponsiveContainer width="100%" height={isMobile ? 300 : 440}>
              <ComposedChart margin={{ top: 8, right: 24, bottom: 44, left: 44 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  label={{ value: 'PS Total positive %', position: 'insideBottom', offset: -28, fontSize: 11, fill: '#6b7280' }}
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                />
                <YAxis
                  dataKey="y"
                  type="number"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  label={{ value: `${deptLabel} positive %`, angle: -90, position: 'insideLeft', offset: 16, fontSize: 11, fill: '#6b7280' }}
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                />
                {/* Parity line: dept = PS */}
                <Line
                  data={PARITY_LINE}
                  dataKey="y"
                  dot={false}
                  activeDot={false}
                  stroke="#d1d5db"
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  isAnimationActive={false}
                  legendType="none"
                />
                {/* One Scatter per theme for independent fill */}
                {scatterByTheme.map(({ theme, color, points }) => (
                  <Scatter
                    key={theme}
                    name={theme}
                    data={points}
                    fill={color}
                    isAnimationActive={false}
                    shape={(props: { cx?: number; cy?: number }) => {
                      const { cx = 0, cy = 0 } = props;
                      return (
                        <circle
                          cx={cx} cy={cy}
                          r={isMobile ? 4 : 6}
                          fill={color} opacity={0.75}
                          stroke="#fff" strokeWidth={1.5}
                        />
                      );
                    }}
                  />
                ))}
                <Tooltip content={(props: any) => <ProfileTooltip {...props} dept={deptLabel} />} />
              </ComposedChart>
            </ResponsiveContainer>

            {/* Theme legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              {themes.map(t => (
                <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#374151' }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: themeColor(themes, t), flexShrink: 0, display: 'inline-block',
                  }} />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Theme summary table */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '14px 16px' : '16px 20px', background: '#fff' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 12, letterSpacing: '-0.01em' }}>
              By theme
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left',  padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>Theme</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>Dept avg</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>vs PS</th>
                    {hasPeers && <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>vs Peers</th>}
                    {prevYear  && <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>vs {prevYear}</th>}
                    <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}># Qs</th>
                  </tr>
                </thead>
                <tbody>
                  {themeSummaryRows.map(r => (
                    <tr key={r.theme} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '7px 10px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: r.color, flexShrink: 0, display: 'inline-block',
                          }} />
                          {r.theme}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', fontWeight: 700, color: '#111827' }}>
                        {r.deptAvg != null ? `${r.deptAvg}%` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '7px 10px', fontWeight: 600,
                        color: r.vsPs == null ? '#9ca3af' : r.vsPs >= 0 ? '#15803d' : '#dc2626' }}>
                        {r.vsPs != null ? (r.vsPs >= 0 ? `+${r.vsPs}` : `${r.vsPs}`) : '—'}
                      </td>
                      {hasPeers && (
                        <td style={{ textAlign: 'right', padding: '7px 10px', fontWeight: 600,
                          color: r.vsPeers == null ? '#9ca3af' : r.vsPeers >= 0 ? '#15803d' : '#dc2626' }}>
                          {r.vsPeers != null ? (r.vsPeers >= 0 ? `+${r.vsPeers}` : `${r.vsPeers}`) : '—'}
                        </td>
                      )}
                      {prevYear && (
                        <td style={{ textAlign: 'right', padding: '7px 10px',
                          color: r.yoyDelta == null ? '#9ca3af'
                            : r.yoyDelta > 0 ? '#15803d'
                            : r.yoyDelta < 0 ? '#dc2626' : '#6b7280' }}>
                          {r.yoyDelta != null
                            ? `${r.yoyDelta > 0 ? '↑' : r.yoyDelta < 0 ? '↓' : '—'}${Math.abs(r.yoyDelta)}`
                            : '—'}
                        </td>
                      )}
                      <td style={{ textAlign: 'right', padding: '7px 10px', color: '#6b7280' }}>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footnotes */}
          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
            Positive response = To a great extent + To a moderate extent (or Yes / Selected).
            {' '}Scatter shows {scorable.length} scored questions — demographic distribution questions excluded.
            {!tierLabel && (
              <span style={{ display: 'block', marginTop: 4, fontStyle: 'italic' }}>
                Peer comparison unavailable — {deptLabel} was not matched to TBS population data.
              </span>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
