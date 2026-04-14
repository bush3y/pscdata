import { useTranslation } from 'react-i18next';
import { useDatasets } from '../api/datasets';
import { useIngestTrigger } from '../api/ingestion';
import LoadingSpinner from '../components/common/LoadingSpinner';
import type { DatasetMeta } from '../types';

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 20,
  marginTop: 24,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid #dee2e6',
  borderRadius: 8,
  padding: '20px 24px',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const freqBadge: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 12,
  fontSize: 11,
  fontWeight: 600,
  background: '#dce8f5',
  color: '#1d3557',
};

function DatasetCard({ ds }: { ds: DatasetMeta }) {
  const { t, i18n } = useTranslation();
  const trigger = useIngestTrigger();
  const lang = i18n.language.startsWith('fr') ? 'fr' : 'en';
  const title = lang === 'fr' && ds.title_fr ? ds.title_fr : ds.title_en;

  return (
    <div style={cardStyle}>
      <div>
        {ds.frequency && <span style={freqBadge}>{ds.frequency}</span>}
        <h3 style={{ margin: '8px 0 4px', fontSize: 15, color: '#1d3557' }}>{title}</h3>
        <p style={{ margin: 0, fontSize: 12, color: '#6c757d', fontFamily: 'monospace' }}>
          {ds.dataset_key}
        </p>
      </div>

      <div style={{ fontSize: 13, color: '#495057' }}>
        {ds.last_ingested_at ? (
          <span>{t('datasets.lastIngested')}: {new Date(ds.last_ingested_at).toLocaleDateString()}</span>
        ) : (
          <span style={{ color: '#adb5bd' }}>Not yet ingested</span>
        )}
        {ds.total_records != null && (
          <span style={{ marginLeft: 12 }}>
            {ds.total_records.toLocaleString()} {t('datasets.records')}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {ds.source_url && (
          <a
            href={ds.source_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: '#1d3557' }}
          >
            {t('datasets.viewSource')} ↗
          </a>
        )}
        <button
          onClick={() => trigger.mutate([ds.dataset_key])}
          disabled={trigger.isPending}
          style={{
            marginLeft: 'auto',
            padding: '5px 12px',
            borderRadius: 4,
            border: 'none',
            background: '#1d3557',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {trigger.isPending ? '...' : t('datasets.ingest')}
        </button>
      </div>
    </div>
  );
}

export default function DatasetBrowser() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useDatasets();

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', color: '#1d3557' }}>{t('datasets.title')}</h2>
      <p style={{ margin: '0 0 8px', color: '#6c757d' }}>{t('datasets.subtitle')}</p>

      {isLoading && <LoadingSpinner />}
      {isError && (
        <div style={{ color: '#721c24', background: '#f8d7da', padding: 12, borderRadius: 6 }}>
          {t('common.error')}
        </div>
      )}

      {data && (
        <div style={gridStyle}>
          {data.map(ds => <DatasetCard key={ds.dataset_id} ds={ds} />)}
        </div>
      )}

      {data && data.length === 0 && (
        <p style={{ color: '#6c757d', marginTop: 24 }}>{t('common.noData')}</p>
      )}
    </div>
  );
}
