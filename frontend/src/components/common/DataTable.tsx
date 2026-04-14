import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type ColSpec = string | { key: string; label: string };

interface DataTableProps {
  data: Record<string, unknown>[];
  columns?: ColSpec[];
  pageSize?: number;
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  background: '#f1f3f5',
  border: '1px solid #dee2e6',
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  color: '#343a40',
};

const tdStyle: React.CSSProperties = {
  border: '1px solid #dee2e6',
  padding: '6px 10px',
  color: '#495057',
  maxWidth: 240,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const paginationStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 12,
  fontSize: 13,
  color: '#6c757d',
};

const btnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '4px 12px',
  border: '1px solid #ced4da',
  borderRadius: 4,
  background: disabled ? '#f8f9fa' : '#fff',
  cursor: disabled ? 'not-allowed' : 'pointer',
  color: disabled ? '#adb5bd' : '#495057',
});

export default function DataTable({ data, columns, pageSize = 50 }: DataTableProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);

  if (!data || data.length === 0) {
    return (
      <p style={{ color: '#6c757d', padding: 16 }}>{t('common.noData')}</p>
    );
  }

  const colDefs: { key: string; label: string }[] = (
    columns ?? Object.keys(data[0]).map(k => ({ key: k, label: k }))
  ).map(c => typeof c === 'string' ? { key: c, label: c } : c);

  const totalPages = Math.ceil(data.length / pageSize);
  const pageData = data.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {colDefs.map(col => (
              <th key={col.key} style={thStyle}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageData.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f8f9fa' }}>
              {colDefs.map(col => (
                <td key={col.key} style={tdStyle} title={String(row[col.key] ?? '')}>
                  {row[col.key] === null || row[col.key] === undefined ? '—' : String(row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={paginationStyle}>
          <button
            style={btnStyle(page === 0)}
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span>Page {page + 1} of {totalPages} ({data.length} rows)</span>
          <button
            style={btnStyle(page >= totalPages - 1)}
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
