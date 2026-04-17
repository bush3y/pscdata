import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import client from '../api/client';

// ── API hooks ──────────────────────────────────────────────────────────────

interface AutocompleteResult { reference_number: string | null; selection_process_number: string | null }

function useAutocomplete(q: string) {
  return useQuery<AutocompleteResult[]>({
    queryKey: ['adv-autocomplete', q],
    queryFn: () =>
      client.get('/advertisements/autocomplete', { params: { q, limit: 10 } }).then(r => r.data),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

function useProcess(refNum: string, carChcId: number | null) {
  return useQuery<Record<string, unknown>>({
    queryKey: ['adv-process', carChcId ?? refNum],
    queryFn: () => {
      const params = carChcId != null ? { car_chc_id: carChcId } : { reference_number: refNum };
      return client.get('/advertisements/process', { params }).then(r => r.data);
    },
    enabled: !!refNum || carChcId != null,
    retry: false,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' && v.trim() === '') return '—';
  return String(v);
}

function fmtDate(v: unknown): string {
  if (!v) return '—';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtNum(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  return isNaN(n) ? '—' : n.toLocaleString();
}

function statusStyle(status: string): React.CSSProperties {
  const s = status.toLowerCase();
  if (s.includes('open'))   return { background: '#dcfce7', color: '#15803d' };
  if (s.includes('closed')) return { background: '#fee2e2', color: '#dc2626' };
  return { background: '#ede9fe', color: '#7c3aed' };
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '11px 0', borderBottom: '1px solid #f3f4f6', alignItems: 'flex-start' }}>
      <span style={{ minWidth: 160, fontSize: 12, fontWeight: 500, color: '#9ca3af', paddingTop: 1 }}>{label}</span>
      <span style={{ fontSize: 13.5, color: '#111827', flex: 1, lineHeight: 1.5, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      background: '#f1f5f9',
      color: '#334155',
      borderRadius: 4,
      fontSize: 11.5,
      fontFamily: 'monospace',
      fontWeight: 500,
      margin: '2px 3px 2px 0',
      border: '1px solid #e2e8f0',
    }}>{label}</span>
  );
}

function StatBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ flex: 1, padding: '20px 24px', borderRight: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#9ca3af' }}>{sub}</div>}
    </div>
  );
}

function FunnelBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: '#374151' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
          {value.toLocaleString()}
          {total > 0 && <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 6, fontSize: 12 }}>{pct.toFixed(1)}%</span>}
        </span>
      </div>
      <div style={{ height: 6, background: '#f3f4f6', borderRadius: 99 }}>
        <div style={{ height: 6, width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 99, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ProcessDetail() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlId = searchParams.get('id') ? Number(searchParams.get('id')) : null;

  const [input, setInput] = useState('');
  const [selected, setSelected] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const { data: suggestions = [] } = useAutocomplete(input);
  const { data: process, isLoading, error } = useProcess(selected, urlId);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (!inputRef.current?.contains(e.target as Node) && !listRef.current?.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function pick(ref: string) { setInput(ref); setSelected(ref); setOpen(false); }
  function pickResult(r: AutocompleteResult) {
    const key = r.selection_process_number ?? r.reference_number ?? '';
    pick(key);
  }
  function handleKeyDown(e: React.KeyboardEvent) { if (e.key === 'Enter' && input.trim()) pick(input.trim()); }

  // Sync car_chc_id to URL when a process loads
  useEffect(() => {
    if (process?.car_chc_id != null) {
      setSearchParams({ id: String(process.car_chc_id) }, { replace: true });
    }
  }, [process?.car_chc_id]);

  const submitted   = Number(process?.total_submitted_sup ?? 0);
  const screenedIn  = Number(process?.total_in_sup ?? 0);
  const screenedOut = Number(process?.total_out_sup ?? 0);
  const cafIn       = process?.caf_in != null ? Number(process.caf_in) : null;

  const eeGroups = [
    { label: 'Women',                   key: 'women_submitted_sup' },
    { label: 'Visible Minority',        key: 'vismin_submitted_sup' },
    { label: 'Indigenous',              key: 'indigenous_submitted_sup' },
    { label: 'Persons w/ Disabilities', key: 'pwd_submitted_sup' },
  ].map(g => ({ ...g, value: process?.[g.key] != null ? Number(process[g.key]) : null }));
  const hasEE = eeGroups.some(g => g.value !== null);

  const folGroups = [
    { label: 'Francophone', key: 'french_submitted_sup' },
    { label: 'Anglophone',  key: 'english_submitted_sup' },
  ].map(g => ({ ...g, value: process?.[g.key] != null ? Number(process[g.key]) : null }));
  const hasFOL = folGroups.some(g => g.value !== null);

  const classifications = process?.classifications
    ? String(process.classifications).split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const audience = [
    process?.internal_indicator === '1' ? 'Internal' : null,
    process?.external_indicator === '1' ? 'External' : null,
  ].filter(Boolean).join(' & ') || '—';

  const appointmentTypes = [
    process?.indeterminate  ? 'Indeterminate'  : null,
    process?.specified_term ? 'Specified Term' : null,
    process?.acting         ? 'Acting'         : null,
    process?.assignment     ? 'Assignment'     : null,
    process?.deployment     ? 'Deployment'     : null,
    process?.secondment     ? 'Secondment'     : null,
  ].filter(Boolean).join(' · ') || '—';

  const city = fmt(process?.city_name_e);
  const advUrl = process?.advertisement_url_e ? String(process.advertisement_url_e) : null;

  const screenedPct = submitted > 0 ? ` · ${((screenedIn / submitted) * 100).toFixed(1)}% screened in` : '';

  return (
    <div style={{ maxWidth: 900, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Page title */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
          Process Lookup
        </h2>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
          Search by selection process number (e.g. <span style={{ fontFamily: 'monospace' }}>22-DIS-ON-EA-423055</span>) or internal reference number. Requires re-ingestion to populate selection process numbers.
        </p>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', maxWidth: 460, marginBottom: 36 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); setSelected(''); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Selection process or reference number…"
          style={{
            width: '100%', padding: '11px 16px', fontSize: 14,
            border: '1.5px solid #e5e7eb', borderRadius: 10,
            boxSizing: 'border-box', outline: 'none',
            fontFamily: 'monospace', letterSpacing: '0.01em',
            color: '#111827', background: '#fafafa',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            transition: 'border-color 0.15s',
          }}
          onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = '#fafafa'; }}
        />
        {open && suggestions.length > 0 && (
          <ul ref={listRef} style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
            margin: 0, padding: '4px 0', listStyle: 'none',
            border: '1.5px solid #e5e7eb', borderRadius: 10,
            background: '#fff', zIndex: 100,
            boxShadow: '0 8px 24px rgba(0,0,0,0.09)',
            maxHeight: 260, overflowY: 'auto',
          }}>
            {suggestions.map((s, i) => (
              <li key={i} onMouseDown={() => pickResult(s)}
                style={{ padding: '9px 16px', cursor: 'pointer', color: '#374151' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {s.selection_process_number && (
                  <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{s.selection_process_number}</div>
                )}
                {s.reference_number && (
                  <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{s.reference_number}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {isLoading && <p style={{ color: '#6b7280', fontSize: 14 }}>Loading…</p>}

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 13 }}>
          Process not found. Check the reference or selection process number and try again.
        </div>
      )}

      {/* Empty state — shown before any search */}
      {!selected && urlId == null && !isLoading && (
        <div style={{ border: '1.5px dashed #e5e7eb', borderRadius: 14, overflow: 'hidden', opacity: 0.5, pointerEvents: 'none' }}>
          <div style={{ padding: '24px 28px', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ height: 12, width: 160, background: '#f3f4f6', borderRadius: 4, marginBottom: 10 }} />
            <div style={{ height: 22, width: 340, background: '#f3f4f6', borderRadius: 4, marginBottom: 10 }} />
            <div style={{ height: 14, width: 260, background: '#f3f4f6', borderRadius: 4 }} />
          </div>
          <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6' }}>
            {['Applications', 'Screened In', 'Screened Out'].map(label => (
              <div key={label} style={{ flex: 1, padding: '20px 24px', borderRight: '1px solid #f3f4f6' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
                <div style={{ height: 28, width: 80, background: '#f3f4f6', borderRadius: 4 }} />
              </div>
            ))}
            <div style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ padding: '8px 28px 24px', borderRight: '1px solid #f3f4f6' }}>
              <div style={{ height: 10, width: 70, background: '#f3f4f6', borderRadius: 4, margin: '20px 0 12px' }} />
              {[200, 140, 180, 120, 160, 100, 150].map((w, i) => (
                <div key={i} style={{ height: 14, width: w, background: '#f3f4f6', borderRadius: 4, marginBottom: 14 }} />
              ))}
            </div>
            <div style={{ padding: '8px 28px 24px' }}>
              <div style={{ height: 10, width: 100, background: '#f3f4f6', borderRadius: 4, margin: '20px 0 12px' }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {[40, 50, 45, 55, 42, 48, 52].map((w, i) => (
                  <div key={i} style={{ height: 22, width: w, background: '#f3f4f6', borderRadius: 4 }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {process && (
        <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>

          {/* Header */}
          <div style={{ padding: '24px 28px', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11.5, fontFamily: 'monospace', color: '#6b7280', fontWeight: 600, marginBottom: 4, letterSpacing: '0.04em' }}>
                  {process.selection_process_number ? fmt(process.selection_process_number) : fmt(process.reference_number)}
                </div>
                {Boolean(process.selection_process_number) && Boolean(process.reference_number) && (
                  <div style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#9ca3af', marginBottom: 6 }}>
                    Ref: {fmt(process.reference_number)}
                  </div>
                )}
                <h3 style={{ margin: '0 0 8px', fontSize: 19, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
                  {fmt(process.position_title_e)}
                </h3>
                <div style={{ fontSize: 13.5, color: '#6b7280' }}>
                  {fmt(process.organization_e)}&ensp;·&ensp;{fmt(process.administrator_region_e)}&ensp;·&ensp;{fmt(process.fiscal_year)}
                </div>
              </div>
              <span style={{
                ...statusStyle(fmt(process.status_e)),
                fontSize: 12, fontWeight: 700, padding: '5px 14px',
                borderRadius: 99, whiteSpace: 'nowrap', alignSelf: 'flex-start',
              }}>
                {fmt(process.status_e)}
              </span>
            </div>
          </div>

          {/* Stats row */}
          {(submitted > 0 || screenedIn > 0) && (
            <div style={{ display: 'flex', borderBottom: '1px solid #f3f4f6', flexWrap: 'wrap' }}>
              <StatBox label="Applications" value={submitted.toLocaleString()} color="#1d3557" />
              <StatBox label="Screened In"  value={screenedIn.toLocaleString()} sub={screenedPct.replace(' · ', '')} color="#457b9d" />
              {screenedOut > 0 && <StatBox label="Screened Out" value={screenedOut.toLocaleString()} color="#e63946" />}
              <div style={{ flex: 1 }} />
            </div>
          )}

          {/* Two-column detail */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

            {/* Left column */}
            <div style={{ padding: '8px 28px 24px', borderRight: '1px solid #f3f4f6' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '16px 0 4px' }}>
                Overview
              </div>
              <Row label="Open Date"    value={fmtDate(process.open_date)} />
              <Row label="Close Date"   value={fmtDate(process.close_date)} />
              {process.number_days_open != null && (
                <Row label="Days Open" value={`${fmtNum(process.number_days_open)} days`} />
              )}
              <Row label="Ad Type"      value={fmt(process.advertisement_type_e)} />
              <Row label="Audience"     value={audience} />
              <Row label="Program"      value={fmt(process.recruitment_program_e)} />
              {city !== '—' && <Row label="City" value={city} />}
              <Row label="Province"     value={fmt(process.province_name_e)} />
              <Row label="Tenure Sought" value={appointmentTypes} />
              {advUrl && (
                <Row label="Job Posting" value={
                  <a href={advUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: '#1d3557', fontSize: 13 }}>
                    View on GC Jobs ↗
                  </a>
                } />
              )}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '24px 0 4px' }}>
                Classifications
              </div>
              <div style={{ paddingTop: 10 }}>
                {classifications.length > 0
                  ? classifications.map(c => <Chip key={c} label={c} />)
                  : <span style={{ fontSize: 13, color: '#9ca3af' }}>—</span>
                }
              </div>
            </div>

            {/* Right column */}
            <div style={{ padding: '8px 28px 24px' }}>

              {(submitted > 0 || screenedIn > 0) && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '16px 0 4px' }}>
                    Application Status
                  </div>
                  <div style={{ paddingTop: 12 }}>
                    <FunnelBar label="Submitted"   value={submitted}  total={submitted} color="#1d3557" />
                    <FunnelBar label="Screened In" value={screenedIn} total={submitted} color="#457b9d" />
                    {screenedOut > 0 && <FunnelBar label="Screened Out" value={screenedOut} total={submitted} color="#e63946" />}
                  </div>
                </>
              )}

              {hasEE && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '24px 0 4px' }}>
                    EE Applicants
                  </div>
                  <div style={{ paddingTop: 8 }}>
                    {eeGroups.map(g => g.value !== null && (
                      <div key={g.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                        <span style={{ color: '#374151' }}>{g.label}</span>
                        <span style={{ fontWeight: 600, color: '#111827' }}>
                          {g.value!.toLocaleString()}
                          {submitted > 0 && (
                            <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 6, fontSize: 12 }}>
                              {((g.value! / submitted) * 100).toFixed(1)}%
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                    <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>
                      Count of applicants self-identifying in each EE group. Suppressed (&lt;5) shown as —.
                    </p>
                  </div>
                </>
              )}

              {hasFOL && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '24px 0 4px' }}>
                    First Official Language
                  </div>
                  <div style={{ paddingTop: 8 }}>
                    {folGroups.map(g => g.value !== null && (
                      <div key={g.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                        <span style={{ color: '#374151' }}>{g.label}</span>
                        <span style={{ fontWeight: 600, color: '#111827' }}>
                          {g.value!.toLocaleString()}
                          {submitted > 0 && (
                            <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: 6, fontSize: 12 }}>
                              {((g.value! / submitted) * 100).toFixed(1)}%
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                    <p style={{ margin: '8px 0 0', fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>
                      Applicants' first official language as declared. Suppressed (&lt;5) shown as —.
                    </p>
                  </div>
                </>
              )}

              {cafIn != null && cafIn > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '24px 0 4px' }}>
                    CAF Members
                  </div>
                  <div style={{ paddingTop: 12 }}>
                    <FunnelBar label="CAF Members" value={cafIn} total={submitted} color="#6b7280" />
                    <p style={{ margin: '-8px 0 8px', fontSize: 11, color: '#9ca3af', lineHeight: 1.4 }}>
                      Canadian Armed Forces members who participated in this process. Not a count of appointments.
                    </p>
                  </div>
                </>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
