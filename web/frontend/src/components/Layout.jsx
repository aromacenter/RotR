import React from 'react';
import { useLang } from '../i18n.jsx';

const navItems = [
  { id: 'analyze', icon: '📋', key: 'navAnalyze' },
  { id: 'employees', icon: '👥', key: 'navEmployees' },
  { id: 'history', icon: '🕐', key: 'navHistory' },
  { id: 'settings', icon: '⚙️', key: 'navSettings' },
];

export default function Layout({ page, onNavigate, username, onLogout, sidebarData, children }) {
  const { lang, setLang, t } = useLang();
  const [parseLogOpen, setParseLogOpen] = React.useState(false);

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

        {/* Parse log tile — only shown when analysis results exist */}
        {sidebarData?.parseLog?.length > 0 && (
          <div style={{ padding: '0 8px', marginTop: 8 }}>
            <button
              onClick={() => setParseLogOpen(o => !o)}
              style={{
                width: '100%', background: parseLogOpen ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.06)',
                border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '8px 12px',
                color: '#c7d2fe', fontSize: 12, cursor: 'pointer', textAlign: 'left',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span>🔍 {t('navParseLog')}</span>
              <span style={{ fontSize: 10, color: '#6366f1' }}>{parseLogOpen ? '▲' : '▼'}</span>
            </button>
            {parseLogOpen && (
              <div style={{ background: 'rgba(0,0,0,.3)', borderRadius: 8, marginTop: 4, padding: '8px 10px', maxHeight: 260, overflowY: 'auto', fontSize: 11, color: '#94a3b8' }}>
                {(sidebarData.parseLog || []).map((entry, i) => (
                  <div key={i} style={{ marginBottom: 6, borderBottom: '1px solid rgba(255,255,255,.06)', paddingBottom: 6 }}>
                    <div style={{ fontWeight: 700, color: '#c7d2fe' }}>{entry.name}</div>
                    <div>{entry.detectedTotalHours}h · {entry.shifts?.length ?? 0} shift(s)</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AI usage tile */}
        {sidebarData?.aiUsage && (
          <div style={{ padding: '6px 8px 0' }}>
            <div style={{
              background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
              borderRadius: 8, padding: '7px 12px', fontSize: 11, color: '#6b7280',
            }}>
              <div style={{ color: '#9ca3af', fontWeight: 600, marginBottom: 3 }}>🤖 AI</div>
              <div>{sidebarData.aiUsage.model}</div>
              <div>{sidebarData.aiUsage.inputTokens?.toLocaleString()} in / {sidebarData.aiUsage.outputTokens?.toLocaleString()} out</div>
              <div style={{ color: '#6366f1', fontWeight: 700 }}>≈ ${sidebarData.aiUsage.estimatedCostUSD?.toFixed(4)}</div>
            </div>
          </div>
        )}

        <div className="sidebar-footer">
          <div style={{ color: '#6b7280', fontSize: 12, padding: '4px 12px', marginBottom: 8 }}>
            {t('loggedInAs')}: <strong style={{ color: '#9ca3af' }}>{username}</strong>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '0 12px', marginBottom: 8 }}>
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
          {onLogout && (
            <div style={{ padding: '0 12px' }}>
              <button
                onClick={onLogout}
                style={{
                  width: '100%', background: 'rgba(239,68,68,.15)', color: '#fca5a5',
                  border: '1px solid rgba(239,68,68,.25)', borderRadius: 8,
                  padding: '7px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,.28)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,.15)'; }}
              >
                🚪 {t('logoutButton')}
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
