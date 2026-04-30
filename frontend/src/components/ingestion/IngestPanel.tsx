import { useTranslation } from 'react-i18next';
import { useIngestTrigger } from '../../api/ingestion';

interface IngestPanelProps {
  datasetKey: string;
  title: string;
  lastIngested?: string | null;
  status?: string | null;
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #dee2e6',
  borderRadius: 8,
  padding: '16px 20px',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const badgeStyle = (status: string | null | undefined): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    running: { bg: '#cce5ff', color: '#004085' },
    success: { bg: '#d4edda', color: '#155724' },
    error: { bg: '#f8d7da', color: '#721c24' },
    pending: { bg: '#fff3cd', color: '#856404' },
  };
  const c = colors[status ?? ''] ?? { bg: '#e9ecef', color: '#495057' };
  return {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    background: c.bg,
    color: c.color,
    marginBottom: 8,
  };
};

export default function IngestPanel({ datasetKey, title, lastIngested, status }: IngestPanelProps) {
  const { t } = useTranslation();
  const trigger = useIngestTrigger();

  const handleRefresh = () => {
    trigger.mutate([datasetKey]);
  };

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 8 }}>
        {status && <span style={badgeStyle(status)}>{t(`ingestion.${status}` as const, status)}</span>}
        <h4 style={{ margin: 0, fontSize: 15, color: '#1d3557' }}>{title}</h4>
      </div>
      {lastIngested && (
        <p style={{ margin: '4px 0 12px', fontSize: 12, color: '#6c757d' }}>
          {t('datasets.lastIngested')}: {new Date(lastIngested).toLocaleString()}
        </p>
      )}
      {!lastIngested && (
        <p style={{ margin: '4px 0 12px', fontSize: 12, color: '#adb5bd' }}>Never ingested</p>
      )}
      <button
        onClick={handleRefresh}
        disabled={trigger.isPending}
        style={{
          padding: '6px 14px',
          borderRadius: 4,
          border: 'none',
          background: trigger.isPending ? '#adb5bd' : '#1d3557',
          color: '#fff',
          cursor: trigger.isPending ? 'not-allowed' : 'pointer',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {trigger.isPending ? t('common.loading') : t('datasets.ingest')}
      </button>

      {trigger.isError && (
        <div style={{
          color: '#991b1b',
          fontSize: 12,
          marginTop: 8,
          padding: '6px 10px',
          background: '#fef2f2',
          borderRadius: 4,
          border: '1px solid #fecaca',
        }}>
          Failed —{' '}
          {trigger.error instanceof Error ? trigger.error.message : 'network error'}
        </div>
      )}
    </div>
  );
}
