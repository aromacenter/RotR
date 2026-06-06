import React, { useState, useRef, useEffect } from 'react';
import { useLang } from '../i18n.jsx';
import PrintView from './PrintView.jsx';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

function StatusBadge({ status }) {
  const { t } = useLang();
  if (status === 'ok') return <span className="badge badge-ok">{t('badgeOk')}</span>;
  if (status === 'over') return <span className="badge badge-over">{t('badgeOver')}</span>;
  if (status === 'under') return <span className="badge badge-under">{t('badgeUnder')}</span>;
  return <span className="badge badge-neutral">{t('badgeNotFound')}</span>;
}

function AnalysisResult({ result, employees, onClose }) {
  const { t } = useLang();
  const [showPrint, setShowPrint] = React.useState(false);
  const { employees: empResults = [], violations = [], suggestions = [], summary, narrative } = result;

  if (showPrint) {
    return <PrintView analysis={result} employees={employees} onClose={() => setShowPrint(false)} />;
  }
  const totalScheduled = result.totalScheduledHours ?? 0;
  const budget = result.approvedBudget ?? 0;
  const budgetStatus = result.budgetStatus ?? 'ok';
  const overCount = empResults.filter((e) => e.status === 'over').length;
  const underCount = empResults.filter((e) => e.status === 'under').length;
  const okCount = empResults.filter((e) => e.status === 'ok').length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>
          {t('resultTitle')}{result.weekLabel ? ` – ${result.weekLabel}` : ''}
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowPrint(true)}>🖨️ Print / Hardcopy</button>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>{t('analyzeNewAnalysis')}</button>
        </div>
      </div>

      {narrative && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid var(--primary)' }}>
          <div className="card-header"><div className="card-title">📝 Analysis & Recommendations</div></div>
          <div className="card-body">
            <div
              style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--gray-700)' }}
              dangerouslySetInnerHTML={{ __html: marked.parse(narrative) }}
            />
          </div>
        </div>
      )}
      {!narrative && summary && (
        <div className="alert alert-info" style={{ marginBottom: 24 }}>
          <strong>{t('resultSummaryLabel')}:</strong> {summary}
        </div>
      )}

      <div className="result-grid">
        <div className="stat-card">
          <div className="stat-label">{t('resultPlanned')}</div>
          <div className="stat-value" style={{ color: budgetStatus === 'over' ? 'var(--danger)' : 'var(--gray-900)' }}>{totalScheduled} h</div>
          <div className="stat-sub">{t('resultBudget')}: {budget} h</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('resultBudgetDiff')}</div>
          <div className="stat-value" style={{ color: budgetStatus === 'over' ? 'var(--danger)' : budgetStatus === 'under' ? 'var(--warning)' : 'var(--success)' }}>
            {totalScheduled - budget > 0 ? '+' : ''}{(totalScheduled - budget).toFixed(1)} h
          </div>
          <div className="stat-sub">{budgetStatus === 'ok' ? t('resultWithinBudget') : budgetStatus === 'over' ? t('resultOverBudget') : t('resultUnderBudget')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('resultEmployeeCount')}</div>
          <div className="stat-value">{employees.length}</div>
          <div className="stat-sub">{t('resultIdentified')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('resultStatus')}</div>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {okCount > 0 && <span className="badge badge-ok">✓ {t('resultOk')}: {okCount}</span>}
            {overCount > 0 && <span className="badge badge-over">↑ {t('resultOver')}: {overCount}</span>}
            {underCount > 0 && <span className="badge badge-under">↓ {t('resultUnder')}: {underCount}</span>}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header"><div className="card-title">{t('resultEmployeeDetails')}</div></div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>{t('colName')}</th>
                <th>{t('colScheduled')}</th>
                <th>{t('colContracted')}</th>
                <th>{t('colDiff')}</th>
                <th>{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {empResults.map((emp, i) => (
                <tr key={i} className={`employee-row-${emp.status}`}>
                  <td><strong>{emp.name}</strong></td>
                  <td>{emp.scheduledHours ?? '?'} h</td>
                  <td>{emp.contractedHours ?? '?'} h</td>
                  <td style={{ color: emp.difference > 0 ? 'var(--danger)' : emp.difference < 0 ? 'var(--warning)' : 'var(--success)', fontWeight: 600 }}>
                    {emp.difference != null ? (emp.difference > 0 ? '+' : '') + emp.difference.toFixed(1) + ' h' : '–'}
                  </td>
                  <td><StatusBadge status={emp.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-header"><div className="card-title">{t('violationsTitle')} ({violations.length})</div></div>
          <div className="card-body">
            {violations.length === 0
              ? <div className="alert alert-success">{t('noViolations')}</div>
              : <ul className="violations-list">{violations.map((v, i) => <li key={i}><span>⚠️</span> {v}</li>)}</ul>}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div className="card-title">{t('suggestionsTitle')} ({suggestions.length})</div></div>
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

export default function Analyze() {
  const { t, lang } = useLang();
  const [employees, setEmployees] = useState([]);
  const [settings, setSettings] = useState({ weeklyBudget: 0 });
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [weekLabel, setWeekLabel] = useState('');
  const [customBudget, setCustomBudget] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [empListOpen, setEmpListOpen] = useState(true);
  const [progressStep, setProgressStep] = useState('');
  const fileRef = useRef();

  const PROGRESS_STEPS = [
    t('analyzeProgressStep1') || 'Reading PDF…',
    t('analyzeProgressStep2') || 'Parsing schedule…',
    t('analyzeProgressStep3') || 'Comparing hours to contracts…',
    t('analyzeProgressStep4') || 'Generating analysis…',
  ];

  useEffect(() => {
    if (!loading) { setProgressStep(''); return; }
    let i = 0;
    setProgressStep(PROGRESS_STEPS[0]);
    const id = setInterval(() => {
      i = (i + 1) % PROGRESS_STEPS.length;
      setProgressStep(PROGRESS_STEPS[i]);
    }, 2200);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    fetch('/api/employees').then((r) => r.json()).then(setEmployees).catch(() => {});
    fetch('/api/settings/public').then((r) => r.json()).then(setSettings).catch(() => {});
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - now.getDay() + 1);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    const locale = lang === 'en' ? 'en-GB' : 'hu-HU';
    const fmt = (d) => d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    setWeekLabel(`${monday.getFullYear()} ${fmt(monday)} – ${fmt(sunday)}`);
  }, [lang]);

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type === 'application/pdf') { setFile(dropped); setError(''); }
    else setError(t('analyzeNoPdf'));
  };

  const handleAnalyze = async () => {
    if (!file) { setError(t('analyzeNoPdf')); return; }
    if (employees.length === 0) { setError(t('analyzeNoEmp')); return; }
    setLoading(true); setError('');
    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('weekLabel', weekLabel);
    if (customBudget) formData.append('weeklyBudget', customBudget);
    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (result) return <AnalysisResult result={result} employees={employees} onClose={() => { setResult(null); setFile(null); }} />;

  const effectiveBudget = parseFloat(customBudget) || settings.weeklyBudget || 0;

  return (
    <div>
      <style>{`
        @keyframes analyzeProgressMove {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(150%); }
          100% { transform: translateX(-100%); }
        }
        .analyze-progress-bar { position: relative; }
      `}</style>
      <div className="page-header">
        <h1 className="page-title">{t('analyzePage')}</h1>
        <p className="page-subtitle">{t('analyzeSubtitle')}</p>
      </div>

      {employees.length === 0 && (
        <div className="alert alert-warning">
          {t('analyzeNoEmployees')} <strong>{t('analyzeNoEmployeesLink')}</strong> {t('analyzeNoEmployeesEnd')}
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="two-col">
        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-header"><div className="card-title">{t('analyzePdfUpload')}</div></div>
            <div className="card-body">
              <div
                className={`upload-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) { setFile(f); setError(''); } }} />
                {file ? (
                  <>
                    <div className="upload-icon">✅</div>
                    <div className="upload-filename">{file.name}</div>
                    <div className="upload-hint">({(file.size / 1024).toFixed(0)} KB) – {t('analyzePdfReplace')}</div>
                  </>
                ) : (
                  <>
                    <div className="upload-icon">📄</div>
                    <div className="upload-text">{t('analyzeDragDrop')}</div>
                    <div className="upload-hint">{t('analyzePdfHint')}</div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title">{t('analyzeParams')}</div></div>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">{t('analyzeWeekLabel')}</label>
                <input className="form-input" type="text" placeholder={t('analyzeWeekLabelPlaceholder')} value={weekLabel} onChange={(e) => setWeekLabel(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('analyzeBudgetOverride')}</label>
                <input className="form-input" type="number" placeholder={`${t('analyzeBudgetDefault')}: ${settings.weeklyBudget || 0} h`} min="0" step="0.5" value={customBudget} onChange={(e) => setCustomBudget(e.target.value)} />
                <span className="form-hint">
                  {effectiveBudget > 0 ? `${t('analyzeBudgetCurrent')}: ${effectiveBudget} h` : ''}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div
              className="card-header"
              style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => setEmpListOpen((o) => !o)}
            >
              <div className="card-title">{t('analyzeEmployeesSummary')} ({employees.length})</div>
              <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>{empListOpen ? '▲' : '▼'}</span>
            </div>
            {empListOpen && (
            <div className="card-body">
              {employees.length === 0 ? (
                <div style={{ color: 'var(--gray-400)', fontSize: 13 }}>{t('analyzeNoEmp')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {employees.map((emp) => (
                    <div key={emp.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>{emp.name}</span>
                      <span style={{ color: 'var(--gray-500)', fontWeight: 600 }}>{emp.contracted_hours} {t('analyzeContractedHours')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>

          <div className="card">
            <div className="card-body">
              <button className="btn btn-primary btn-full btn-lg" onClick={handleAnalyze} disabled={loading || !file || employees.length === 0}>
                {loading ? <><span className="spinner" />{t('analyzeRunning')}</> : t('analyzeRunButton')}
              </button>
              {loading && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--gray-200)', overflow: 'hidden' }}>
                    <div className="analyze-progress-bar" style={{
                      height: '100%',
                      width: '40%',
                      borderRadius: 4,
                      background: 'var(--primary)',
                      animation: 'analyzeProgressMove 1.4s ease-in-out infinite',
                    }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 8 }}>{progressStep}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
