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

function buildQuestionItems(rows: SnpsDeptProfileRow[]): QuestionItem[] {
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
      // Parent question text: first sub-question's text with prefix stripped
      const label = subRows[0].question_e.replace(/^[A-Z0-9_]+ --? /, '');
      items.push({ type: 'group', base, label, rows: subRows, avgDept, vsPs: avgDept != null && avgPs != null ? avgDept - avgPs : null });
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

  const questionItemsByTheme = useMemo(() => {
    const map = new Map<string, QuestionItem[]>();
    for (const t of themes) {
      map.set(t, buildQuestionItems(data.filter(r => r.theme_e === t)));
    }
    return map;
  }, [themes, data]);

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
                {/* One Scatter per theme — selected theme rendered last so it sits on top */}
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
                      shape={(props: { cx?: number; cy?: number }) => {
                        const { cx = 0, cy = 0 } = props;
                        return (
                          <circle
                            cx={cx} cy={cy}
                            r={isMobile ? 4 : 6}
                            fill={muted ? '#e5e7eb' : color}
                            opacity={muted ? 0.4 : 0.85}
                            stroke={muted ? '#d1d5db' : '#fff'}
                            strokeWidth={1.5}
                          />
                        );
                      }}
                    />
                  );
                })}
                <Tooltip content={(props: any) => <ProfileTooltip {...props} dept={deptLabel} />} />
              </ComposedChart>
            </ResponsiveContainer>

            {/* Theme legend — click to isolate, click again to clear */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {themes.map(t => {
                const active = selectedTheme === t;
                const dimmed = selectedTheme !== null && !active;
                return (
                  <button
                    key={t}
                    onClick={() => setSelectedTheme(active ? null : t)}
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
                  onClick={() => setSelectedTheme(null)}
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
                            const delta = row.dept_pct != null && row.ps_pct != null ? row.dept_pct - row.ps_pct : null;
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
                                const subDelta = subRow.dept_pct != null && subRow.ps_pct != null ? subRow.dept_pct - subRow.ps_pct : null;
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
