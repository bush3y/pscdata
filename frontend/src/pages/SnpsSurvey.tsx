import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import {
  PS_TOTAL,
  useSnpsYears,
  useSnpsDepartments,
  useSnpsQuestions,
  useSnpsTrend,
  useSnpsDeptScores,
  type SnpsQuestion,
  type SnpsResponseRow,
} from '../api/snps';

// ── Responsive hook ──────────────────────────────────────────────────────────

function useIsMobile(breakpoint = 768) {
  return useSyncExternalStore(
    cb => { window.addEventListener('resize', cb); return () => window.removeEventListener('resize', cb); },
    () => window.innerWidth < breakpoint,
    () => false,
  );
}

// ── Constants ────────────────────────────────────────────────────────────────

const LIKERT_ORDER = [
  'To a great extent',
  'To a moderate extent',
  'To a minimal extent',
  'Not at all',
];


const POSITIVE_KEYS = new Set(['To a great extent', 'To a moderate extent', 'Yes', 'Selected']);

const RESPONDENT_PREFIX: Record<string, string> = {
  GEN: 'All employees',
  HMN: 'Hiring managers',
  MAN: 'Managers',
  ADV: 'Staffing advisors',
  STA: 'Staffing advisors',
};

type QuestionType = 'likert' | 'yesno' | 'categorical';

function respondentGroup(question: string): string {
  const prefix = question.split('_')[0].toUpperCase();
  return RESPONDENT_PREFIX[prefix] ?? 'All employees';
}

function detectType(vals: string[]): QuestionType {
  if (LIKERT_ORDER.filter(v => vals.includes(v)).length >= 3) return 'likert';
  if (vals.includes('Yes') || vals.includes('No')) return 'yesno';
  if (vals.includes('Selected') || vals.includes('Not selected')) return 'yesno';
  return 'categorical';
}

function sortedValues(rows: SnpsResponseRow[]): string[] {
  const vals = [...new Set(rows.map(r => r.question_value_e))];
  const likertSorted = LIKERT_ORDER.filter(v => vals.includes(v));
  if (likertSorted.length === vals.length) return likertSorted;
  if (vals.includes('Yes') && vals.includes('No')) return ['Yes', 'No', ...vals.filter(v => v !== 'Yes' && v !== 'No')];
  if (vals.includes('Selected') && vals.includes('Not selected')) return ['Selected', 'Not selected', ...vals.filter(v => v !== 'Selected' && v !== 'Not selected')];
  return vals.sort();
}


function posScore(rows: SnpsResponseRow[]): number {
  return Math.round(rows.filter(r => POSITIVE_KEYS.has(r.question_value_e)).reduce((s, r) => s + r.shr_w_resp * 100, 0));
}

// ── Dept autocomplete ────────────────────────────────────────────────────────

