import { useTranslation } from 'react-i18next';

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 36,
  height: 36,
  border: '4px solid #e9ecef',
  borderTop: '4px solid #1d3557',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 48,
  gap: 12,
  color: '#6c757d',
  fontSize: 14,
};

// Inject keyframes once
if (typeof document !== 'undefined' && !document.getElementById('psc-spinner-style')) {
  const style = document.createElement('style');
  style.id = 'psc-spinner-style';
  style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(style);
}

export default function LoadingSpinner() {
  const { t } = useTranslation();
  return (
    <div style={containerStyle}>
      <div style={spinnerStyle} role="status" aria-label={t('common.loading')} />
      <span>{t('common.loading')}</span>
    </div>
  );
}
