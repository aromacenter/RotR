import React, { useState, useEffect, useRef } from 'react';
import { useLang } from '../i18n.jsx';
import { SkillBadgeRow, SkillToggleGrid } from '../components/Skills.jsx';

// ─── Inline edit row ──────────────────────────────────────────────────────────

function EditRow({ emp, onSave, onCancel, t }) {
  const [form, setForm] = useState({
    name: emp.name,
    contracted_hours: String(emp.contracted_hours),
    area: emp.area || '',
    role: emp.role || '',
    notes: emp.notes || '',
    skills: (() => { try { return JSON.parse(emp.skills || '[]'); } catch { return []; } })(),
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <>
      <tr style={{ background: '#eff6ff' }}>
        <td>
          <input className="form-input" value={form.name} onChange={(e) => set('name', e.target.value)} style={{ padding: '5px 8px', minWidth: 140 }} />
        </td>
        <td>
          <input className="form-input" value={form.area} onChange={(e) => set('area', e.target.value)} placeholder={t('empAreaPlaceholder')} style={{ padding: '5px 8px', minWidth: 120 }} />
        </td>
        <td>
          <input className="form-input" value={form.role} onChange={(e) => set('role', e.target.value)} placeholder={t('empRolePlaceholder')} style={{ padding: '5px 8px', minWidth: 120 }} />
        </td>
        <td>
          <input className="form-input" type="number" value={form.contracted_hours} onChange={(e) => set('contracted_hours', e.target.value)} min="0" max="168" step="0.5" style={{ padding: '5px 8px', width: 70 }} />
        </td>
        <td>
          <input className="form-input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder={t('empNotesPlaceholder')} style={{ padding: '5px 8px', minWidth: 100 }} />
        </td>
        <td>—</td>
        <td>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-success btn-sm" onClick={() => onSave({ ...form, contractedHours: parseFloat(form.contracted_hours) || 0 })}>{t('empSave')}</button>
            <button className="btn btn-secondary btn-sm" onClick={onCancel}>{t('empCancel')}</button>
          </div>
        </td>
      </tr>
      <tr style={{ background: '#eff6ff' }}>
        <td colSpan={7} style={{ padding: '8px 12px 14px', borderTop: '1px dashed #bfdbfe' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gray-500)', marginBottom: 8 }}>SKILLS</div>
          <SkillToggleGrid value={form.skills} onChange={(v) => set('skills', v)} />
        </td>
      </tr>
    </>
  );
}

// ─── Import preview table ─────────────────────────────────────────────────────

function ImportPreview({ rows, onChange, onRemove, t }) {
  return (
    <div className="table-wrapper" style={{ maxHeight: 400, overflowY: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>{t('importEditName')}</th>
            <th>{t('importEditArea')}</th>
            <th>{t('importEditRole')}</th>
            <th style={{ width: 70 }}>{t('importEditHours')}</th>
            <th>{t('importEditNotes')}</th>
            <th style={{ width: 36 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input className="form-input" value={row.name} onChange={(e) => onChange(i, 'name', e.target.value)} style={{ padding: '4px 7px', minWidth: 130 }} />
              </td>
              <td>
                <input className="form-input" value={row.area || ''} onChange={(e) => onChange(i, 'area', e.target.value)} style={{ padding: '4px 7px', minWidth: 100 }} />
              </td>
              <td>
                <input className="form-input" value={row.role || ''} onChange={(e) => onChange(i, 'role', e.target.value)} style={{ padding: '4px 7px', minWidth: 100 }} />
              </td>
              <td>
                <input className="form-input" type="number" value={row.contractedHours ?? 0} onChange={(e) => onChange(i, 'contractedHours', parseFloat(e.target.value) || 0)} min="0" max="168" step="0.5" style={{ padding: '4px 7px', width: 65 }} />
              </td>
              <td>
                <input className="form-input" value={row.notes || ''} onChange={(e) => onChange(i, 'notes', e.target.value)} style={{ padding: '4px 7px', minWidth: 90 }} />
              </td>
              <td>
                <button onClick={() => onRemove(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700, fontSize: 16, padding: '0 4px' }} title="Remove">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Employees() {
  const { t } = useLang();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add form
  const [newForm, setNewForm] = useState({ name: '', contracted_hours: '', area: '', role: '', notes: '' });

  // Inline edit
  const [editId, setEditId] = useState(null);

  // PDF import
  const [importFile, setImportFile] = useState(null);
  const [importDragOver, setImportDragOver] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { employees, sourceInfo }
  const [importMode, setImportMode] = useState('merge');
  const [importConfirmLoading, setImportConfirmLoading] = useState(false);
  const importFileRef = useRef();

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employees');
      setEmployees(await res.json());
    } catch {
      setError(t('empLoadFail'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const flash = (msg, isError = false) => {
    if (isError) { setError(msg); setTimeout(() => setError(''), 5000); }
    else { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); }
  };

  // ── Add ──────────────────────────────────────────────────────────────────────

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newForm.name,
          contractedHours: parseFloat(newForm.contracted_hours) || 0,
          area: newForm.area,
          role: newForm.role,
          notes: newForm.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewForm({ name: '', contracted_hours: '', area: '', role: '', notes: '' });
      flash(t('empAdded'));
      load();
    } catch (err) {
      flash(err.message, true);
    }
  };

  // ── Save edit ────────────────────────────────────────────────────────────────

  const handleSave = async (id, form) => {
    setError('');
    try {
      const res = await fetch(`/api/employees/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditId(null);
      flash(t('empSaved'));
      load();
    } catch (err) {
      flash(err.message, true);
    }
  };

  // ── Delete ───────────────────────────────────────────────────────────────────

  const handleDelete = async (id, name) => {
    if (!confirm(`${t('empDeleteConfirm')}: ${name}?`)) return;
    try {
      await fetch(`/api/employees/${id}`, { method: 'DELETE' });
      flash(t('empDeleted'));
      load();
    } catch {
      flash(t('empDeleteFail'), true);
    }
  };

  // ── PDF import: extract ──────────────────────────────────────────────────────

  const handleImportExtract = async () => {
    if (!importFile) { flash(t('importNoFile'), true); return; }
    setImportLoading(true);
    setError('');
    const formData = new FormData();
    formData.append('pdf', importFile);
    try {
      const res = await fetch('/api/employees/import-preview', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImportPreview(data);
    } catch (err) {
      flash(err.message, true);
    } finally {
      setImportLoading(false);
    }
  };

  const updatePreviewRow = (i, key, val) => {
    setImportPreview((prev) => {
      const rows = [...prev.employees];
      rows[i] = { ...rows[i], [key]: val };
      return { ...prev, employees: rows };
    });
  };

  const removePreviewRow = (i) => {
    setImportPreview((prev) => ({ ...prev, employees: prev.employees.filter((_, idx) => idx !== i) }));
  };

  // ── PDF import: confirm ──────────────────────────────────────────────────────

  const handleImportConfirm = async () => {
    if (importMode === 'replace' && !confirm(t('importConfirmReplace'))) return;
    setImportConfirmLoading(true);
    try {
      const res = await fetch('/api/employees/import-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employees: importPreview.employees, mode: importMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setImportPreview(null);
      setImportFile(null);
      flash(`${data.imported} ${t('importSuccess')}`);
      load();
    } catch (err) {
      flash(err.message, true);
    } finally {
      setImportConfirmLoading(false);
    }
  };

  const totalContracted = employees.reduce((sum, e) => sum + e.contracted_hours, 0);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{t('employeesPage')}</h1>
        <p className="page-subtitle">{t('employeesSubtitle')}</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* ── PDF Import ─────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <div className="card-title">📄 {t('importSection')}</div>
        </div>
        <div className="card-body">
          <p style={{ color: 'var(--gray-600)', fontSize: 13, marginBottom: 16 }}>{t('importDesc')}</p>

          {!importPreview ? (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div
                  className={`upload-zone ${importDragOver ? 'drag-over' : ''} ${importFile ? 'has-file' : ''}`}
                  style={{ padding: '24px 16px' }}
                  onDragOver={(e) => { e.preventDefault(); setImportDragOver(true); }}
                  onDragLeave={() => setImportDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault(); setImportDragOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f?.type === 'application/pdf') { setImportFile(f); setError(''); }
                  }}
                  onClick={() => importFileRef.current?.click()}
                >
                  <input ref={importFileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files[0]; if (f) setImportFile(f); }} />
                  {importFile ? (
                    <>
                      <div className="upload-icon" style={{ fontSize: 28 }}>✅</div>
                      <div className="upload-filename">{importFile.name}</div>
                      <div className="upload-hint">({(importFile.size / 1024).toFixed(0)} KB)</div>
                    </>
                  ) : (
                    <>
                      <div className="upload-icon" style={{ fontSize: 28 }}>📋</div>
                      <div className="upload-text" style={{ fontSize: 13 }}>{t('importUploadLabel')}</div>
                    </>
                  )}
                </div>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleImportExtract}
                disabled={importLoading || !importFile}
                style={{ alignSelf: 'flex-end' }}
              >
                {importLoading ? <><span className="spinner" />{t('importRunning')}</> : t('importRunButton')}
              </button>
            </div>
          ) : (
            <div>
              {importPreview.sourceInfo && (
                <div className="alert alert-info" style={{ marginBottom: 12 }}>
                  <strong>{t('importSourceInfo')}:</strong> {importPreview.sourceInfo}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>
                  {t('importPreviewTitle')} — {importPreview.employees.length} {t('importRowCount')}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <label className="form-label" style={{ display: 'inline', marginRight: 8 }}>{t('importModeLabel')}:</label>
                    <select className="form-select" value={importMode} onChange={(e) => setImportMode(e.target.value)} style={{ width: 'auto', display: 'inline-block' }}>
                      <option value="merge">{t('importModeMerge')}</option>
                      <option value="replace">{t('importModeReplace')}</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" onClick={handleImportConfirm} disabled={importConfirmLoading || importPreview.employees.length === 0}>
                      {importConfirmLoading ? <><span className="spinner" />{t('saving')}</> : t('importConfirm')}
                    </button>
                    <button className="btn btn-secondary" onClick={() => { setImportPreview(null); setImportFile(null); }}>{t('importCancel')}</button>
                  </div>
                </div>
              </div>

              <ImportPreview rows={importPreview.employees} onChange={updatePreviewRow} onRemove={removePreviewRow} t={t} />
            </div>
          )}
        </div>
      </div>

      {/* ── Add manually ───────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header"><div className="card-title">{t('addEmployee')}</div></div>
        <div className="card-body">
          <form onSubmit={handleAdd}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">{t('empName')} *</label>
                <input className="form-input" type="text" placeholder={t('empNamePlaceholder')} value={newForm.name} onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">{t('empArea')}</label>
                <input className="form-input" type="text" placeholder={t('empAreaPlaceholder')} value={newForm.area} onChange={(e) => setNewForm((f) => ({ ...f, area: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">{t('empRole')}</label>
                <input className="form-input" type="text" placeholder={t('empRolePlaceholder')} value={newForm.role} onChange={(e) => setNewForm((f) => ({ ...f, role: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">{t('empHours')} *</label>
                <input className="form-input" type="number" placeholder="40" min="0" max="168" step="0.5" value={newForm.contracted_hours} onChange={(e) => setNewForm((f) => ({ ...f, contracted_hours: e.target.value }))} required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">{t('empNotes')}</label>
                <input className="form-input" type="text" placeholder={t('empNotesPlaceholder')} value={newForm.notes} onChange={(e) => setNewForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary">{t('addButton')}</button>
          </form>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div className="stat-card" style={{ minWidth: 180 }}>
          <div className="stat-label">{t('empCount')}</div>
          <div className="stat-value">{employees.length} {t('person')}</div>
        </div>
        <div className="stat-card" style={{ minWidth: 220 }}>
          <div className="stat-label">{t('empTotalHours')}</div>
          <div className="stat-value">{totalContracted} h</div>
          <div className="stat-sub">{t('empTotalSub')}</div>
        </div>
      </div>

      {/* ── Employee table ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">{t('empList')} ({employees.length})</div>
        </div>
        {loading ? (
          <div className="loading-overlay"><div className="spinner spinner-dark" />{t('empLoading')}</div>
        ) : employees.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👥</div>
            <div className="empty-state-text" style={{ whiteSpace: 'pre-line' }}>{t('empEmpty')}</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>{t('colName')}</th>
                  <th>{t('colArea')}</th>
                  <th>{t('colRole')}</th>
                  <th>{t('colHours')}</th>
                  <th>{t('empNotes')}</th>
                  <th>Skills</th>
                  <th style={{ width: 130 }}>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) =>
                  editId === emp.id ? (
                    <EditRow
                      key={emp.id}
                      emp={emp}
                      onSave={(form) => handleSave(emp.id, form)}
                      onCancel={() => setEditId(null)}
                      t={t}
                    />
                  ) : (
                    <tr key={emp.id}>
                      <td><strong>{emp.name}</strong></td>
                      <td>{emp.area ? <span style={{ background: 'var(--gray-100)', padding: '2px 8px', borderRadius: 99, fontSize: 12 }}>{emp.area}</span> : <span style={{ color: 'var(--gray-300)' }}>—</span>}</td>
                      <td>{emp.role ? <span style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '2px 8px', borderRadius: 99, fontSize: 12, fontWeight: 600 }}>{emp.role}</span> : <span style={{ color: 'var(--gray-300)' }}>—</span>}</td>
                      <td><strong>{emp.contracted_hours}</strong> h</td>
                      <td style={{ color: 'var(--gray-500)', fontSize: 13 }}>{emp.notes || <span style={{ color: 'var(--gray-300)' }}>—</span>}</td>
                      <td>
                        <SkillBadgeRow skills={(() => { try { return JSON.parse(emp.skills || '[]'); } catch { return []; } })()} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditId(emp.id)}>{t('empEdit')}</button>
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(emp.id, emp.name)}>{t('empDelete')}</button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
