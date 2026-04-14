import { Outlet, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageToggle from './LanguageToggle';

const NAV_LINKS = [
  { to: '/', key: 'nav.staffing', end: true },
  { to: '/department', key: 'nav.department' },
  { to: '/query', key: 'nav.query' },
  { to: '/process', key: 'nav.process' },
];

const SIDEBAR_WIDTH = 220;
const HEADER_HEIGHT = 56;

const styles: Record<string, React.CSSProperties> = {
  header: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    background: '#1d3557',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    zIndex: 100,
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '0.01em',
    margin: 0,
  },
  subtitle: {
    fontSize: 11,
    fontWeight: 400,
    opacity: 0.75,
    display: 'block',
  },
  sidebar: {
    position: 'fixed',
    top: HEADER_HEIGHT,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    background: '#f7f8fa',
    borderRight: '1px solid #e2e6ea',
    paddingTop: 16,
    overflowY: 'auto',
    zIndex: 90,
  },
  nav: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  main: {
    marginTop: HEADER_HEIGHT,
    marginLeft: SIDEBAR_WIDTH,
    padding: 32,
    minHeight: `calc(100vh - ${HEADER_HEIGHT}px)`,
    background: '#fff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#111827',
  },
};

export default function AppShell() {
  const { t } = useTranslation();

  return (
    <>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>
            PSC Data Explorer
            <span style={styles.subtitle}>Public Service Commission of Canada</span>
          </h1>
        </div>
        <LanguageToggle />
      </header>

      <aside style={styles.sidebar}>
        <nav aria-label="Main navigation">
          <ul style={styles.nav}>
            {NAV_LINKS.map(link => (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  end={link.end}
                  style={({ isActive }) => ({
                    display: 'block',
                    padding: '10px 20px',
                    color: isActive ? '#1d3557' : '#495057',
                    background: isActive ? '#dce8f5' : 'transparent',
                    textDecoration: 'none',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 14,
                    borderLeft: isActive ? '3px solid #1d3557' : '3px solid transparent',
                    transition: 'background 0.15s',
                  })}
                >
                  {t(link.key)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main style={styles.main}>
        <Outlet />
      </main>
    </>
  );
}
