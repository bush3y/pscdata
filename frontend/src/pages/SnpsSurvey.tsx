import { useState, useRef, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
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

// ── Constants ────────────────────────────────────────────────────────────────

const LIKERT_ORDER = [
  'To a great extent',
  'To a moderate extent',
  'To a minimal extent',
  'Not at all',
];

const LIKERT_COLORS: Record<string, string> = {
  'To a great extent':    '#15803d',
  'To a moderate extent': '#86efac',
  'To a minimal extent':  '#fca5a5',
  'Not at all':           '#dc2626',
  'Yes':                  '#1d4ed8',
  'No':                   '#cbd5e1',
};

const CATEGORICAL_COLORS = ['#1d3557','#2a9d8f','#e9c46a','#f4a261','#e76f51','#457b9d','#a8dadc','#6d6875'];

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

function colorForValue(v: string, type: QuestionType, idx: number): string {
  if (type === 'likert' || type === 'yesno') return LIKERT_COLORS[v] ?? '#94a3b8';
  return CATEGORICAL_COLORS[idx % CATEGORICAL_COLORS.length];
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

// ── Multi-year response distribution chart ───────────────────────────────────

function MultiYearChart({ trend, dept }: { trend: SnpsResponseRow[]; dept: string | null }) {
  const deptLabel = dept ?? PS_TOTAL;
  const years = [...new Set(trend.map(r => r.year))].sort();
  if (years.length === 0) return <div style={{ color: '#9ca3af', fontSize: 13, padding: '16px 0' }}>No data available.</div>;

  const values = sortedValues(trend);
  const qType  = detectType(values);

  // One row per year; if dept selected, two rows per year (dept first, then PS)
  const rows: Array<Record<string, string | number>> = [];
  for (const y of [...years].reverse()) {
    const depts = (dept && deptLabel !== PS_TOTAL) ? [deptLabel, PS_TOTAL] : [PS_TOTAL];
    for (const d of depts) {
      const dData = trend.filter(r => r.year === y && r.dept_e === d);
      const label = (dept && deptLabel !== PS_TOTAL)
        ? `${y} · ${d === PS_TOTAL ? 'PS Total' : (d.length > 22 ? d.slice(0, 22) + '…' : d)}`
        : `${y}`;
      const row: Record<string, string | number> = { name: label };
      for (const v of values) {
        row[v] = Math.round((dData.find(r => r.question_value_e === v)?.shr_w_resp ?? 0) * 1000) / 10;
      }
      rows.push(row);
    }
  }

  const numRows  = rows.length;
  const barSize  = 22;
  const chartH   = numRows * (barSize + 10) + 40;
  const yWidth   = dept && deptLabel !== PS_TOTAL ? 200 : 50;

  return (
    <ResponsiveContainer width="100%" height={chartH}>
      <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 36, left: 0, bottom: 4 }} barSize={barSize}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={yWidth} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => `${v}%`} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
        {values.map((v, i) => (
          <Bar key={v} dataKey={v} stackId="a" fill={colorForValue(v, qType, i)} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Dept ranking chart ───────────────────────────────────────────────────────

function DeptRankingChart({
  question,
  years,
  selectedDept,
}: {
  question: string;
  years: number[];
  selectedDept: string | null;
}) {
  const latestYear = years.length ? Math.max(...years) : null;
  const [rankYear, setRankYear] = useState<number | null>(null);
  const effectiveYear = rankYear ?? latestYear;

  const { data: scores = [], isLoading } = useSnpsDeptScores(question, effectiveYear);

  if (isLoading) return <div style={{ fontSize: 13, color: '#9ca3af', padding: '12px 0' }}>Loading…</div>;
  if (scores.length === 0) return null;

  // Only render if there's meaningful positive scoring (skip pure categorical)
  const hasPositive = scores.some(s => s.positive_pct > 0);
  if (!hasPositive) return null;

  const maxPct = Math.max(...scores.map(s => s.positive_pct), 1);
  const highlightDept = selectedDept ?? PS_TOTAL;

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>How departments compare</div>
        <div style={{ display: 'flex', gap: 4 }}>
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
      <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
        {scores.map(s => {
          const isHighlighted = s.dept_e === highlightDept;
          const pct = s.positive_pct;
          return (
            <div key={s.dept_e} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 180, fontSize: 11, color: isHighlighted ? '#1d3557' : '#6b7280',
                  fontWeight: isHighlighted ? 700 : 400, textAlign: 'right',
                  flexShrink: 0, lineHeight: 1.3,
                }}>
                  {s.dept_e.length > 30 ? s.dept_e.slice(0, 30) + '…' : s.dept_e}
                </div>
                <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 3, height: 16, position: 'relative' }}>
                  <div style={{
                    width: `${(pct / maxPct) * 100}%`,
                    height: '100%',
                    borderRadius: 3,
                    background: isHighlighted ? '#1d3557' : '#93c5fd',
                    minWidth: pct > 0 ? 2 : 0,
                  }} />
                </div>
                <div style={{ width: 36, fontSize: 11, color: isHighlighted ? '#1d3557' : '#6b7280', fontWeight: isHighlighted ? 700 : 400 }}>
                  {pct}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
        % positive response by department · {effectiveYear}
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
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [browseYear, setBrowseYear] = useState<number | null>(null);

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

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
        Staffing and Non-Partisanship Survey
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>
        What federal employees, managers, and staffing advisors say about staffing and merit.
        PSC surveys — {years.join(', ')}.
      </p>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* Left: question browser */}
        <div style={{
          width: 280, flexShrink: 0,
          border: '1px solid #e5e7eb', borderRadius: 8,
          background: '#fafafa',
          maxHeight: 'calc(100vh - 200px)',
          overflowY: 'auto',
          position: 'sticky', top: 16,
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
            <QuestionList questions={questions} selected={selectedQuestion} onSelect={setSelectedQuestion} />
          )}
        </div>

        {/* Right: question detail */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedQuestion ? (
            <div style={{
              border: '1px solid #e5e7eb', borderRadius: 8, padding: '48px 32px',
              textAlign: 'center', color: '#9ca3af', fontSize: 13, background: '#fafafa',
            }}>
              Select a question from the list to see responses
            </div>
          ) : (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '20px 24px', background: '#fff' }}>

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
                <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {/* PS Total row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, color: '#6b7280', width: 80, flexShrink: 0 }}>PS Total</span>
                    {psScoreByYear.map((s, i) => (
                      <span key={s.year} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>{s.year}</span>
                        <span style={{ fontSize: 16, fontWeight: 700, color: '#1d3557' }}>{s.score}%</span>
                        {i < psScoreByYear.length - 1 && (
                          <span style={{ fontSize: 12, color: psScoreByYear[i + 1].score > s.score ? '#15803d' : psScoreByYear[i + 1].score < s.score ? '#dc2626' : '#9ca3af' }}>
                            {psScoreByYear[i + 1].score > s.score ? '→' : psScoreByYear[i + 1].score < s.score ? '→' : '→'}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                  {/* Dept row if selected */}
                  {deptScoreByYear && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: '#6b7280', width: 80, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selectedDept ?? ''}>
                        {(selectedDept ?? '').length > 12 ? (selectedDept ?? '').slice(0, 12) + '…' : selectedDept}
                      </span>
                      {deptScoreByYear.map((s, i) => (
                        <span key={s.year} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 11, color: '#9ca3af' }}>{s.year}</span>
                          <span style={{ fontSize: 16, fontWeight: 700, color: '#e63946' }}>{s.score}%</span>
                          {i < deptScoreByYear.length - 1 && <span style={{ fontSize: 12, color: '#9ca3af' }}>→</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Multi-year bar chart */}
              {loadingTrend ? (
                <div style={{ padding: '16px 0', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
              ) : (
                <MultiYearChart trend={trend} dept={selectedDept} />
              )}

              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                Values shown as % of respondents.
                {isScored ? ' "Positive" = To a great extent + To a moderate extent (or Yes).' : ''}
              </div>

              {/* Dept ranking chart */}
              {isScored && (
                <DeptRankingChart
                  question={selectedQuestion}
                  years={years}
                  selectedDept={selectedDept}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
