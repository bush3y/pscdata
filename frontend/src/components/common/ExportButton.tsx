import { useTranslation } from 'react-i18next';

interface ExportButtonProps {
  endpoint: string;
  params?: Record<string, string | string[]>;
}

export default function ExportButton({ endpoint, params }: ExportButtonProps) {
  const { t } = useTranslation();

  const handleExport = () => {
    const base = `/api/v1${endpoint}`;
    const search = new URLSearchParams();
    search.set('format', 'csv');
    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (Array.isArray(val)) {
          val.forEach(v => search.append(key, v));
        } else if (val) {
          search.set(key, val);
        }
      }
    }
    window.location.href = `${base}?${search.toString()}`;
  };

  const btnStyle: React.CSSProperties = {
    padding: '6px 16px',
    border: '1px solid #28a745',
    borderRadius: 4,
    background: '#fff',
    color: '#28a745',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  };

  return (
    <button style={btnStyle} onClick={handleExport}>
      {t('query.export')}
    </button>
  );
}
