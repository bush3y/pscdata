import { useState, useRef, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, LineChart, Line,
} from 'recharts';
import {
  PS_TOTAL,
  useSnpsYears,
  useSnpsDepartments,
  useSnpsQuestions,
  useSnpsResponses,
  useSnpsTrend,
  type SnpsQuestion,
  type SnpsResponseRow,
} from '../api/snps';

// ── Constants ────────────────────────────────────────────────────────────────

// Likert response order: most positive first
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
  'Yes':                  '#1d3557',
  'No':                   '#cbd5e1',
};

const TREND_COLORS = ['#1d3557', '#e63946'];

// Question code prefix → respondent group label
const RESPONDENT_PREFIX: Record<string, string> = {
  GEN: 'All employees',
  HMN: 'Hiring managers',
  MAN: 'Managers',
  ADV: 'Staffing advisors',
  STA: 'Staffing advisors',
};

function respondentGroup(question: string): string {
  const prefix = question.split('_')[0].toUpperCase();
  return RESPONDENT_PREFIX[prefix] ?? 'All employees';
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
    <div style={{ position: 'relative', width: '100%', maxWidth: 400 }}>
      <input
        ref={inputRef}
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setInput(value && value !== PS_TOTAL ? value : '')}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
        placeholder="Federal Public Service (all)"
        style={{
          width: '100%', padding: '9px 34px 9px 14px', fontSize: 13,
          border: '1.5px solid #e5e7eb', borderRadius: 8,
          boxSizing: 'border-box', outline: 'none',
          background: '#fafafa', color: '#111827',
        }}
      />
      {input && (
        <button
          onClick={() => { setInput(''); onChange(null); setOpen(false); }}
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 18, padding: 0 }}
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
              style={{ padding: '8px 14px', fontSize: 13, cursor: 'pointer', color: '#374151', fontWeight: opt === PS_TOTAL ? 600 : 400 }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f8ff')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{opt}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Response distribution chart ──────────────────────────────────────────────

function sortedValues(rows: SnpsResponseRow[]): string[] {
  const vals = [...new Set(rows.map(r => r.question_value_e))];
  // Sort by Likert order if applicable, otherwise alphabetically
  const likertSorted = LIKERT_ORDER.filter(v => vals.includes(v));
  if (likertSorted.length === vals.length) return likertSorted;
  // Yes before No
  if (vals.includes('Yes') && vals.includes('No')) return ['Yes', 'No', ...vals.filter(v => v !== 'Yes' && v !== 'No')];
  return vals.sort();
}

function ResponseChart({
  rows,
  dept,
  year,
}: {
  rows: SnpsResponseRow[];
  dept: string | null;
  year: number;
}) {
  const deptLabel = dept ?? PS_TOTAL;
  const psRows   = rows.filter(r => r.dept_e === PS_TOTAL && r.year === year);
  const deptRows = rows.filter(r => r.dept_e === deptLabel && r.year === year);

  const values = sortedValues([...psRows, ...deptRows]);

  function toChartRow(label: string, data: SnpsResponseRow[]) {
    const row: Record<string, string | number> = { name: label };
    for (const v of values) {
      const match = data.find(r => r.question_value_e === v);
      row[v] = match ? Math.round(match.shr_w_resp * 1000) / 10 : 0;
    }
    return row;
  }

  const chartData = dept && deptLabel !== PS_TOTAL
    ? [toChartRow(deptLabel.length > 40 ? deptLabel.slice(0, 40) + '…' : deptLabel, deptRows), toChartRow(PS_TOTAL, psRows)]
    : [toChartRow(PS_TOTAL, psRows)];

  const positiveKeys = ['To a great extent', 'To a moderate extent', 'Yes'];
  function posScore(data: SnpsResponseRow[]) {
    return Math.round(data.filter(r => positiveKeys.includes(r.question_value_e))
      .reduce((s, r) => s + r.shr_w_resp * 100, 0));
  }

  const deptPos = posScore(deptRows.length ? deptRows : psRows);
  const psPos   = posScore(psRows);

  return (
    <div>
      {/* Positive score headline */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 20, flexWrap: 'wrap' }}>
        {dept && deptLabel !== PS_TOTAL && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 20px' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#15803d', lineHeight: 1 }}>{deptPos}%</div>
            <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>positive — {deptLabel.length > 30 ? deptLabel.slice(0, 30) + '…' : deptLabel}</div>
          </div>
        )}
        <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 20px' }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#1d3557', lineHeight: 1 }}>{psPos}%</div>
          <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>positive — Federal Public Service</div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={dept && deptLabel !== PS_TOTAL ? 120 : 72}>
        <BarChart layout="vertical" data={chartData} margin={{ top: 0, right: 40, left: 0, bottom: 0 }} barSize={28}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
          <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={dept && deptLabel !== PS_TOTAL ? 180 : 160} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          {values.map(v => (
            <Bar key={v} dataKey={v} stackId="a" fill={LIKERT_COLORS[v] ?? '#94a3b8'} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
        Values shown as % of respondents. "Positive" = {values.filter(v => positiveKeys.includes(v)).join(' + ')}.
      </div>
    </div>
  );
}

// ── Trend chart ───────────────────────────────────────────────────────────────

function TrendChart({ rows, dept }: { rows: SnpsResponseRow[]; dept: string | null }) {
  const deptLabel = dept ?? PS_TOTAL;
  const positiveKeys = new Set(['To a great extent', 'To a moderate extent', 'Yes']);

  const years = [...new Set(rows.map(r => r.year))].sort();
  if (years.length < 2) return null;

  const depts = dept && deptLabel !== PS_TOTAL ? [deptLabel, PS_TOTAL] : [PS_TOTAL];

  const data = years.map(y => {
    const row: Record<string, number | string> = { year: y };
    for (const d of depts) {
      const dRows = rows.filter(r => r.year === y && r.dept_e === d && positiveKeys.has(r.question_value_e));
      row[d] = Math.round(dRows.reduce((s, r) => s + r.shr_w_resp * 100, 0));
    }
    return row;
  });

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Positive response trend</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} width={40} />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {depts.map((d, i) => (
            <Line
              key={d}
              type="monotone"
              dataKey={d}
              name={d.length > 35 ? d.slice(0, 35) + '…' : d}
              stroke={TREND_COLORS[i % TREND_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
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
  // Group by theme
  const themes = useMemo(() => {
    const map = new Map<string, SnpsQuestion[]>();
    for (const q of questions) {
      const theme = q.theme_e || 'Other';
      if (!map.has(theme)) map.set(theme, []);
      map.get(theme)!.push(q);
    }
    return map;
  }, [questions]);

  const [openThemes, setOpenThemes] = useState<Set<string>>(() => new Set(themes.keys()));

  function toggleTheme(theme: string) {
    setOpenThemes(prev => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme);
      else next.add(theme);
      return next;
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {[...themes.entries()].map(([theme, qs]) => (
        <div key={theme}>
          <button
            onClick={() => toggleTheme(theme)}
            style={{
              width: '100%', textAlign: 'left', background: 'none', border: 'none',
              cursor: 'pointer', padding: '8px 12px', fontSize: 12,
              fontWeight: 600, color: '#374151', display: 'flex',
              justifyContent: 'space-between', alignItems: 'center',
              borderRadius: 6, letterSpacing: '-0.01em',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <span>{theme}</span>
            <span style={{ fontSize: 10, color: '#9ca3af' }}>{openThemes.has(theme) ? '▲' : '▼'}</span>
          </button>
          {openThemes.has(theme) && qs.map(q => (
            <button
              key={q.question}
              onClick={() => onSelect(q.question)}
              style={{
                width: '100%', textAlign: 'left', background: selected === q.question ? '#eef4fb' : 'none',
                border: 'none', cursor: 'pointer',
                padding: '7px 12px 7px 20px', fontSize: 12, color: selected === q.question ? '#1d3557' : '#4b5563',
                fontWeight: selected === q.question ? 600 : 400,
                borderLeft: selected === q.question ? '3px solid #1d3557' : '3px solid transparent',
                lineHeight: 1.4,
              }}
              onMouseEnter={e => { if (selected !== q.question) e.currentTarget.style.background = '#f9fafb'; }}
              onMouseLeave={e => { if (selected !== q.question) e.currentTarget.style.background = 'none'; }}
              title={q.question_e}
            >
              <span style={{ fontSize: 10, color: '#9ca3af', display: 'block', marginBottom: 2 }}>
                {q.question} · {respondentGroup(q.question)}
              </span>
              {q.question_e.length > 90 ? q.question_e.slice(0, 90) + '…' : q.question_e}
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
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const { data: years = [] } = useSnpsYears();
  const latestYear = years.length ? Math.max(...years) : null;
  const viewYear = selectedYear ?? latestYear ?? undefined;

  const { data: questions = [] } = useSnpsQuestions(latestYear ?? undefined);
  const { data: responses = [], isLoading: loadingResponses } = useSnpsResponses(
    selectedQuestion, selectedDept, viewYear,
  );
  const { data: trend = [] } = useSnpsTrend(selectedQuestion, selectedDept);

  const questionMeta = questions.find(q => q.question === selectedQuestion);

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
        Staffing and Non-Partisanship Survey
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6b7280' }}>
        What federal employees, managers, and staffing advisors say about staffing practices and merit.
        Survey conducted by PSC — 2021, 2023, and 2025 cycles.
      </p>

      {/* Department + year controls */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Department</div>
          <DeptSelector value={selectedDept} onChange={setSelectedDept} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Survey year</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {years.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y === (selectedYear ?? latestYear) ? null : y)}
                style={{
                  padding: '6px 14px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                  border: '1px solid',
                  borderColor: (selectedYear ?? latestYear) === y ? '#1d3557' : '#e5e7eb',
                  background: (selectedYear ?? latestYear) === y ? '#1d3557' : '#fff',
                  color: (selectedYear ?? latestYear) === y ? '#fff' : '#374151',
                  fontWeight: (selectedYear ?? latestYear) === y ? 600 : 400,
                }}
              >{y}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Two-column layout: question browser + detail */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

        {/* Left: question browser */}
        <div style={{
          width: 300, flexShrink: 0,
          border: '1px solid #e5e7eb', borderRadius: 8,
          background: '#fafafa', maxHeight: 'calc(100vh - 240px)',
          overflowY: 'auto',
        }}>
          <div style={{ padding: '12px 12px 8px', fontSize: 12, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb' }}>
            {questions.length} questions · select to explore
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
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '24px 28px', background: '#fff' }}>

              {/* Question header */}
              {questionMeta && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
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

              {/* Response chart */}
              {loadingResponses ? (
                <div style={{ padding: '24px 0', color: '#9ca3af', fontSize: 13 }}>Loading…</div>
              ) : responses.length === 0 ? (
                <div style={{ padding: '24px 0', color: '#9ca3af', fontSize: 13 }}>No data for this question.</div>
              ) : (
                <>
                  <ResponseChart rows={responses} dept={selectedDept} year={viewYear!} />
                  <TrendChart rows={trend} dept={selectedDept} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
