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

// Full traceable log of exactly what raw text was read from the uploaded PDF
// for each employee, and what the parser derived from it (total hours, and
// each shift mapped to a day) - lets you check the extraction against the
// original document when something looks off.
function ParseLogPanel({ result }) {
  const [open, setOpen] = React.useState(false);
  const log = result.parseLog || [];

  const downloadLog = () => {
    const lines = [];
    lines.push(`Parse log — ${result.weekLabel || 'Rota'}`);
    if (result.headerLineFound) lines.push(`Detected header line: ${result.headerLineFound}`);
    if (Array.isArray(result.detectedDayLabels) && result.detectedDayLabels.length) {
      lines.push(`Detected day columns: ${result.detectedDayLabels.join(', ')}`);
    }
    lines.push('');
    for (const entry of log) {
      lines.push(`=== ${entry.name} ===`);
      lines.push('--- Raw text read from PDF ---');
      (entry.rawLines || []).forEach((l) => lines.push(`  ${l}`));
      lines.push(`--- Derived: total hours = ${entry.detectedTotalHours} ---`);
      if (entry.shifts && entry.shifts.length) {
        entry.shifts.forEach((s) => lines.push(`  ${s.day}: ${s.start}–${s.end} (${s.hours}h)${s.code ? ` [${s.code}]` : ''}`));
      }
      if (entry.dayOff && entry.dayOff.length) {
        entry.dayOff.forEach((d) => lines.push(`  ${d}: Day Off`));
      }
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parse-log-${(result.weekLabel || 'rota').replace(/[^\w-]+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div
        className="card-header"
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="card-title">🔍 Parse log — what was read & derived from the PDF {open ? '▲' : '▼'}</div>
        <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); downloadLog(); }}>⬇ Download log</button>
      </div>
      {open && (
        <div className="card-body" style={{ maxHeight: 480, overflowY: 'auto', fontSize: 12 }}>
          {result.headerLineFound && (
            <div style={{ marginBottom: 8, color: 'var(--gray-600)' }}>
              <strong>Detected header line:</strong> <code>{result.headerLineFound}</code>
            </div>
          )}
          {Array.isArray(result.detectedDayLabels) && result.detectedDayLabels.length > 0 && (
            <div style={{ marginBottom: 12, color: 'var(--gray-600)' }}>
              <strong>Detected day columns:</strong> {result.detectedDayLabels.join(' · ')}
            </div>
          )}
          {log.map((entry, i) => (
            <details key={i} style={{ marginBottom: 8, border: '1px solid var(--gray-100)', borderRadius: 6, padding: '6px 10px' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                {entry.name} — total {entry.detectedTotalHours}h, {entry.shifts.length} shift(s){entry.dayOff.length ? `, ${entry.dayOff.length} day off` : ''}
              </summary>
              <div style={{ marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 280px' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--gray-500)' }}>Raw text read from PDF:</div>
                  <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--gray-50)', padding: 6, borderRadius: 4, fontSize: 11 }}>
                    {(entry.rawLines || []).join('\n')}
                  </pre>
                </div>
                <div style={{ flex: '1 1 240px' }}>
                  <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--gray-500)' }}>Derived per-day data:</div>
                  <table style={{ width: '100%', fontSize: 11 }}>
                    <tbody>
                      {entry.shifts.map((s, j) => (
                        <tr key={`s${j}`}>
                          <td style={{ paddingRight: 8 }}>{s.day}</td>
                          <td>{s.start}–{s.end}</td>
                          <td style={{ textAlign: 'right' }}>{s.hours}h{s.code ? ` (${s.code})` : ''}</td>
                        </tr>
                      ))}
                      {entry.dayOff.map((d, j) => (
                        <tr key={`d${j}`}>
                          <td style={{ paddingRight: 8 }}>{d}</td>
                          <td colSpan={2} style={{ color: 'var(--gray-500)' }}>Day Off</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
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
          {result.aiUsage && (
            <div style={{ borderTop: '1px solid var(--gray-100)', padding: '8px 16px', fontSize: 12, color: 'var(--gray-500)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>🤖 {result.aiUsage.model}</span>
              <span>{result.aiUsage.inputTokens.toLocaleString()} in / {result.aiUsage.outputTokens.toLocaleString()} out tokens</span>
              <span style={{ fontWeight: 700, color: 'var(--gray-700)' }}>≈ ${result.aiUsage.estimatedCostUSD.toFixed(4)} this call</span>
              <span style={{ fontStyle: 'italic' }} title={result.aiUsage.note}>(estimated — ⓘ hover for details)</span>
            </div>
          )}
        </div>
      )}
      {Array.isArray(result.parseLog) && result.parseLog.length > 0 && (
        <ParseLogPanel result={result} />
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
  const [files, setFiles] = useState([]); // up to 7 (one per day of the week)
  const [dragOver, setDragOver] = useState(false);
  const [weekLabel, setWeekLabel] = useState('');
  const [customBudget, setCustomBudget] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [empListOpen, setEmpListOpen] = useState(false);
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
    // English financial-year week: starts Sunday, ends Saturday.
    const sundayStart = new Date(now);
    sundayStart.setDate(now.getDate() - now.getDay());
    const saturdayEnd = new Date(sundayStart); saturdayEnd.setDate(sundayStart.getDate() + 6);
    const locale = lang === 'en' ? 'en-GB' : 'hu-HU';
    const fmt = (d) => d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    setWeekLabel(`${sundayStart.getFullYear()} ${fmt(sundayStart)} – ${fmt(saturdayEnd)}`);
  }, [lang]);

  const addFiles = (list) => {
    const pdfs = Array.from(list).filter((f) => f.type === 'application/pdf');
    if (pdfs.length === 0) { setError(t('analyzeNoPdf')); return; }
    setFiles((prev) => {
      const merged = [...prev, ...pdfs].filter((f, i, arr) =>
        arr.findIndex((g) => g.name === f.name && g.size === f.size) === i
      );
      return merged.slice(0, 7);
    });
    setError('');
  };
  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handleAnalyze = async () => {
    if (files.length === 0) { setError(t('analyzeNoPdf')); return; }
    if (employees.length === 0) { setError(t('analyzeNoEmp')); return; }
    setLoading(true); setError('');
    const formData = new FormData();
    files.forEach((f) => formData.append('pdf', f));
    formData.append('weekLabel', weekLabel);
    if (customBudget) formData.append('weeklyBudget', customBudget);
    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: formData });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }
      if (!res.ok) {
        const detail = data?.error || data?.message || (raw ? raw.slice(0, 300) : '');
        throw new Error(detail || `Request failed (HTTP ${res.status})`);
      }
      if (!data) throw new Error('Server returned a non-JSON response (possibly a gateway timeout).');
      setResult(data);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  if (result) return <AnalysisResult result={result} employees={employees} onClose={() => { setResult(null); setFiles([]); }} />;

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
                className={`upload-zone ${dragOver ? 'drag-over' : ''} ${files.length ? 'has-file' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={(e) => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; }} />
                {files.length > 0 ? (
                  <>
                    <div className="upload-icon">✅</div>
                    <div className="upload-filename">
                      {files.length === 1 ? files[0].name : `${files.length} PDF ${lang === 'hu' ? 'fájl kiválasztva' : 'files selected'}`}
                    </div>
                    <div className="upload-hint">{t('analyzePdfReplace')} {lang === 'hu' ? '· akár 7 fájl (heti = napi bontásban)' : '· up to 7 files (e.g. one per day for a full week)'}</div>
                  </>
                ) : (
                  <>
                    <div className="upload-icon">📄</div>
                    <div className="upload-text">{t('analyzeDragDrop')}</div>
                    <div className="upload-hint">{t('analyzePdfHint')} {lang === 'hu' ? '· tölthetsz fel akár 7 napi fájlt egyszerre egy teljes hét összeállításához' : '· you can upload up to 7 daily files at once to build a full week'}</div>
                  </>
                )}
              </div>
              {files.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
                  {files.map((f, i) => (
                    <li key={`${f.name}-${f.size}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--surface-2, #f3f4f6)', borderRadius: 6, marginBottom: 6, fontSize: 13 }}>
                      <span>📄 {f.name} <span style={{ opacity: 0.6 }}>({(f.size / 1024).toFixed(0)} KB)</span></span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger, #dc2626)', fontWeight: 600 }}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
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
              <button className="btn btn-primary btn-full btn-lg" onClick={handleAnalyze} disabled={loading || files.length === 0 || employees.length === 0}>
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
