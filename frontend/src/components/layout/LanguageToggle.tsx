import { useTranslation } from 'react-i18next';

export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = i18n.language.startsWith('fr') ? 'fr' : 'en';
  const next = current === 'en' ? 'fr' : 'en';

  const handleToggle = () => {
    i18n.changeLanguage(next);
    localStorage.setItem('lang', next);
  };

  const btnStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.6)',
    color: '#fff',
    borderRadius: 4,
    padding: '4px 12px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.04em',
  };

  return (
    <button style={btnStyle} onClick={handleToggle} aria-label="Toggle language">
      {next.toUpperCase()}
    </button>
  );
}
