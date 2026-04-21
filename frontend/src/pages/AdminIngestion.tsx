import { useTranslation } from 'react-i18next';
import { useIngestStatus, useIngestTrigger } from '../api/ingestion';
import IngestPanel from '../components/ingestion/IngestPanel';
import LoadingSpinner from '../components/common/LoadingSpinner';
import type { IngestLog } from '../types';

const DATASETS = [
  { key: 'advertisements',    title: 'Public Service Staffing Advertisements' },
  { key: 'staffing_dashboard', title: 'Staffing Dashboard' },
  { key: 'tbs_population',    title: 'TBS Federal Public Service Statistics' },
  { key: 'snps',              title: 'Staffing and Non-Partisanship Survey (2021, 2023, 2025)' },
];

const statusBadge = (status: string): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    running: { bg: '#cce5ff', color: '#004085' },
    success: { bg: '#d4edda', color: '#155724' },
    error: { bg: '#f8d7da', color: '#721c24' },
    pending: { bg: '#fff3cd', color: '#856404' },
  };
  const c = colors[status] ?? { bg: '#e9ecef', color: '#495057' };
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    background: c.bg,
    color: c.color,
    whiteSpace: 'nowrap',
  };
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #dee2e6',
  fontSize: 13,
  color: '#495057',
};

const thStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#f1f3f5',
  borderBottom: '2px solid #dee2e6',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 600,
  color: '#343a40',
};

function LogRow({ log }: { log: IngestLog }) {
  return (
    <tr>
      <td style={tdStyle}>{log.dataset_key}</td>
      <td style={tdStyle} title={log.resource_name}>
        <span style={{ maxWidth: 200, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {log.resource_name}
        </span>
      </td>
      <td style={tdStyle}>
        <span style={statusBadge(log.status)}>{log.status}</span>
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>
        {log.rows_loaded?.toLocaleString() ?? '—'}
      </td>
      <td style={tdStyle}>
        {log.started_at ? new Date(log.started_at).toLocaleString() : '—'}
      </td>
      <td style={{ ...tdStyle, color: '#dc3545', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {log.error_message ?? ''}
      </td>
    </tr>
  );
}

export default function AdminIngestion() {
  const { t } = useTranslation();
  const trigger = useIngestTrigger();
  // Refetch every 3s to show live progress
  const statusQ = useIngestStatus(3000);

  const logs = statusQ.data ?? [];

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>{t('ingestion.title')}</h2>
      <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: 13 }}>{t('ingestion.subtitle')}</p>

      <button
        onClick={() => trigger.mutate('all')}
        disabled={trigger.isPending}
        style={{
          padding: '10px 24px',
          borderRadius: 4,
          border: 'none',
          background: trigger.isPending ? '#adb5bd' : '#1d3557',
          color: '#fff',
          cursor: trigger.isPending ? 'not-allowed' : 'pointer',
          fontSize: 15,
          fontWeight: 700,
          marginBottom: 28,
        }}
      >
        {trigger.isPending ? t('common.loading') : t('ingestion.ingestAll')}
      </button>

      {/* Per-dataset cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 36,
        }}
      >
        {DATASETS.map(ds => {
          const lastLog = logs.find(l => l.dataset_key === ds.key && l.status === 'success');
          return (
            <IngestPanel
              key={ds.key}
              datasetKey={ds.key}
              title={ds.title}
              lastIngested={lastLog?.finished_at}
              status={logs.find(l => l.dataset_key === ds.key)?.status}
            />
          );
        })}
      </div>

      {/* Ingestion log table */}
      <h3 style={{ color: '#1d3557', marginBottom: 12 }}>{t('ingestion.log')}</h3>

      {statusQ.isLoading && <LoadingSpinner />}

      {logs.length === 0 && !statusQ.isLoading && (
        <p style={{ color: '#6c757d' }}>No ingestion history yet.</p>
      )}

      {logs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={thStyle}>Dataset</th>
                <th style={thStyle}>Resource</th>
                <th style={thStyle}>{t('ingestion.status')}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{t('ingestion.rowsLoaded')}</th>
                <th style={thStyle}>Started</th>
                <th style={thStyle}>Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => <LogRow key={i} log={log} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
