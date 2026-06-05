import React from 'react';
import { useLang } from '../i18n.jsx';

const navItems = [
  { id: 'analyze', icon: '📋', key: 'navAnalyze' },
  { id: 'employees', icon: '👥', key: 'navEmployees' },
  { id: 'history', icon: '🕐', key: 'navHistory' },
  { id: 'settings', icon: '⚙️', key: 'navSettings' },
];

export default function Layout({ page, onNavigate, username, children }) {
  const { lang, setLang, t } = useLang();

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">📋</div>
          <div className="sidebar-title">{t('appName')}</div>
          <div className="sidebar-subtitle">{t('appSubtitle')}</div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {t(item.key)}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div style={{ color: '#6b7280', fontSize: 12, padding: '4px 12px', marginBottom: 8 }}>
            {t('loggedInAs')}: <strong style={{ color: '#9ca3af' }}>{username}</strong>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '0 12px' }}>
            <button
              onClick={() => setLang('hu')}
              style={{
                background: lang === 'hu' ? 'var(--primary)' : 'rgba(255,255,255,.1)',
                color: lang === 'hu' ? 'white' : '#9ca3af',
                border: 'none', borderRadius: 6, padding: '4px 10px',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s',
              }}
            >
              HU
            </button>
            <button
              onClick={() => setLang('en')}
              style={{
                background: lang === 'en' ? 'var(--primary)' : 'rgba(255,255,255,.1)',
                color: lang === 'en' ? 'white' : '#9ca3af',
                border: 'none', borderRadius: 6, padding: '4px 10px',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s',
              }}
            >
              EN
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
