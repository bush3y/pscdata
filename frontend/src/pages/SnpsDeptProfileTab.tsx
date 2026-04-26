import { useState, useMemo, useSyncExternalStore } from 'react';
import {
  ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
  BarChart, Bar, ReferenceLine, Cell,
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

// ── Negative-direction themes (lower % = worse experience, so lower = better) ─

const NEGATIVE_THEMES = new Set(['Biases and barriers']);

// Returns the "effective" delta where positive always means "dept is better than benchmark".
// For negative themes, dept having a lower % is better, so we flip the sign.
function effectiveDelta(deptPct: number, benchPct: number, themeE: string): number {
  return NEGATIVE_THEMES.has(themeE) ? benchPct - deptPct : deptPct - benchPct;
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
  const isNeg = NEGATIVE_THEMES.has(d.theme_e);
  const effDelta = d.dept_pct != null && d.ps_pct != null
    ? Math.round(effectiveDelta(d.dept_pct, d.ps_pct, d.theme_e)) : null;
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
      padding: '9px 13px', fontSize: 12, maxWidth: 280,
      boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
    }}>
      <div style={{ fontWeight: 600, color: '#111827', marginBottom: 4, lineHeight: 1.4 }}>
        {d.question_e.replace(/^[A-Z0-9_]+ --? /, '')}
      </div>
      {isNeg && (
        <div style={{ fontSize: 10, color: '#b45309', marginBottom: 4, fontStyle: 'italic' }}>
          ↓ lower = better for this theme
        </div>
      )}
      <div style={{ color: '#374151' }}>{dept}: <strong>{d.dept_pct}%</strong></div>
      <div style={{ color: '#6b7280' }}>PS Total: {d.ps_pct}%</div>
      {effDelta != null && (
        <div style={{ color: effDelta >= 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>
          {effDelta >= 0 ? `+${effDelta}` : effDelta} pts vs PS {isNeg ? '(inverted)' : ''}
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

// ── Sub-question grouping ─────────────────────────────────────────────────────

// Codes with 3 parts and an integer last segment are sub-questions.
// e.g. HMN_04_1 → base HMN_04;  YRS_01 (2 parts) → standalone.
function getSubBase(code: string): string | null {
  const parts = code.split('_');
  if (parts.length === 3 && /^\d+$/.test(parts[2])) return `${parts[0]}_${parts[1]}`;
  return null;
}

type QuestionItem =
  | { type: 'question'; row: SnpsDeptProfileRow }
  | { type: 'group'; base: string; label: string; rows: SnpsDeptProfileRow[]; avgDept: number | null; vsPs: number | null };

function buildQuestionItems(rows: SnpsDeptProfileRow[], theme: string): QuestionItem[] {
  const groups = new Map<string, SnpsDeptProfileRow[]>();
  const standalone: SnpsDeptProfileRow[] = [];
  for (const row of rows) {
    const base = getSubBase(row.question);
    if (base) {
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base)!.push(row);
    } else {
      standalone.push(row);
    }
  }
  const items: QuestionItem[] = [];
  for (const row of standalone) items.push({ type: 'question', row });
  for (const [base, subRows] of groups) {
    if (subRows.length === 1) {
      items.push({ type: 'question', row: subRows[0] });
    } else {
      const deptVals = subRows.map(r => r.dept_pct).filter((v): v is number => v != null);
      const psVals   = subRows.map(r => r.ps_pct).filter((v): v is number => v != null);
      const avgDept  = deptVals.length ? Math.round(deptVals.reduce((a, b) => a + b, 0) / deptVals.length) : null;
      const avgPs    = psVals.length   ? Math.round(psVals.reduce((a, b) => a + b, 0) / psVals.length)   : null;
      const label = subRows[0].question_e.replace(/^[A-Z0-9_]+ --? /, '');
      const vsPs = avgDept != null && avgPs != null
        ? (NEGATIVE_THEMES.has(theme) ? avgPs - avgDept : avgDept - avgPs)
        : null;
      items.push({ type: 'group', base, label, rows: subRows, avgDept, vsPs });
    }
  }
  items.sort((a, b) => {
    const qa = a.type === 'question' ? a.row.question : a.base;
    const qb = b.type === 'question' ? b.row.question : b.base;
    return qa.localeCompare(qb);
  });
  return items;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SnpsDeptProfileTab({ dept, onDeptChange, years }: Props) {
  const isMobile = useIsMobile();
  const maxYear = years.length ? Math.max(...years) : null;
  const [profileYear, setProfileYear] = useState<number | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'scatter' | 'bar'>('scatter');
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const effectiveYear = profileYear ?? maxYear;

  function toggleTheme(theme: string) {
    setExpandedThemes(prev => {
      const next = new Set(prev);
      next.has(theme) ? next.delete(theme) : next.add(theme);
      return next;
    });
  }
  function toggleGroup(base: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(base) ? next.delete(base) : next.add(base);
      return next;
    });
  }

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
    themes.map(t => {
      const isNeg = NEGATIVE_THEMES.has(t);
      return {
        theme: t,
        color: themeColor(themes, t),
        points: data
          .filter(r => r.theme_e === t && r.dept_pct != null && r.ps_pct != null)
          .map(r => ({
            ...r,
            x: isNeg ? 100 - r.ps_pct! : r.ps_pct!,
            y: isNeg ? 100 - r.dept_pct! : r.dept_pct!,
          })),
      };
    }),
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
      const isNeg = NEGATIVE_THEMES.has(t);
      const rows = data.filter(r => r.theme_e === t);
      const deptVals = rows.map(r => r.dept_pct).filter((v): v is number => v != null);
      const psVals   = rows.map(r => r.ps_pct).filter((v): v is number => v != null);
      const peerVals = rows.map(r => r.peer_avg_pct).filter((v): v is number => v != null);
      const deptAvg  = deptVals.length ? Math.round(deptVals.reduce((a, b) => a + b, 0) / deptVals.length) : null;
      const psAvg    = psVals.length   ? Math.round(psVals.reduce((a, b) => a + b, 0) / psVals.length)     : null;
      const peerAvg  = peerVals.length ? Math.round(peerVals.reduce((a, b) => a + b, 0) / peerVals.length) : null;
      const prevAvg  = prevThemeAvg.get(t) ?? null;
      // For negative themes, positive effective delta = dept lower = better outcome
      const rawYoy   = deptAvg != null && prevAvg != null ? deptAvg - prevAvg : null;
      return {
        theme: t,
        isNeg,
        color: themeColor(themes, t),
        deptAvg,
        vsPs:    deptAvg != null && psAvg   != null ? (isNeg ? psAvg - deptAvg   : deptAvg - psAvg)   : null,
        vsPeers: deptAvg != null && peerAvg != null ? (isNeg ? peerAvg - deptAvg : deptAvg - peerAvg) : null,
        yoyDelta: rawYoy != null ? (isNeg ? -rawYoy : rawYoy) : null,
        count: rows.length,
      };
    }).sort((a, b) => (b.deptAvg ?? 0) - (a.deptAvg ?? 0));
  }, [themes, data, prevThemeAvg]);

  const questionItemsByTheme = useMemo(() => {
    const map = new Map<string, QuestionItem[]>();
    for (const t of themes) {
      map.set(t, buildQuestionItems(data.filter(r => r.theme_e === t), t));
    }
    return map;
  }, [themes, data]);

  // Outlier detection — top 3 above and bottom 3 below the parity line by effective delta
  const outlierCodes = useMemo(() => {
    const scored = data
      .filter(r => r.dept_pct != null && r.ps_pct != null)
      .map(r => ({ question: r.question, delta: effectiveDelta(r.dept_pct!, r.ps_pct!, r.theme_e) }))
      .sort((a, b) => b.delta - a.delta);
    const top = scored.slice(0, 3);
    const bot = scored.slice(-3);
    return new Set([...top, ...bot].map(r => r.question));
  }, [data]);

  // Bar chart data — sorted by effectiveDelta; scoped to selectedTheme when one is active
  const barData = useMemo(() => {
    const source = selectedTheme ? data.filter(r => r.theme_e === selectedTheme) : data;
    return source
      .filter(r => r.dept_pct != null && r.ps_pct != null)
      .map(r => ({
        label: r.question_e.replace(/^[A-Z0-9_]+ --? /, '').slice(0, 35),
        delta: Math.round(effectiveDelta(r.dept_pct!, r.ps_pct!, r.theme_e)),
        color: themeColor(themes, r.theme_e),
        question_e: r.question_e,
        theme_e: r.theme_e,
        dept_pct: r.dept_pct,
        ps_pct: r.ps_pct,
        question: r.question,
      }))
      .sort((a, b) => b.delta - a.delta);
  }, [data, selectedTheme, themes]);

  // Dynamic takeaway — theme-specific when theme selected, otherwise overall summary
  const takeaway = useMemo(() => {
    const scorableRows = data.filter(r => r.dept_pct != null && r.ps_pct != null);
    if (scorableRows.length === 0) return null;
    if (selectedTheme) {
      const themeRows = scorableRows.filter(r => r.theme_e === selectedTheme);
      if (themeRows.length === 0) return null;
      const above = themeRows.filter(r => effectiveDelta(r.dept_pct!, r.ps_pct!, r.theme_e) > 0).length;
      const deptAvg = Math.round(themeRows.reduce((s, r) => s + r.dept_pct!, 0) / themeRows.length);
      const psAvg   = Math.round(themeRows.reduce((s, r) => s + r.ps_pct!, 0) / themeRows.length);
      return `${selectedTheme} — ${above} of ${themeRows.length} questions above PS · dept avg ${deptAvg}% vs PS ${psAvg}%`;
    }
    const total = scorableRows.length;
    const above = scorableRows.filter(r => effectiveDelta(r.dept_pct!, r.ps_pct!, r.theme_e) > 0).length;
    return `${above} of ${total} questions track above the PS average. Select a theme to explore further.`;
  }, [data, selectedTheme]);

  // Theme summary stats when a theme is isolated (biggest strength + gap)
  const themeQuickStats = useMemo(() => {
    if (!selectedTheme) return null;
    const rows = data.filter(r => r.theme_e === selectedTheme && r.dept_pct != null && r.ps_pct != null);
    if (rows.length === 0) return null;
    const scored = rows.map(r => ({
      label: r.question_e.replace(/^[A-Z0-9_]+ --? /, '').slice(0, 40),
      delta: Math.round(effectiveDelta(r.dept_pct!, r.ps_pct!, r.theme_e)),
    })).sort((a, b) => b.delta - a.delta);
    const deptVals = rows.map(r => r.dept_pct!);
    const psVals   = rows.map(r => r.ps_pct!);
    const deptAvg  = Math.round(deptVals.reduce((a, b) => a + b, 0) / deptVals.length);
    const psAvg    = Math.round(psVals.reduce((a, b) => a + b, 0) / psVals.length);
    const vsPs     = NEGATIVE_THEMES.has(selectedTheme) ? psAvg - deptAvg : deptAvg - psAvg;
    const above    = rows.filter(r => effectiveDelta(r.dept_pct!, r.ps_pct!, r.theme_e) > 0).length;
    const best     = scored[0].delta !== 0 ? scored[0] : null;
    const worst    = scored[scored.length - 1].delta !== 0 ? scored[scored.length - 1] : null;
    return { deptAvg, vsPs, above, total: rows.length, best, worst };
  }, [data, selectedTheme]);

  // Headline stats
  const scorable = data.filter(r => r.dept_pct != null && r.ps_pct != null);
  const abovePS  = scorable.filter(r => effectiveDelta(r.dept_pct!, r.ps_pct!, r.theme_e) > 0).length;
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

          {/* Scatter / Bar chart card */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '14px 16px' : '16px 20px', background: '#fff' }}>

            {/* Card header row: title + Scatter/Bar toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', letterSpacing: '-0.01em' }}>
                Dept vs PS Total — by question
              </div>
              <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                {(['scatter', 'bar'] as const).map((m, i) => (
                  <button key={m} onClick={() => setViewMode(m)} style={{
                    fontSize: 11, padding: '3px 10px', border: 'none', cursor: 'pointer',
                    borderLeft: i > 0 ? '1px solid #e5e7eb' : 'none',
                    background: viewMode === m ? '#1d3557' : '#fff',
                    color: viewMode === m ? '#fff' : '#6b7280',
                  }}>
                    {m === 'scatter' ? 'Scatter' : 'Bar'}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic takeaway line */}
            {takeaway && (
              <div style={{ fontSize: 12, color: '#374151', marginBottom: 6, lineHeight: 1.5 }}>
                {takeaway}
              </div>
            )}

            {/* Chart subtitle */}
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 16 }}>
              {viewMode === 'scatter'
                ? <>Each dot is one survey question. Above the dashed line = dept performs better than PS Total. Color = theme. <span style={{ color: '#b45309' }}>Biases and barriers scores are inverted so that above the line always means better.</span></>
                : <>Each bar shows the dept vs PS gap per question (positive = dept better). Biases and barriers deltas are inverted. {selectedTheme ? `Showing ${barData.length} questions in ${selectedTheme}.` : `Showing all ${barData.length} questions.`}</>
              }
            </div>

            {/* Scatter chart */}
            {viewMode === 'scatter' && (
              <ResponsiveContainer width="100%" height={isMobile ? 300 : 440}>
                <ComposedChart margin={{ top: 8, right: 24, bottom: 44, left: 44 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    label={{ value: 'Public Service (%)', position: 'insideBottom', offset: -28, fontSize: 11, fill: '#6b7280' }}
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                  />
                  <YAxis
                    dataKey="y"
                    type="number"
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    label={{ value: 'Department (%)', angle: -90, position: 'insideLeft', offset: 16, fontSize: 11, fill: '#6b7280' }}
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                  />
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
                  {[...scatterByTheme].sort((a, b) =>
                    a.theme === selectedTheme ? 1 : b.theme === selectedTheme ? -1 : 0
                  ).map(({ theme, color, points }) => {
                    const muted = selectedTheme !== null && selectedTheme !== theme;
                    return (
                      <Scatter
                        key={theme}
                        name={theme}
                        data={points}
                        fill={color}
                        isAnimationActive={false}
                        shape={(props: { cx?: number; cy?: number; question?: string }) => {
                          const { cx = 0, cy = 0, question } = props;
                          const r = isMobile ? 4 : 6;
                          const isOutlier = !muted && !!question && outlierCodes.has(question);
                          return (
                            <g>
                              <circle
                                cx={cx} cy={cy} r={r}
                                fill={muted ? '#e5e7eb' : color}
                                opacity={muted ? 0.4 : 0.85}
                                stroke={muted ? '#d1d5db' : '#fff'}
                                strokeWidth={1.5}
                              />
                              {isOutlier && (
                                <circle
                                  cx={cx} cy={cy} r={r + 5}
                                  fill="none"
                                  stroke={color}
                                  strokeWidth={1.5}
                                  opacity={0.6}
                                />
                              )}
                            </g>
                          );
                        }}
                      />
                    );
                  })}
                  <Tooltip content={(props: any) => <ProfileTooltip {...props} dept={deptLabel} />} />
                </ComposedChart>
              </ResponsiveContainer>
            )}

            {/* Bar chart — sorted delta view */}
            {viewMode === 'bar' && (
              <ResponsiveContainer width="100%" height={Math.max(300, barData.length * 24)}>
                <BarChart
                  data={barData}
                  layout="vertical"
                  margin={{ top: 4, right: 32, bottom: 8, left: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis
                    type="number"
                    tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}`}
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    label={{ value: 'Dept vs PS (pts)', position: 'insideBottom', offset: -4, fontSize: 11, fill: '#6b7280' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={190}
                    tick={{ fontSize: 10, fill: '#374151' }}
                    tickLine={false}
                  />
                  <ReferenceLine x={0} stroke="#d1d5db" strokeWidth={1.5} strokeDasharray="4 2" />
                  <Bar dataKey="delta" isAnimationActive={false} radius={[0, 2, 2, 0]}>
                    {barData.map((entry, i) => (
                      <Cell key={i} fill={entry.delta >= 0 ? entry.color : `${entry.color}99`} />
                    ))}
                  </Bar>
                  <Tooltip content={(props: any) => {
                    if (!props.active || !props.payload?.length) return null;
                    const d = props.payload[0].payload;
                    const isNeg = NEGATIVE_THEMES.has(d.theme_e);
                    return (
                      <div style={{
                        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
                        padding: '9px 13px', fontSize: 12, maxWidth: 280,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
                      }}>
                        <div style={{ fontWeight: 600, color: '#111827', marginBottom: 4, lineHeight: 1.4 }}>
                          {d.question_e.replace(/^[A-Z0-9_]+ --? /, '')}
                        </div>
                        {isNeg && <div style={{ fontSize: 10, color: '#b45309', marginBottom: 4, fontStyle: 'italic' }}>↓ lower = better for this theme</div>}
                        <div style={{ color: '#374151' }}>{deptLabel}: <strong>{d.dept_pct}%</strong></div>
                        <div style={{ color: '#6b7280' }}>PS Total: {d.ps_pct}%</div>
                        <div style={{ color: d.delta >= 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>
                          {d.delta >= 0 ? `+${d.delta}` : d.delta} pts vs PS
                        </div>
                        <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 4 }}>{d.theme_e}</div>
                      </div>
                    );
                  }} />
                </BarChart>
              </ResponsiveContainer>
            )}

            {/* Interaction hint */}
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 10, marginBottom: 4, fontStyle: 'italic' }}>
              Select a theme in the legend to isolate it · click again to reset
            </div>

            {/* Theme legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {themes.map(t => {
                const active = selectedTheme === t;
                const dimmed = selectedTheme !== null && !active;
                return (
                  <button
                    key={t}
                    onClick={() => { setSelectedTheme(active ? null : t); setViewMode('scatter'); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      fontSize: 11, cursor: 'pointer',
                      padding: '3px 8px', borderRadius: 99,
                      border: active ? `1px solid ${themeColor(themes, t)}` : '1px solid transparent',
                      background: active ? `${themeColor(themes, t)}18` : 'none',
                      color: dimmed ? '#9ca3af' : '#374151',
                      opacity: dimmed ? 0.6 : 1,
                      transition: 'opacity 0.15s, color 0.15s',
                    }}
                  >
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: dimmed ? '#d1d5db' : themeColor(themes, t),
                      flexShrink: 0, display: 'inline-block',
                      transition: 'background 0.15s',
                    }} />
                    {t}
                  </button>
                );
              })}
              {selectedTheme && (
                <button
                  onClick={() => { setSelectedTheme(null); setViewMode('scatter'); }}
                  style={{
                    fontSize: 11, cursor: 'pointer', padding: '3px 8px',
                    borderRadius: 99, border: '1px solid #e5e7eb',
                    background: 'none', color: '#6b7280',
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Theme quick-stats panel — shown when a theme is isolated */}
            {themeQuickStats && selectedTheme && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8,
                padding: '10px 14px', background: '#f9fafb',
                borderRadius: 6, border: '1px solid #f3f4f6', marginTop: 12,
              }}>
                <div style={{ fontSize: 11, color: '#374151' }}>
                  Dept avg <strong>{themeQuickStats.deptAvg}%</strong>
                </div>
                <div style={{ fontSize: 11, color: themeQuickStats.vsPs >= 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>
                  vs PS {themeQuickStats.vsPs >= 0 ? `+${themeQuickStats.vsPs}` : themeQuickStats.vsPs} pts
                </div>
                <div style={{ fontSize: 11, color: '#374151' }}>
                  <strong>{themeQuickStats.above}</strong> / {themeQuickStats.total} questions above PS
                </div>
                {themeQuickStats.best && (
                  <div style={{ fontSize: 11, color: '#15803d' }}>
                    Biggest strength: {themeQuickStats.best.label}… (<strong>+{themeQuickStats.best.delta} pts</strong>)
                  </div>
                )}
                {themeQuickStats.worst && themeQuickStats.worst.delta < 0 && (
                  <div style={{ fontSize: 11, color: '#dc2626' }}>
                    Largest gap: {themeQuickStats.worst.label}… (<strong>{themeQuickStats.worst.delta} pts</strong>)
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Theme summary table — expandable to questions and sub-question groups */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '14px 16px' : '16px 20px', background: '#fff' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4, letterSpacing: '-0.01em' }}>
              By theme
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
              Click a theme to expand individual questions.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left',  padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>Theme / Question</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>Dept</th>
                    <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>vs PS</th>
                    {hasPeers && <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>vs Peers</th>}
                    {prevYear  && <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>vs {prevYear}</th>}
                    <th style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}># Qs</th>
                  </tr>
                </thead>
                <tbody>
                  {themeSummaryRows.map(r => {
                    const isExpanded = expandedThemes.has(r.theme);
                    const items = questionItemsByTheme.get(r.theme) ?? [];
                    return (
                      <>
                        {/* Theme row */}
                        <tr
                          key={r.theme}
                          onClick={() => toggleTheme(r.theme)}
                          style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer', background: isExpanded ? '#fafafa' : '#fff' }}
                          onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = '#f9fafb'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isExpanded ? '#fafafa' : '#fff'; }}
                        >
                          <td style={{ padding: '7px 10px', fontWeight: 600 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 9, color: '#9ca3af', width: 10, flexShrink: 0 }}>
                                {isExpanded ? '▼' : '▶'}
                              </span>
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
                              color: r.yoyDelta == null ? '#9ca3af' : r.yoyDelta > 0 ? '#15803d' : r.yoyDelta < 0 ? '#dc2626' : '#6b7280' }}>
                              {r.yoyDelta != null ? `${r.yoyDelta > 0 ? '↑' : r.yoyDelta < 0 ? '↓' : '—'}${Math.abs(r.yoyDelta)}` : '—'}
                            </td>
                          )}
                          <td style={{ textAlign: 'right', padding: '7px 10px', color: '#6b7280' }}>{r.count}</td>
                        </tr>

                        {/* Expanded: question items */}
                        {isExpanded && items.map(item => {
                          if (item.type === 'question') {
                            const row = item.row;
                            const delta = row.dept_pct != null && row.ps_pct != null
                              ? effectiveDelta(row.dept_pct, row.ps_pct, row.theme_e) : null;
                            return (
                              <tr key={row.question} style={{ borderBottom: '1px solid #f9fafb', background: '#fafafa' }}>
                                <td style={{ padding: '5px 10px 5px 28px', fontSize: 11, color: '#374151', lineHeight: 1.4 }}>
                                  <span style={{ color: '#9ca3af', marginRight: 6, fontSize: 10 }}>{row.question}</span>
                                  {row.question_e.replace(/^[A-Z0-9_]+ --? /, '')}
                                </td>
                                <td style={{ textAlign: 'right', padding: '5px 10px', fontWeight: 600, fontSize: 11, color: '#374151' }}>
                                  {row.dept_pct != null ? `${row.dept_pct}%` : '—'}
                                </td>
                                <td style={{ textAlign: 'right', padding: '5px 10px', fontSize: 11,
                                  color: delta == null ? '#9ca3af' : delta >= 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>
                                  {delta != null ? (delta >= 0 ? `+${delta}` : `${delta}`) : '—'}
                                </td>
                                {hasPeers  && <td style={{ textAlign: 'right', padding: '5px 10px', fontSize: 11, color: '#9ca3af' }}>—</td>}
                                {prevYear  && <td style={{ textAlign: 'right', padding: '5px 10px', fontSize: 11, color: '#9ca3af' }}>—</td>}
                                <td />
                              </tr>
                            );
                          }

                          // Sub-question group row
                          const grp = item;
                          const grpExpanded = expandedGroups.has(grp.base);
                          const grpDelta = grp.vsPs;
                          return (
                            <>
                              <tr
                                key={grp.base}
                                onClick={() => toggleGroup(grp.base)}
                                style={{ borderBottom: '1px solid #f9fafb', background: '#fafafa', cursor: 'pointer' }}
                              >
                                <td style={{ padding: '5px 10px 5px 28px', fontSize: 11, color: '#374151', lineHeight: 1.4 }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 8, color: '#9ca3af', width: 10, flexShrink: 0 }}>
                                      {grpExpanded ? '▼' : '▶'}
                                    </span>
                                    <span style={{ color: '#9ca3af', marginRight: 4, fontSize: 10 }}>{grp.base}</span>
                                    <span style={{ fontStyle: 'italic' }}>{grp.label}</span>
                                    <span style={{ color: '#9ca3af', fontSize: 10 }}>({grp.rows.length} items)</span>
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right', padding: '5px 10px', fontWeight: 600, fontSize: 11, color: '#374151' }}>
                                  {grp.avgDept != null ? `${grp.avgDept}%` : '—'}
                                </td>
                                <td style={{ textAlign: 'right', padding: '5px 10px', fontSize: 11,
                                  color: grpDelta == null ? '#9ca3af' : grpDelta >= 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>
                                  {grpDelta != null ? (grpDelta >= 0 ? `+${grpDelta}` : `${grpDelta}`) : '—'}
                                </td>
                                {hasPeers && <td style={{ textAlign: 'right', padding: '5px 10px', fontSize: 11, color: '#9ca3af' }}>—</td>}
                                {prevYear  && <td style={{ textAlign: 'right', padding: '5px 10px', fontSize: 11, color: '#9ca3af' }}>—</td>}
                                <td style={{ textAlign: 'right', padding: '5px 10px', fontSize: 11, color: '#9ca3af' }}>{grp.rows.length}</td>
                              </tr>

                              {/* Expanded sub-questions */}
                              {grpExpanded && grp.rows.map(subRow => {
                                const subDelta = subRow.dept_pct != null && subRow.ps_pct != null
                                  ? effectiveDelta(subRow.dept_pct, subRow.ps_pct, subRow.theme_e) : null;
                                return (
                                  <tr key={subRow.question} style={{ borderBottom: '1px solid #f9fafb', background: '#f5f6f8' }}>
                                    <td style={{ padding: '4px 10px 4px 48px', fontSize: 10.5, color: '#6b7280', lineHeight: 1.4 }}>
                                      <span style={{ color: '#d1d5db', marginRight: 6, fontSize: 9 }}>{subRow.question}</span>
                                      {subRow.question_e.replace(/^[A-Z0-9_]+ --? /, '')}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '4px 10px', fontSize: 10.5, fontWeight: 600, color: '#374151' }}>
                                      {subRow.dept_pct != null ? `${subRow.dept_pct}%` : '—'}
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '4px 10px', fontSize: 10.5,
                                      color: subDelta == null ? '#9ca3af' : subDelta >= 0 ? '#15803d' : '#dc2626', fontWeight: 600 }}>
                                      {subDelta != null ? (subDelta >= 0 ? `+${subDelta}` : `${subDelta}`) : '—'}
                                    </td>
                                    {hasPeers && <td style={{ textAlign: 'right', padding: '4px 10px', fontSize: 10.5, color: '#d1d5db' }}>—</td>}
                                    {prevYear  && <td style={{ textAlign: 'right', padding: '4px 10px', fontSize: 10.5, color: '#d1d5db' }}>—</td>}
                                    <td />
                                  </tr>
                                );
                              })}
                            </>
                          );
                        })}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footnotes */}
          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
            Positive response = To a great extent + To a moderate extent (or Yes / Selected).
            {' '}Scatter shows {scorable.length} scored questions — demographic distribution questions excluded.
            <span style={{ display: 'block', marginTop: 4 }}>
              * Biases and barriers questions measure incidence of negative experiences (lower % = better). Scores are inverted on the chart and in the vs PS / vs Peers / trend columns so that positive values always mean the department is doing better.
            </span>
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
