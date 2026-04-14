import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
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
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function AppShell() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close drawer on navigation
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  // Prevent body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  const navLinks = (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {NAV_LINKS.map(link => (
        <li key={link.to}>
          <NavLink
            to={link.to}
            end={link.end}
            style={({ isActive }) => ({
              display: 'block',
              padding: isMobile ? '14px 24px' : '10px 20px',
              color: isActive ? '#1d3557' : '#495057',
              background: isActive ? '#dce8f5' : 'transparent',
              textDecoration: 'none',
              fontWeight: isActive ? 600 : 400,
              fontSize: isMobile ? 15 : 14,
              borderLeft: isActive ? '3px solid #1d3557' : '3px solid transparent',
              transition: 'background 0.15s',
            })}
          >
            {t(link.key)}
          </NavLink>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {/* ── Header ── */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: HEADER_HEIGHT,
        background: '#1d3557', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px 0 20px',
        zIndex: 100,
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isMobile && (
            <button
              onClick={() => setDrawerOpen(o => !o)}
              aria-label="Toggle navigation"
              style={{
                background: 'none', border: 'none', color: '#fff',
                cursor: 'pointer', padding: 6, display: 'flex',
                flexDirection: 'column', gap: 5, flexShrink: 0,
              }}
            >
              <span style={{ display: 'block', width: 22, height: 2, background: '#fff', borderRadius: 2 }} />
              <span style={{ display: 'block', width: 22, height: 2, background: '#fff', borderRadius: 2 }} />
              <span style={{ display: 'block', width: 22, height: 2, background: '#fff', borderRadius: 2 }} />
            </button>
          )}
          <h1 style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700, letterSpacing: '0.01em', margin: 0 }}>
            PSC Data Explorer
            {!isMobile && (
              <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.75, display: 'block' }}>
                Public Service Commission of Canada
              </span>
            )}
          </h1>
        </div>
        <LanguageToggle />
      </header>

      {/* ── Desktop sidebar ── */}
      {!isMobile && (
        <aside style={{
          position: 'fixed', top: HEADER_HEIGHT, left: 0, bottom: 0,
          width: SIDEBAR_WIDTH,
          background: '#f7f8fa', borderRight: '1px solid #e2e6ea',
          paddingTop: 16, overflowY: 'auto', zIndex: 90,
        }}>
          <nav aria-label="Main navigation">{navLinks}</nav>
        </aside>
      )}

      {/* ── Mobile drawer overlay ── */}
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 150, transition: 'opacity 0.2s',
          }}
        />
      )}

      {/* ── Mobile drawer ── */}
      {isMobile && (
        <aside style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: 260,
          background: '#fff', borderRight: '1px solid #e2e6ea',
          zIndex: 200,
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
          display: 'flex', flexDirection: 'column',
          boxShadow: drawerOpen ? '4px 0 20px rgba(0,0,0,0.15)' : 'none',
        }}>
          <div style={{
            height: HEADER_HEIGHT, background: '#1d3557',
            display: 'flex', alignItems: 'center', padding: '0 20px',
            flexShrink: 0,
          }}>
            <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>Navigation</span>
          </div>
          <nav aria-label="Main navigation" style={{ paddingTop: 8 }}>{navLinks}</nav>
        </aside>
      )}

      {/* ── Main content ── */}
      <main style={{
        marginTop: HEADER_HEIGHT,
        marginLeft: isMobile ? 0 : SIDEBAR_WIDTH,
        padding: isMobile ? 16 : 32,
        minHeight: `calc(100vh - ${HEADER_HEIGHT}px)`,
        background: '#fff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: '#111827',
      }}>
        <Outlet />
      </main>
    </>
  );
}
