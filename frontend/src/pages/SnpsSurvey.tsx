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


const POSITIVE_KEYS = new Set(['To a great extent', 'To a moderate extent', 'Yes']);

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
  return 'categorical';
}

function sortedValues(rows: SnpsResponseRow[]): string[] {
  const vals = [...new Set(rows.map(r => r.question_value_e))];
  const likertSorted = LIKERT_ORDER.filter(v => vals.includes(v));
  if (likertSorted.length === vals.length) return likertSorted;
  if (vals.includes('Yes') && vals.includes('No')) return ['Yes', 'No', ...vals.filter(v => v !== 'Yes' && v !== 'No')];
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
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, padding: 0 }}
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

const COLOR_A = '#b0b7c3'; // PS Total or earlier year
const COLOR_B = '#e07b39'; // selected dept or latest year  (warm orange, like NYT)

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
        fontSize: 10.5, color: isPositive ? '#374151' : '#9ca3af',
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
          {/* Label A — always to the LEFT of tick A, overflows into left buffer */}
          <div style={{
            position: 'absolute', top: '50%',
            right: `${100 - pctA}%`, paddingRight: 5,
            transform: 'translateY(-50%)',
            fontSize: 10.5, color: colorA, fontWeight: 600, whiteSpace: 'nowrap',
          }}>{pctA}%</div>
          {/* Label B — always to the RIGHT of tick B, overflows into right buffer */}
          <div style={{
            position: 'absolute', top: '50%',
            left: `${pctB}%`, paddingLeft: 5,
            transform: 'translateY(-50%)',
            fontSize: 10.5, color: colorB, fontWeight: 700, whiteSpace: 'nowrap',
          }}>{pctB}%</div>
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

  if (!latestYear) return <div style={{ color: '#9ca3af', fontSize: 13, padding: '16px 0' }}>No data available.</div>;

  const effectiveMode: CompareMode = hasDept ? mode : 'year';
  const referenceYear = effectiveMode === 'dept' ? effectiveYear : latestYear;
  const values      = sortedValues(trend.filter(r => r.year === referenceYear));
  const qType       = detectType(values);
  const positiveSet = new Set(['To a great extent', 'To a moderate extent', 'Yes']);

  const colorA = COLOR_A, colorB = COLOR_B;
  const labelA = effectiveMode === 'dept' ? 'PS Total' : String(prevYear ?? years[0]);
  const labelB = effectiveMode === 'dept'
    ? (deptLabel.length > (isMobile ? 22 : 30) ? deptLabel.slice(0, isMobile ? 22 : 30) + '…' : deptLabel)
    : String(latestYear);

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
                fontSize: 10, color: '#d1d5db',
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

  if (isLoading) return <div style={{ fontSize: 13, color: '#9ca3af', padding: '12px 0' }}>Loading…</div>;
  if (scores.length === 0) return null;

  // For non-categorical questions, skip if no positive scores exist
  if (!isCategorical && !scores.some(s => s.positive_pct > 0)) return null;

  const highlightDept = selectedDept ?? PS_TOTAL;
  const highlightIdx  = scores.findIndex(s => s.dept_e === highlightDept);
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
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>How departments compare</div>
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
                borderColor: effectiveValue === v ? '#2a9d8f' : '#e5e7eb',
                background: effectiveValue === v ? '#2a9d8f' : '#fff',
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

      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
        Each bar = one department · hover to see name ·{' '}
        {isCategorical ? `% who answered "${effectiveValue}"` : '% positive response'} · {effectiveYear}
      </div>
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
            <span style={{ fontSize: 10, color: '#9ca3af' }}>{openThemes.has(theme) ? '▲' : '▼'} {qs.length}</span>
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
              <span style={{ fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 1 }}>
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
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6 }}>{questions.length} questions</div>
            </div>
            {questions.length === 0 ? (
              <div style={{ padding: 16, fontSize: 13, color: '#9ca3af' }}>No data — trigger ingestion first.</div>
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
              textAlign: 'center', color: '#9ca3af', fontSize: 13, background: '#fafafa',
            }}>
              Select a question from the list to see responses
            </div>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: isMobile ? '16px' : '20px 24px', background: '#fff' }}>

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
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Department</div>
                <DeptSelector value={selectedDept} onChange={setSelectedDept} />
              </div>

              {/* Question header */}
              {questionMeta && (
                <div style={{ marginBottom: 16, paddingTop: 4, borderTop: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#eef4fb', color: '#1d3557', fontWeight: 600 }}>
                      {questionMeta.theme_e}
                    </span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#f3f4f6', color: '#6b7280' }}>
                      {respondentGroup(selectedQuestion)}
                    </span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: '#f3f4f6', color: '#9ca3af' }}>
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

              {/* Positive score summary */}
              {isScored && psScoreByYear.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {[
                    { scores: psScoreByYear, label: 'PS Total', color: '#1d3557' },
                    ...(deptScoreByYear ? [{ scores: deptScoreByYear, label: selectedDept ?? '', color: COLOR_B }] : []),
                  ].map(({ scores: rowScores, label, color }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 0, marginBottom: 4, flexWrap: 'nowrap', overflow: 'hidden' }}>
                      <span style={{
                        fontSize: 11, color: '#6b7280', flexShrink: 0,
                        width: isMobile ? 72 : 80,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }} title={label}>
                        {label.length > (isMobile ? 10 : 12) ? label.slice(0, isMobile ? 10 : 12) + '…' : label}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: isMobile ? 6 : 8, flexWrap: 'nowrap' }}>
                        {rowScores.map((s, i) => (
                          <span key={s.year} style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexShrink: 0 }}>
                            <span style={{ fontSize: 10, color: '#9ca3af' }}>{s.year}</span>
                            <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color }}>{s.score}%</span>
                            {i < rowScores.length - 1 && (
                              <span style={{ fontSize: 10, color: rowScores[i + 1].score !== s.score ? (rowScores[i + 1].score > s.score ? '#15803d' : '#dc2626') : '#9ca3af' }}>
                                {rowScores[i + 1].score > s.score ? '↑' : rowScores[i + 1].score < s.score ? '↓' : '—'}
                              </span>
                            )}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Dumbbell distribution chart */}
              {loadingTrend ? (
                <div style={{ padding: '16px 0', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
              ) : (
                <DumbbellChart trend={trend} dept={selectedDept} />
              )}

              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                Values shown as % of respondents.
                {isScored ? ' "Positive" = To a great extent + To a moderate extent (or Yes).' : ''}
              </div>

              {/* Dept ranking chart */}
              <DeptRankingChart
                question={selectedQuestion}
                years={years}
                selectedDept={selectedDept}
                qType={qType}
                trend={trend}
              />
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
