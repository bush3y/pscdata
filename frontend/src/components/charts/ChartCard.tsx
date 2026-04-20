import { useState } from 'react';

interface ColDef { key: string; label: string }

interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tableData?: Record<string, unknown>[];
  tableColumns?: ColDef[];
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #dee2e6',
  borderRadius: 8,
  padding: '20px 24px',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  marginBottom: 24,
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: '#111827',
  margin: '0 0 4px 0',
  letterSpacing: '-0.01em',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  margin: '0 0 16px 0',
};

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

export default function ChartCard({ title, subtitle, children, tableData, tableColumns }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);

  // Derive columns from data keys if not provided
  const cols: ColDef[] = tableColumns ?? (
    tableData && tableData.length
      ? Object.keys(tableData[0]).map(k => ({ key: k, label: k }))
      : []
  );

  return (
    <div style={cardStyle}>
      <h3 style={titleStyle}>{title}</h3>
      {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
      <div role="img" aria-label={title}>{children}</div>
      {tableData && tableData.length > 0 && (
        <>
          <button
            onClick={() => setShowTable(s => !s)}
            style={{
              marginTop: 12, padding: '4px 12px',
              fontSize: 12, cursor: 'pointer',
              background: 'none', border: '1px solid #d1d5db',
              borderRadius: 4, color: '#6b7280',
            }}
          >
            {showTable ? 'Hide data' : 'Show data'}
          </button>
          {showTable && (
            <div style={{ overflowX: 'auto', marginTop: 10, WebkitOverflowScrolling: 'touch' as never }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    {cols.map(c => (
                      <th key={c.key} style={{
                        textAlign: 'left', padding: '5px 10px',
                        background: '#f8f9fa', borderBottom: '1px solid #dee2e6',
                        fontWeight: 600, color: '#374151', whiteSpace: 'nowrap',
                      }}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 1 ? '#f9fafb' : '#fff' }}>
                      {cols.map(c => (
                        <td key={c.key} style={{
                          padding: '5px 10px', borderBottom: '1px solid #f3f4f6',
                          color: '#374151', whiteSpace: 'nowrap',
                        }}>{fmt(row[c.key])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