function DeptSelector({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLUListElement>(null);

  const { data: departments = [] } = useSnpsDepartments();
  const options  = useMemo(() => [PS_TOTAL, ...departments], [departments]);
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

  useEffect(() => { setInput(value && value !== PS_TOTAL ? value : ''); }, [value]);

  function select(opt: string) {
    const isTotal = opt === PS_TOTAL;
    setInput(isTotal ? '' : opt);
    onChange(isTotal ? null : opt);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
      <input
        ref={inputRef}
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setInput(value && value !== PS_TOTAL ? value : '')}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="Federal Public Service (all)"
        style={{
          width: '100%', padding: '8px 32px 8px 12px', fontSize: 13,
          border: '1.5px solid #e5e7eb', borderRadius: 6,
          boxSizing: 'border-box', outline: 'none',
          background: '#fafafa', color: '#111827',
        }}
      />
      {input && (
        <button
          onClick={() => { setInput(''); onChange(null); setOpen(false); }}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 18, padding: 0 }}
        >×</button>
      )}
      {open && filtered.length > 0 && (
        <ul ref={listRef} style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          margin: 0, padding: '4px 0', listStyle: 'none',
          background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 6,
          zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.slice(0, 80).map(opt => (
            <li
              key={opt}
              onMouseDown={() => select(opt)}
              style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', color: '#374151', fontWeight: opt === PS_TOTAL ? 600 : 400 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f8ff')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{opt}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Dumbbell chart ────────────────────────────────────────────────────────────

const COLOR_A = '#6b7280'; // PS Total or earlier year
const COLOR_B = '#c2410c'; // selected dept or latest year  (orange, like NYT)

const TRACK_BUFFER = 28; // px reserved on each side for label overflow

function DumbbellRow({
  label, pctA, pctB, colorA, colorB, isPositive, labelWidth,
}: {
  label: string; pctA: number; pctB: number;
  colorA: string; colorB: string; isPositive: boolean; labelWidth: number;
}) {
  const minPct = Math.min(pctA, pctB);
  const maxPct = Math.max(pctA, pctB);
  const gap    = maxPct - minPct;

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 5 }}>
      {/* Category label — wraps naturally, no truncation */}
      <div style={{
        width: labelWidth, flexShrink: 0, textAlign: 'right', paddingRight: 10,
        fontSize: 10.5, color: isPositive ? '#374151' : '#6b7280',
        fontWeight: isPositive ? 600 : 400, lineHeight: 1.35,
      }}>
        {label}
      </div>

      {/* Outer: takes flex space, visible overflow so labels can bleed into buffers */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'visible' }}>
        {/* Inner track: inset TRACK_BUFFER px each side — labels overflow into those margins */}
        <div style={{ margin: `0 ${TRACK_BUFFER}px`, position: 'relative', height: 28, overflow: 'visible' }}>
          {/* Dotted guide line */}
          <div style={{
            position: 'absolute', top: '50%', left: 0, right: 0,
            borderTop: '1px dashed #e5e7eb', transform: 'translateY(-0.5px)',
            pointerEvents: 'none',
          }} />
          {/* Solid connector */}
          {gap > 0 && (
            <div style={{
              position: 'absolute', top: '50%',
              left: `${minPct}%`, width: `${gap}%`,
              height: 1.5, background: '#d1d5db', transform: 'translateY(-50%)',
            }} />
          )}
          {/* Tick A */}
          <div style={{
            position: 'absolute', top: '50%', left: `${pctA}%`,
            transform: 'translate(-50%, -50%)',
            width: 2, height: 16, background: colorA, borderRadius: 1,
          }} />
          {/* Tick B */}
          <div style={{
            position: 'absolute', top: '50%', left: `${pctB}%`,
            transform: 'translate(-50%, -50%)',
            width: 2, height: 16, background: colorB, borderRadius: 1,
          }} />
          {/* Labels — each faces OUTWARD from the connection.
              If A is the left tick, A label goes left and B label goes right.
              If A is the right tick (pctA > pctB), flip: A label goes right, B label goes left.
              With the buffer margins, even 0% and 100% values have room. */}
          {(() => {
            const aIsLeft = pctA <= pctB;
            return (
              <>
                <div style={{
                  position: 'absolute', top: '50%',
                  ...(aIsLeft
                    ? { right: `${100 - pctA}%`, paddingRight: 5 }
                    : { left: `${pctA}%`, paddingLeft: 5 }),
                  transform: 'translateY(-50%)',
                  fontSize: 10.5, color: colorA, fontWeight: 600, whiteSpace: 'nowrap',
                }}>{pctA}%</div>
                <div style={{
                  position: 'absolute', top: '50%',
                  ...(aIsLeft
                    ? { left: `${pctB}%`, paddingLeft: 5 }
                    : { right: `${100 - pctB}%`, paddingRight: 5 }),
                  transform: 'translateY(-50%)',
                  fontSize: 10.5, color: colorB, fontWeight: 700, whiteSpace: 'nowrap',
                }}>{pctB}%</div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

type CompareMode = 'dept' | 'year';

function DumbbellChart({ trend, dept }: { trend: SnpsResponseRow[]; dept: string | null }) {
  const isMobile   = useIsMobile();
  const labelWidth = isMobile ? 96 : 140;
  const axisTicks  = isMobile ? [0, 50, 100] : [0, 25, 50, 75, 100];
  const gridLines  = isMobile ? [50] : [25, 50, 75];

  const deptLabel  = dept ?? PS_TOTAL;
  const hasDept    = !!dept && deptLabel !== PS_TOTAL;
  const years      = [...new Set(trend.map(r => r.year))].sort();
  const latestYear = years.length ? years[years.length - 1] : null;
  const prevYear   = years.length > 1 ? years[years.length - 2] : null;

  const [mode, setMode]                 = useState<CompareMode>('dept');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const effectiveYear = selectedYear ?? latestYear;

  if (!latestYear) return <div style={{ color: '#6b7280', fontSize: 13, padding: '16px 0' }}>No data available.</div>;

  const effectiveMode: CompareMode = hasDept ? mode : 'year';
  const referenceYear = effectiveMode === 'dept' ? effectiveYear : latestYear;
  const values      = sortedValues(trend.filter(r => r.year === referenceYear));
  const qType       = detectType(values);
  const positiveSet = new Set(['To a great extent', 'To a moderate extent', 'Yes']);

  const colorA = COLOR_A, colorB = COLOR_B;
  const labelA = effectiveMode === 'dept' ? 'PS Total' : String(prevYear ?? years[0]);
  const labelB = effectiveMode === 'dept' ? deptLabel : String(latestYear);

  const chartRows = values.map(v => {
    let pctA = 0, pctB = 0;
    if (effectiveMode === 'dept') {
      const ps = trend.find(r => r.year === effectiveYear && r.dept_e === PS_TOTAL && r.question_value_e === v);
      const d  = trend.find(r => r.year === effectiveYear && r.dept_e === deptLabel  && r.question_value_e === v);
      pctA = Math.round((ps?.shr_w_resp ?? 0) * 100);
      pctB = Math.round((d?.shr_w_resp  ?? 0) * 100);
    } else {
      const entity = hasDept ? deptLabel : PS_TOTAL;
      const yearA  = prevYear ?? years[0];
      const rA = trend.find(r => r.year === yearA      && r.dept_e === entity && r.question_value_e === v);
      const rB = trend.find(r => r.year === latestYear && r.dept_e === entity && r.question_value_e === v);
      pctA = Math.round((rA?.shr_w_resp ?? 0) * 100);
      pctB = Math.round((rB?.shr_w_resp ?? 0) * 100);
    }
    return { label: v, pctA, pctB, isPositive: positiveSet.has(v) || qType === 'categorical' };
  });

  return (
    <div>
      {/* Mode toggle — only when dept is selected and there are ≥2 years */}
      {hasDept && prevYear && (
        <div style={{
          display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: 6,
          overflow: 'hidden', marginBottom: 12,
        }}>
          {([['dept', 'Dept vs PS Total'], ['year', `${prevYear} → ${latestYear}`]] as [CompareMode, string][]).map(([m, lbl]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '4px 12px', fontSize: 11, cursor: 'pointer', border: 'none',
                background: effectiveMode === m ? '#1d3557' : '#fff',
                color:      effectiveMode === m ? '#fff' : '#6b7280',
                fontWeight: effectiveMode === m ? 600 : 400,
              }}
            >{lbl}</button>
          ))}
        </div>
      )}

      {/* Legend + year picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
          <span style={{ width: 2, height: 13, background: colorA, display: 'inline-block', borderRadius: 1, flexShrink: 0 }} />
          {labelA}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: colorB, fontWeight: 600 }}>
          <span style={{ width: 2, height: 13, background: colorB, display: 'inline-block', borderRadius: 1, flexShrink: 0 }} />
          {labelB}
        </span>
        {effectiveMode === 'dept' && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
            {years.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y === effectiveYear ? null : y)}
                style={{
                  padding: '2px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer', border: '1px solid',
                  borderColor: effectiveYear === y ? '#1d3557' : '#e5e7eb',
                  background:  effectiveYear === y ? '#1d3557' : '#fff',
                  color:       effectiveYear === y ? '#fff' : '#6b7280',
                }}
              >{y}</button>
            ))}
          </div>
        )}
      </div>

      {/* X-axis tick labels — offset by TRACK_BUFFER to align with inner track */}
      <div style={{ display: 'flex', marginBottom: 4 }}>
        <div style={{ width: labelWidth, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, overflow: 'visible' }}>
          <div style={{ margin: `0 ${TRACK_BUFFER}px`, position: 'relative', height: 14 }}>
            {axisTicks.map(t => (
              <span key={t} style={{
                position: 'absolute', left: `${t}%`, transform: 'translateX(-50%)',
                fontSize: 10, color: '#6b7280',
              }}>{t}%</span>
            ))}
          </div>
        </div>
      </div>

      {/* Grid lines + rows */}
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: labelWidth + TRACK_BUFFER, right: TRACK_BUFFER, pointerEvents: 'none' }}>
          {gridLines.map(t => (
            <div key={t} style={{
              position: 'absolute', top: 0, bottom: 0, left: `${t}%`,
              borderLeft: '1px solid #f5f5f5',
            }} />
          ))}
        </div>
        {chartRows.map(r => (
          <DumbbellRow
            key={r.label}
            label={r.label} pctA={r.pctA} pctB={r.pctB}
            colorA={colorA} colorB={colorB} isPositive={r.isPositive}
            labelWidth={labelWidth}
          />
        ))}
      </div>
    </div>
  );
}

// ── Dept ranking chart ───────────────────────────────────────────────────────

function DeptRankingChart({
  question,
  years,
  selectedDept,
  qType,
  trend,
}: {
  question: string;
  years: number[];
  selectedDept: string | null;
  qType: QuestionType;
  trend: SnpsResponseRow[];
}) {
  const latestYear = years.length ? Math.max(...years) : null;
  const [rankYear, setRankYear] = useState<number | null>(null);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const effectiveYear = rankYear ?? latestYear;

  const isCategorical = qType === 'categorical';

  // Derive values from trend filtered to the active year so cross-year label changes don't produce duplicates
  const valuesForYear = useMemo(() => {
    const yearRows = trend.filter(r => r.year === effectiveYear);
    return sortedValues(yearRows);
  }, [trend, effectiveYear]);

  // Reset selected value when it no longer exists in the active year's value list
  const resolvedValue = selectedValue && valuesForYear.includes(selectedValue) ? selectedValue : null;
  const effectiveValue = isCategorical ? (resolvedValue ?? valuesForYear[0] ?? null) : null;

  const { data: scores = [], isLoading } = useSnpsDeptScores(question, effectiveYear, effectiveValue);

  const hasData = !isLoading && scores.length > 0 && (isCategorical || scores.some(s => s.positive_pct > 0));

  const highlightDept = selectedDept ?? PS_TOTAL;
  const highlightIdx  = hasData ? scores.findIndex(s => s.dept_e === highlightDept) : -1;
  const highlightRank = highlightIdx >= 0 ? highlightIdx + 1 : null;

  // Custom X-axis tick — only renders a triangle marker for the highlighted bar
  const HighlightTick = (props: { x?: number; y?: number; payload?: { value: string } }) => {
    const { x = 0, y = 0, payload } = props;
    if (payload?.value !== highlightDept) return null;
    return (
      <g transform={`translate(${x},${y + 4})`}>
        <polygon points="0,-5 4,2 -4,2" fill="#1d3557" />
      </g>
    );
  };

  // Custom tooltip
  const RankingTooltip = (props: { active?: boolean; payload?: Array<{ payload: { dept_e: string; positive_pct: number } }> }) => {
    const { active, payload } = props;
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const isHighlight = d.dept_e === highlightDept;
    return (
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
        padding: '7px 11px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        maxWidth: 220,
      }}>
        <div style={{ fontWeight: isHighlight ? 700 : 600, color: isHighlight ? '#1d3557' : '#374151', marginBottom: 3, lineHeight: 1.4 }}>
          {d.dept_e}
        </div>
        <div style={{ color: '#6b7280' }}>{d.positive_pct}% positive</div>
      </div>
    );
  };

  // Bar label — only on the highlighted bar, shows the % above it
  const HighlightLabel = (props: { x?: number; y?: number; width?: number; value?: number; index?: number }) => {
    const { x = 0, y = 0, width = 0, value, index } = props;
    if (scores[index ?? -1]?.dept_e !== highlightDept) return null;
    return (
      <text
        x={x + width / 2} y={y - 5}
        textAnchor="middle" fill="#1d3557"
        fontSize={11} fontWeight={700}
      >
        {value}%
      </text>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', letterSpacing: '-0.01em' }}>How departments compare</div>
        {highlightRank !== null && (
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            <span style={{ color: '#1d3557', fontWeight: 700 }}>
              {highlightDept === PS_TOTAL ? 'PS Total' : (highlightDept.length > 30 ? highlightDept.slice(0, 30) + '…' : highlightDept)}
            </span>
            {' '}ranks {highlightRank} of {scores.length}
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {isCategorical && valuesForYear.map(v => (
            <button
              key={v}
              onClick={() => setSelectedValue(v === effectiveValue ? null : v)}
              style={{
                padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                border: '1px solid',
                borderColor: effectiveValue === v ? '#0f766e' : '#e5e7eb',
                background: effectiveValue === v ? '#0f766e' : '#fff',
                color: effectiveValue === v ? '#fff' : '#6b7280',
              }}
            >{v}</button>
          ))}
          {years.map(y => (
            <button
              key={y}
              onClick={() => setRankYear(y === effectiveYear ? null : y)}
              style={{
                padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                border: '1px solid',
                borderColor: effectiveYear === y ? '#1d3557' : '#e5e7eb',
                background: effectiveYear === y ? '#1d3557' : '#fff',
                color: effectiveYear === y ? '#fff' : '#6b7280',
              }}
            >{y}</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div style={{ fontSize: 13, color: '#6b7280', padding: '12px 0' }}>Loading…</div>
      ) : !hasData ? (
        <div style={{ fontSize: 13, color: '#6b7280', padding: '12px 0' }}>No data for {effectiveYear}.</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart
              data={scores}
              margin={{ top: 20, right: 8, left: 0, bottom: 12 }}
              barCategoryGap="15%"
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis
                dataKey="dept_e"
                tick={<HighlightTick />}
                axisLine={false}
                tickLine={false}
                interval={0}
                height={16}
              />
              <YAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 10 }}
                width={32}
              />
              <Tooltip content={<RankingTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="positive_pct" label={<HighlightLabel />} isAnimationActive={false}>
                {scores.map(s => (
                  <Cell
                    key={s.dept_e}
                    fill={s.dept_e === highlightDept ? '#1d3557' : '#d1d5db'}
                    opacity={s.dept_e === highlightDept ? 1 : 0.7}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            Each bar = one department · hover to see name ·{' '}
            {isCategorical ? `% who answered "${effectiveValue}"` : '% positive response'} · {effectiveYear}
          </div>
        </>
      )}
    </div>
  );
}

// ── Question list ─────────────────────────────────────────────────────────────

function QuestionList({
  questions,
  selected,
  onSelect,
}: {
  questions: SnpsQuestion[];
  selected: string | null;
  onSelect: (q: string) => void;
}) {
  const themes = useMemo(() => {
    const map = new Map<string, SnpsQuestion[]>();
    for (const q of questions) {
      const theme = q.theme_e || 'Other';
      if (!map.has(theme)) map.set(theme, []);
      map.get(theme)!.push(q);
    }
    return map;
  }, [questions]);

  const [openThemes, setOpenThemes] = useState<Set<string>>(() => new Set());

  // Auto-expand first theme on load
  useEffect(() => {
    if (themes.size > 0 && openThemes.size === 0) {
      setOpenThemes(new Set([themes.keys().next().value!]));
    }
  }, [themes]);

  function toggleTheme(theme: string) {
    setOpenThemes(prev => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {[...themes.entries()].map(([theme, qs]) => (
        <div key={theme}>
          <button
            onClick={() => toggleTheme(theme)}
            style={{
              width: '100%', textAlign: 'left', background: openThemes.has(theme) ? '#f0f4ff' : 'none',
              border: 'none', cursor: 'pointer', padding: '8px 12px', fontSize: 12,
              fontWeight: 600, color: '#374151', display: 'flex',
              justifyContent: 'space-between', alignItems: 'center',
              borderRadius: 4,
            }}
            onMouseEnter={e => { if (!openThemes.has(theme)) e.currentTarget.style.background = '#f9fafb'; }}
            onMouseLeave={e => { if (!openThemes.has(theme)) e.currentTarget.style.background = 'none'; }}
          >
            <span>{theme}</span>
            <span style={{ fontSize: 10, color: '#6b7280' }}>{openThemes.has(theme) ? '▲' : '▼'} {qs.length}</span>
          </button>
          {openThemes.has(theme) && qs.map(q => (
            <button
              key={q.question}
              onClick={() => onSelect(q.question)}
              style={{
                width: '100%', textAlign: 'left',
                background: selected === q.question ? '#eef4fb' : 'none',
                border: 'none', cursor: 'pointer',
                padding: '6px 12px 6px 18px', fontSize: 11,
                color: selected === q.question ? '#1d3557' : '#4b5563',
                fontWeight: selected === q.question ? 600 : 400,
                borderLeft: selected === q.question ? '3px solid #1d3557' : '3px solid transparent',
                lineHeight: 1.4,
              }}
              onMouseEnter={e => { if (selected !== q.question) e.currentTarget.style.background = '#f9fafb'; }}
              onMouseLeave={e => { if (selected !== q.question) e.currentTarget.style.background = 'none'; }}
              title={q.question_e}
            >
              <span style={{ fontSize: 10, color: '#6b7280', display: 'block', marginBottom: 1 }}>
                {q.question} · {respondentGroup(q.question)}
              </span>
              {q.question_e.length > 80 ? q.question_e.slice(0, 80) + '…' : q.question_e}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SnpsSurvey() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedDept, _setSelectedDept] = useState<string | null>(() => searchParams.get('dept'));
  const [selectedQuestion, _setSelectedQuestion] = useState<string | null>(() => searchParams.get('q'));
  const [browseYear, setBrowseYear] = useState<number | null>(null);

  function setSelectedDept(dept: string | null) {
    _setSelectedDept(dept);
    setSearchParams(p => { dept ? p.set('dept', dept) : p.delete('dept'); return p; }, { replace: true });
  }

  function setSelectedQuestion(q: string | null) {
    _setSelectedQuestion(q);
    setSearchParams(p => { q ? p.set('q', q) : p.delete('q'); return p; }, { replace: true });
  }

  const { data: years = [] } = useSnpsYears();
  const latestYear = years.length ? Math.max(...years) : null;
  const effectiveBrowseYear = browseYear ?? latestYear;

  // Question list tracks the browse year; trend shows all years that share the code
  const { data: questions = [] } = useSnpsQuestions(effectiveBrowseYear ?? undefined);
  const { data: trend = [], isLoading: loadingTrend } = useSnpsTrend(selectedQuestion, selectedDept);

  // Clear selection when switching browse years if question not in new list
  const questionInList = questions.some(q => q.question === selectedQuestion);
  useEffect(() => {
    if (questions.length > 0 && selectedQuestion && !questionInList) setSelectedQuestion(null);
  }, [questions, selectedQuestion, questionInList]);

  const questionMeta = questions.find(q => q.question === selectedQuestion);

  // Flat ordered list in theme-grouped order (mirrors QuestionList rendering)
  const orderedQuestions = useMemo(() => {
    const map = new Map<string, SnpsQuestion[]>();
    for (const q of questions) {
      const theme = q.theme_e || 'Other';
      if (!map.has(theme)) map.set(theme, []);
      map.get(theme)!.push(q);
    }
    return [...map.values()].flat();
  }, [questions]);

  const currentIdx    = selectedQuestion ? orderedQuestions.findIndex(q => q.question === selectedQuestion) : -1;
  const prevQ = currentIdx > 0 ? orderedQuestions[currentIdx - 1] : null;
  const nextQ = currentIdx >= 0 && currentIdx < orderedQuestions.length - 1 ? orderedQuestions[currentIdx + 1] : null;

  // Positive scores per year for summary line
  const trendYears = [...new Set(trend.map(r => r.year))].sort();
  const allVals    = [...new Set(trend.map(r => r.question_value_e))];
  const qType      = detectType(allVals);
  const isScored   = qType !== 'categorical';

  const psScoreByYear = trendYears.map(y => ({
    year: y,
    score: posScore(trend.filter(r => r.year === y && r.dept_e === PS_TOTAL)),
  }));
  const deptScoreByYear = selectedDept
    ? trendYears.map(y => ({
        year: y,
        score: posScore(trend.filter(r => r.year === y && r.dept_e === selectedDept)),
      }))
    : null;

  const isMobile = useIsMobile();

  // On mobile, treat selecting a question as navigating to the detail view
  const showList   = !isMobile || !selectedQuestion;
  const showDetail = !isMobile || !!selectedQuestion;

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
        Staffing and Non-Partisanship Survey
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>
        What federal employees, managers, and staffing advisors say about staffing and merit.
        PSC surveys — {years.join(', ')}.
      </p>

      {/* Layout: two-column on desktop, single-column on mobile */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row' }}>

        {/* Left: question browser */}
        {showList && (
          <div style={{
            width: isMobile ? '100%' : 280, flexShrink: 0,
            border: '1px solid #e5e7eb', borderRadius: 8,
            background: '#fafafa',
            maxHeight: isMobile ? 'none' : 'calc(100vh - 200px)',
            overflowY: isMobile ? 'visible' : 'auto',
            position: isMobile ? 'static' : 'sticky', top: 16,
          }}>
            <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                Survey year
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {years.map(y => (
                  <button
                    key={y}
                    onClick={() => setBrowseYear(y === effectiveBrowseYear ? null : y)}
                    style={{
                      padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                      border: '1px solid',
                      borderColor: effectiveBrowseYear === y ? '#1d3557' : '#e5e7eb',
                      background: effectiveBrowseYear === y ? '#1d3557' : '#fff',
                      color: effectiveBrowseYear === y ? '#fff' : '#6b7280',
                    }}
                  >{y}</button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6 }}>{questions.length} questions</div>
            </div>
            {questions.length === 0 ? (
              <div style={{ padding: 16, fontSize: 13, color: '#6b7280' }}>No data — trigger ingestion first.</div>
            ) : (
              <QuestionList questions={questions} selected={selectedQuestion} onSelect={q => {
                setSelectedQuestion(q);
                // On mobile, scroll to top so the detail view starts at the top
                if (isMobile) window.scrollTo({ top: 0, behavior: 'smooth' });
              }} />
            )}
          </div>
        )}

        {/* Right: question detail */}
        {showDetail && (
        <div style={{ flex: 1, minWidth: 0, width: isMobile ? '100%' : undefined }}>
          {!selectedQuestion ? (
            <div style={{
              border: '1px solid #e5e7eb', borderRadius: 8, padding: '48px 32px',
              textAlign: 'center', color: '#6b7280', fontSize: 13, background: '#fafafa',
            }}>
              Select a question from the list to see responses
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* ── Section 1: Context — dept selector, nav, question header ── */}
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '14px 16px' : '16px 20px', background: '#fff' }}>

                {/* Mobile back button */}
                {isMobile && (
                  <button
                    onClick={() => setSelectedQuestion(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#1d3557', fontSize: 13, fontWeight: 600,
                      padding: '0 0 14px', marginBottom: 4,
                    }}
                  >
                    ← Back to questions
                  </button>
                )}

                {/* Dept selector */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Department</div>
                  <DeptSelector value={selectedDept} onChange={setSelectedDept} />
                </div>

                {/* Prev / Next navigation */}
                {currentIdx >= 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
                    <button
                      onClick={() => prevQ && setSelectedQuestion(prevQ.question)}
                      disabled={!prevQ}
                      style={{
                        padding: '4px 10px', fontSize: 12, borderRadius: 5, cursor: prevQ ? 'pointer' : 'default',
                        border: '1px solid #e5e7eb', background: '#fff',
                        color: prevQ ? '#374151' : '#d1d5db',
                      }}
                    >← Prev</button>
                    <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: '#6b7280' }}>
                      {currentIdx + 1} of {orderedQuestions.length}
                    </span>
                    <button
                      onClick={() => nextQ && setSelectedQuestion(nextQ.question)}
                      disabled={!nextQ}
                      style={{
                        padding: '4px 10px', fontSize: 12, borderRadius: 5, cursor: nextQ ? 'pointer' : 'default',
                        border: '1px solid #e5e7eb', background: '#fff',
                        color: nextQ ? '#374151' : '#d1d5db',
                      }}
                    >Next →</button>
                  </div>
                )}

                {/* Question header */}
                {questionMeta && (
                  <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#eef4fb', color: '#1d3557', fontWeight: 600 }}>
                        {questionMeta.theme_e}
                      </span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#f3f4f6', color: '#6b7280' }}>
                        {respondentGroup(selectedQuestion)}
                      </span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#f3f4f6', color: '#6b7280' }}>
                        {selectedQuestion}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#111827', lineHeight: 1.5 }}>
                      {questionMeta.question_e}
                    </p>
                    {questionMeta.category_e && (
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>{questionMeta.category_e}</p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Section 2: Response distribution ── */}
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '14px 16px' : '16px 20px', background: '#fff' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 14, letterSpacing: '-0.01em' }}>Response distribution</div>

              {/* Positive score summary — CSS grid so year columns align across both rows */}
              {isScored && psScoreByYear.length > 0 && (() => {
                const summaryYears = psScoreByYear.map(s => s.year);
                const summaryRows = [
                  { scores: psScoreByYear, label: 'PS Total', color: '#1d3557' },
                  ...(deptScoreByYear ? [{ scores: deptScoreByYear, label: selectedDept ?? '', color: COLOR_B }] : []),
                ];
                const labelColWidth = isMobile ? 90 : 110;
                return (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: `${labelColWidth}px ${summaryYears.map(() => '1fr').join(' ')}`,
                    rowGap: 6,
                    marginBottom: 16,
                    alignItems: 'center',
                  }}>
                    {summaryRows.map(({ scores: rowScores, label, color }) => (
                      <>
                        <div key={`${label}-lbl`} style={{
                          fontSize: 11, color: '#6b7280', paddingRight: 8, lineHeight: 1.35,
                          display: '-webkit-box', WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>{label}</div>
                        {summaryYears.map((y, i) => {
                          const s = rowScores.find(r => r.year === y);
                          const prevS = i > 0 ? rowScores.find(r => r.year === summaryYears[i - 1]) : null;
                          const arrow = prevS && s
                            ? (s.score > prevS.score ? '↑' : s.score < prevS.score ? '↓' : '—')
                            : null;
                          const arrowColor = prevS && s
                            ? (s.score > prevS.score ? '#15803d' : s.score < prevS.score ? '#dc2626' : '#6b7280')
                            : '#6b7280';
                          return (
                            <div key={`${label}-${y}`} style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                              <span style={{ fontSize: 10, color: '#6b7280' }}>{y}</span>
                              <span style={{ fontSize: 10, color: arrowColor, visibility: arrow ? 'visible' : 'hidden' }}>{arrow ?? '↑'}</span>
                              <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color }}>
                                {s != null ? `${s.score}%` : '—'}
                              </span>
                            </div>
                          );
                        })}
                      </>
                    ))}
                  </div>
                );
              })()}

              {/* Dumbbell distribution chart */}

              {loadingTrend ? (
                <div style={{ padding: '16px 0', color: '#6b7280', fontSize: 13 }}>Loading…</div>
              ) : (
                <DumbbellChart trend={trend} dept={selectedDept} />
              )}

              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
                Values shown as % of respondents.
                {isScored ? ' "Positive" = To a great extent + To a moderate extent (or Yes).' : ''}
              </div>
              {questionMeta?.theme_e === 'Demographic characteristics' && trendYears.some(y => y < 2025) && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>
                  Note: 2021/2023 demographic distributions are derived from cross-tabulation data and include all respondent types (employees, managers, and advisors). Department-level figures may differ from PSC's published values, which show employees only. 2025 data comes directly from the survey source and is accurate.
                </div>
              )}
              </div>

              {/* ── Section 3: Dept ranking ── */}
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '14px 16px' : '16px 20px', background: '#fff' }}>
              <DeptRankingChart
                question={selectedQuestion}
                years={years}
                selectedDept={selectedDept}
                qType={qType}
                trend={trend}
              />
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
