import React, { useState, useEffect } from 'react';
import { useLang } from '../i18n.jsx';

export default function History() {
  const { t } = useLang();
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analyses');
      setAnalyses(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openDetail = async (id) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/analyses/${id}`);
      const data = await res.json();
      setSelected(data.result);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm(t('deleteConfirm'))) return;
    await fetch(`/api/analyses/${id}`, { method: 'DELETE' });
    load();
    if (selected) setSelected(null);
  };

  const formatDate = (s) => {
    if (!s) return '–';
    return new Date(s + 'Z').toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (selected) {
    const { employees = [], violations = [], suggestions = [], summary } = selected;
    const overCount = employees.filter((e) => e.status === 'over').length;
    const underCount = employees.filter((e) => e.status === 'under').length;

    return (
      <div>
        <div className="page-header">
          <button className="btn btn-secondary btn-sm" onClick={() => setSelected(null)} style={{ marginBottom: 12 }}>{t('historyBack')}</button>
          <h1 className="page-title">{selected.weekLabel || t('unnamed')}</h1>
        </div>

        {summary && <div className="alert alert-info">{summary}</div>}

        <div className="result-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-label">{t('historyPlanned')}</div>
            <div className="stat-value">{selected.totalScheduledHours ?? '?'} h</div>
            <div className="stat-sub">{t('historyBudget')}: {selected.approvedBudget ?? '?'} h</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('historyViolations')}</div>
            <div className="stat-value" style={{ color: violations.length > 0 ? 'var(--danger)' : 'var(--success)' }}>{violations.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('historyOverUnder')}</div>
            <div className="stat-value">{overCount} / {underCount}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-title">{t('resultEmployeeDetails')}</div></div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>{t('colName')}</th><th>{t('colScheduled')}</th><th>{t('colContracted')}</th><th>{t('colDiff')}</th><th>{t('colStatus')}</th></tr>
              </thead>
              <tbody>
                {employees.map((emp, i) => (
                  <tr key={i}>
                    <td><strong>{emp.name}</strong></td>
                    <td>{emp.scheduledHours ?? '?'} h</td>
                    <td>{emp.contractedHours ?? '?'} h</td>
                    <td style={{ color: (emp.difference ?? 0) > 0 ? 'var(--danger)' : (emp.difference ?? 0) < 0 ? 'var(--warning)' : 'var(--success)', fontWeight: 600 }}>
                      {emp.difference != null ? ((emp.difference > 0 ? '+' : '') + emp.difference.toFixed(1) + ' h') : '–'}
                    </td>
                    <td>
                      {emp.status === 'ok' && <span className="badge badge-ok">{t('badgeOk')}</span>}
                      {emp.status === 'over' && <span className="badge badge-over">{t('badgeOver')}</span>}
                      {emp.status === 'under' && <span className="badge badge-under">{t('badgeUnder')}</span>}
                      {emp.status === 'not_found' && <span className="badge badge-neutral">{t('badgeNotFound')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="two-col">
          <div className="card">
            <div className="card-header"><div className="card-title">{t('violationsTitle')}</div></div>
            <div className="card-body">
              {violations.length === 0
                ? <div className="alert alert-success">{t('noViolations')}</div>
                : <ul className="violations-list">{violations.map((v, i) => <li key={i}><span>⚠️</span> {v}</li>)}</ul>}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><div className="card-title">{t('suggestionsTitle')}</div></div>
            <div className="card-body">
              {suggestions.length === 0
                ? <div style={{ color: 'var(--gray-400)', fontSize: 13 }}>{t('noSuggestions')}</div>
                : <ul className="suggestions-list">{suggestions.map((s, i) => <li key={i}><span>💡</span> {s}</li>)}</ul>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('historyPage')}</h1>
        <p className="page-subtitle">{t('historySubtitle')}</p>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading-overlay"><div className="spinner spinner-dark" />{t('historyLoading')}</div>
        ) : detailLoading ? (
          <div className="loading-overlay"><div className="spinner spinner-dark" />{t('historyDetailLoading')}</div>
        ) : analyses.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🕐</div>
            <div className="empty-state-text" style={{ whiteSpace: 'pre-line' }}>{t('historyEmpty')}</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr><th>{t('colWeek')}</th><th>{t('colFile')}</th><th>{t('colDate')}</th><th style={{ width: 130 }}>{t('colActions')}</th></tr>
              </thead>
              <tbody>
                {analyses.map((a) => (
                  <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(a.id)}>
                    <td><strong>{a.week_label || '–'}</strong></td>
                    <td style={{ color: 'var(--gray-500)', fontSize: 13 }}>{a.filename || '–'}</td>
                    <td style={{ color: 'var(--gray-500)', fontSize: 13 }}>{formatDate(a.created_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openDetail(a.id)}>{t('viewButton')}</button>
                        <button className="btn btn-danger btn-sm" onClick={(e) => handleDelete(a.id, e)}>{t('deleteButton')}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
