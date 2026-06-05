import React, { useState, useEffect } from 'react';
import { useLang } from '../i18n.jsx';

export default function Settings({ onLogout }) {
  const { t } = useLang();
  const [weeklyBudget, setWeeklyBudget] = useState('');
  const [analysisPrompt, setAnalysisPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/settings/public')
      .then((r) => r.json())
      .then((d) => {
        if (d.weeklyBudget) setWeeklyBudget(String(d.weeklyBudget));
        if (d.analysisPrompt) setAnalysisPrompt(d.analysisPrompt);
        if (d.defaultPrompt) setDefaultPrompt(d.defaultPrompt);
      });
  }, []);

  const flash = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(''), 4000); };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeklyBudget: parseFloat(weeklyBudget) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      flash(t('settingsSaved'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePrompt = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisPrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      flash('Analysis prompt saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) { setError(t('passwordMismatch')); return; }
    if (newPassword.length < 6) { setError(t('passwordTooShort')); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewPassword(''); setConfirmPassword('');
      flash(t('passwordChanged'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    onLogout();
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('settingsPage')}</h1>
        <p className="page-subtitle">{t('settingsSubtitle')}</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* ── Analysis Prompt ─────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">🧠 Analysis Prompt</div>
        </div>
        <div className="card-body">
          <p style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 12 }}>
            Define what the AI should focus on when analysing a rota. Be specific about rules, priorities and what to flag.
          </p>
          <form onSubmit={handleSavePrompt}>
            <div className="form-group">
              <textarea
                className="form-input"
                value={analysisPrompt}
                onChange={(e) => setAnalysisPrompt(e.target.value)}
                rows={8}
                style={{ fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
                placeholder="e.g. Focus on lunch hour coverage (12:00-14:00). Flag anyone working more than 6 hours without a break. Ensure at least one keyholder per shift..."
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <><span className="spinner" />Saving...</> : 'Save Prompt'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAnalysisPrompt(defaultPrompt)}
              >
                Reset to default
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-header"><div className="card-title">{t('weeklyBudgetSection')}</div></div>
          <div className="card-body">
            <form onSubmit={handleSaveSettings}>
              <div className="form-group">
                <label className="form-label">{t('weeklyBudgetLabel')}</label>
                <input className="form-input" type="number" placeholder={t('weeklyBudgetPlaceholder')} min="0" step="0.5" value={weeklyBudget} onChange={(e) => setWeeklyBudget(e.target.value)} />
                <span className="form-hint">{t('weeklyBudgetHint')}</span>
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <><span className="spinner" />{t('saving')}</> : t('saveButton')}
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title">{t('passwordSection')}</div></div>
          <div className="card-body">
            <form onSubmit={handleChangePassword}>
              <div className="form-group">
                <label className="form-label">{t('newPassword')}</label>
                <input className="form-input" type="password" placeholder={t('newPasswordPlaceholder')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
              </div>
              <div className="form-group">
                <label className="form-label">{t('confirmPassword')}</label>
                <input className="form-input" type="password" placeholder={t('confirmPasswordPlaceholder')} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <><span className="spinner" />{t('saving')}</> : t('changePassword')}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('logoutSection')}</div>
              <div style={{ color: 'var(--gray-500)', fontSize: 13 }}>{t('logoutDesc')}</div>
            </div>
            <button className="btn btn-danger" onClick={handleLogout}>{t('logoutButton')}</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-body">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('deployTitle')}</div>
          <div style={{ color: 'var(--gray-600)', fontSize: 13, lineHeight: 1.7 }}>
            <p>{t('deployDesc')}</p>
            <ul style={{ marginTop: 8, marginLeft: 20 }}>
              {['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ANTHROPIC_API_KEY', 'SESSION_SECRET', 'DB_PATH'].map((v) => (
                <li key={v}><code style={{ background: 'var(--gray-100)', padding: '1px 4px', borderRadius: 4 }}>{v}</code></li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
