import React, { useState, useRef, useEffect } from 'react';
import { useLang } from '../i18n.jsx';
import PrintView from './PrintView.jsx';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

// ─── UK Retail Financial Year helpers ────────────────────────────────────────
// The UK retail financial year (52/53-week year) starts on the Sunday nearest
// to 1 February each calendar year.  Weeks run Sunday → Saturday.
// Week 1 = first week of the FY; week numbers restart each FY.

// Use UTC day arithmetic throughout to avoid DST skew (UK clocks change on the
// last Sunday of March — exactly when the FY boundary often falls — which
// makes millisecond subtraction lose an hour and shift the week number by 1).
function dateToUtcDays(d) {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
}

function fyStartForDate(date) {
  // UK retail / tax-year: FY starts on the Sunday nearest to 1 April.
  // Nearest Sunday to 1 Apr 2026 = 29 Mar 2026 → wk11 = 7–13 Jun 2026 ✓
  const nearestSunToApr1 = (yr) => {
    const apr1 = new Date(yr, 3, 1);
    const dow  = apr1.getDay(); // 0=Sun
    const offset = dow <= 3 ? -dow : 7 - dow;
    return new Date(yr, 3, 1 + offset);
  };
  const yr = date.getFullYear();
  let start = nearestSunToApr1(yr);
  if (dateToUtcDays(date) < dateToUtcDays(start)) start = nearestSunToApr1(yr - 1);
  return start;
}

function ukRetailWeek(sunday) {
  const fyStart = fyStartForDate(sunday);
  // Divide by days (integers) to avoid DST-induced float errors
  const days = dateToUtcDays(sunday) - dateToUtcDays(fyStart);
  return Math.floor(days / 7) + 1;
}

function weekSundayFromDate(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function formatWeekLabel(sunday) {
  const saturday = new Date(sunday); saturday.setDate(sunday.getDate() + 6);
  const wk = ukRetailWeek(sunday);
  const mo = (d) => d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  return `${sunday.getFullYear()} ${mo(sunday)} – ${mo(saturday)}  wk${wk}`;
}

// ─── WeekPicker component ─────────────────────────────────────────────────────
function WeekPicker({ value, onChange }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_LETTERS = ['S','M','T','W','T','F','S'];

  // Build calendar grid for viewYear/viewMonth
  const firstDay = new Date(viewYear, viewMonth, 1);
  const startSun = new Date(firstDay);
  startSun.setDate(firstDay.getDate() - firstDay.getDay()); // back to Sunday

  const weeks = [];
  const cur = new Date(startSun);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    if (week[0].getMonth() > viewMonth && week[0].getFullYear() >= viewYear) break;
    weeks.push(week);
  }

  const selectedSun = value ? weekSundayFromDate(new Date(value.replace(/\s+wk\d+$/, '').replace(/–.*/, '').trim() + ' ' + new Date().getFullYear())) : null;
  // Better: derive selected Sunday from the stored label's date
  const [hoverSun, setHoverSun] = useState(null);

  const selectWeek = (sun) => {
    onChange(formatWeekLabel(sun));
    setOpen(false);
  };

  const isSameWeek = (sun, d) => {
    const s = new Date(sun); s.setHours(0,0,0,0);
    const t = new Date(d);   t.setHours(0,0,0,0);
    return t >= s && t < new Date(s.getTime() + 7*86400000);
  };

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y=>y-1); } else setViewMonth(m=>m-1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y=>y+1); } else setViewMonth(m=>m+1); };

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <div
        className="form-input"
        onClick={() => setOpen(o=>!o)}
        style={{ cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', userSelect:'none' }}
      >
        <span>{value || 'Válassz hetet…'}</span>
        <span style={{ color:'#94a3b8' }}>📅</span>
      </div>
      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:200,
          background:'white', border:'1px solid #e2e8f0', borderRadius:10,
          boxShadow:'0 8px 32px rgba(0,0,0,.14)', padding:16, minWidth:280,
        }}>
          {/* Month nav */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <button type="button" onClick={prevMonth} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'#475569', padding:'0 6px' }}>‹</button>
            <span style={{ fontWeight:700, fontSize:14, color:'#0f172a' }}>{MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={nextMonth} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:'#475569', padding:'0 6px' }}>›</button>
          </div>
          {/* Day headers */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom:4 }}>
            {DAY_LETTERS.map((l,i) => (
              <div key={i} style={{ textAlign:'center', fontSize:11, fontWeight:700, color: i===0?'#6366f1':'#94a3b8', padding:'2px 0' }}>{l}</div>
            ))}
          </div>
          {/* Weeks */}
          {weeks.map((week, wi) => {
            const sun = week[0];
            const wkNum = ukRetailWeek(sun);
            const isSelected = value && isSameWeek(weekSundayFromDate(new Date()), sun); // fallback
            const isHovered = hoverSun && isSameWeek(hoverSun, sun);
            return (
              <div
                key={wi}
                style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', cursor:'pointer', borderRadius:6,
                  background: isHovered ? '#ede9fe' : 'transparent', marginBottom:1 }}
                onMouseEnter={() => setHoverSun(sun)}
                onMouseLeave={() => setHoverSun(null)}
                onClick={() => selectWeek(sun)}
              >
                {week.map((d, di) => {
                  const inMonth = d.getMonth() === viewMonth;
                  const isToday = d.toDateString() === today.toDateString();
                  return (
                    <div key={di} style={{
                      textAlign:'center', padding:'5px 2px', fontSize:12,
                      color: !inMonth ? '#cbd5e1' : isToday ? '#6366f1' : '#1e293b',
                      fontWeight: isToday ? 800 : di===0 ? 600 : 400,
                      borderRadius: di===0 ? '6px 0 0 6px' : di===6 ? '0 6px 6px 0' : 0,
                    }}>
                      {di === 0 ? <span style={{ fontSize:9, color:'#94a3b8', display:'block', lineHeight:1 }}>wk{wkNum}</span> : null}
                      {d.getDate()}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div style={{ marginTop:8, fontSize:11, color:'#94a3b8', textAlign:'center' }}>
            UK retail weeks — Sun → Sat · FY starts nearest Sunday to 1 Apr
          </div>
        </div>
      )}
    </div>
  );
}

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

      {/* ── Coverage Matrix ───────────────────────────────────────────────── */}
      {Array.isArray(result.coverageMatrix) && result.coverageMatrix.length > 0 && (() => {
        const matrix = result.coverageMatrix;
        const DAY_HU = { Sun:'Vas', Mon:'Hét', Tue:'Kedd', Wed:'Sze', Thu:'Csüt', Fri:'Pén', Sat:'Szo' };
        const DAY_FULL_HU = { Sun:'Vasárnap', Mon:'Hétfő', Tue:'Kedd', Wed:'Szerda', Thu:'Csütörtök', Fri:'Péntek', Sat:'Szombat' };
        const dayAbbr = d => { const m=(d||'').match(/^(\w{3})/); return m?(DAY_HU[m[1]]||m[1]):d; };
        const dayFull = d => { const m=(d||'').match(/^(\w{3})/); return m?(DAY_FULL_HU[m[1]]||m[1]):d; };
        const dayDate = d => (d||'').replace(/^\w+\s*/,'');
        const rows = [
          { key:'keyholder',   icon:'🔑', label:'Keyholder',    sub:'min. 1' },
          { key:'till',        icon:'🛒', label:'Till Staff',    sub:'min. 2' },
          { key:'floor',       icon:'🏪', label:'Floor Staff',   sub:'min. 1' },
          { key:'nightReplen', icon:'🌙', label:'Éjszakai KH',   sub:'keyholder' },
        ];
        const anyViolation = matrix.some(d => rows.some(r => { const c=d[r.key]||{}; return c.applicable && !c.ok; }));

        const Cell = ({ cell, isNight }) => {
          if (!cell) return <td style={tdBase('#f8fafc')}>—</td>;
          if (!cell.applicable) {
            // No night shift this day → strikethrough dash
            return (
              <td style={tdBase('#f8fafc')}>
                <span style={{ fontSize:15, color:'#cbd5e1', textDecoration:'line-through' }}>—</span>
              </td>
            );
          }
          const bg = cell.ok ? '#f0fdf4' : '#fff1f2';
          const tooltip = (cell.who||[]).join(', ') || 'senki';
          return (
            <td style={tdBase(bg)} title={tooltip}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                <span style={{ fontSize:20 }}>{cell.ok ? '✅' : '❌'}</span>
                <span style={{ fontSize:11, fontWeight:700, color: cell.ok ? '#16a34a':'#dc2626' }}>
                  {cell.count}/{cell.required}
                </span>
              </div>
            </td>
          );
        };
        const tdBase = bg => ({ padding:'10px 6px', textAlign:'center', background:bg, borderBottom:'1px solid #e8ecf0', borderRight:'1px solid #e8ecf0', minWidth:68 });

        return (
          <div className="card" style={{ marginBottom:20, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.07)' }}>
            <div style={{ padding:'12px 16px', background: anyViolation?'#fff1f2':'#f0fdf4', borderBottom:'1px solid #e8ecf0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontWeight:700, fontSize:14, color: anyViolation?'#991b1b':'#065f46' }}>
                {anyViolation?'⚠️':'✅'} Lefedettség ellenőrzése
              </span>
              <span style={{ fontSize:11, color:'#94a3b8' }}>Zöld ✅ = OK · Piros ❌ = hiány · — = nincs éjszakai műszak</span>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr>
                    <th style={{ padding:'10px 14px', textAlign:'left', background:'#f8fafc', borderBottom:'2px solid #dde3ea', borderRight:'1px solid #e8ecf0', fontWeight:700, color:'#475569', minWidth:150, whiteSpace:'nowrap' }}>Szabály</th>
                    {matrix.map(d => (
                      <th key={d.day} title={dayFull(d.day)} style={{ padding:'8px 6px', textAlign:'center', background:'#f8fafc', borderBottom:'2px solid #dde3ea', borderRight:'1px solid #e8ecf0', fontWeight:700, color:'#374151', whiteSpace:'nowrap' }}>
                        <div style={{ fontSize:13 }}>{dayAbbr(d.day)}</div>
                        <div style={{ fontSize:10, fontWeight:400, color:'#94a3b8', marginTop:1 }}>{dayDate(d.day)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row,ri) => (
                    <tr key={row.key} style={{ background: ri%2===0?'white':'#fafbfc' }}>
                      <td style={{ padding:'10px 14px', borderBottom:'1px solid #e8ecf0', borderRight:'1px solid #e8ecf0', fontWeight:600, color:'#1e293b', whiteSpace:'nowrap' }}>
                        {row.icon} {row.label}
                        <div style={{ fontSize:10, fontWeight:400, color:'#94a3b8', marginTop:1 }}>{row.sub}</div>
                      </td>
                      {matrix.map(d => <Cell key={d.day} cell={d[row.key]} isNight={row.key==='nightReplen'} />)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ── Narrative sections ────────────────────────────────────────────── */}
      {narrative && (() => {
        const enRaw = narrative.match(/===\s*ENGLISH\s*===([\s\S]*?)(?:===|$)/i)?.[1]?.trim() || '';
        const huRaw = narrative.match(/===\s*MAGYAR\s*===([\s\S]*?)(?:===|$)/i)?.[1]?.trim() || '';

        // Parse [SECTION] blocks out of raw text
        const parseSections = (text) => {
          const blocks = {};
          const re = /\[([^\]]+)\]([\s\S]*?)(?=\[[^\]]+\]|$)/g;
          let m;
          while ((m = re.exec(text))) blocks[m[1].trim().toUpperCase()] = m[2].trim();
          return blocks;
        };
        const enSec = parseSections(enRaw);
        const huSec = parseSections(huRaw);

        // Overtime employees from parsed data
        const overEmps = empResults.filter(e => e.status === 'over');

        const BulletList = ({ text, warn }) => {
          if (!text) return <span style={{ color:'#94a3b8', fontSize:13 }}>—</span>;
          return (
            <div>
              {text.split('\n').map((line, i) => {
                const t = line.trim();
                if (!t) return null;
                const content = t.replace(/^[•\-]\s*/,'');
                const isWarn = warn || /keyholder|critical|kritikus/i.test(content);
                return (
                  <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:5 }}>
                    <span style={{ color: isWarn?'#dc2626':'#6366f1', fontWeight:700, flexShrink:0, marginTop:1 }}>{isWarn?'⚠':'•'}</span>
                    <span style={{ fontSize:13, lineHeight:1.6, color: isWarn?'#dc2626':'#374151', fontWeight: isWarn?600:400 }}>{content}</span>
                  </div>
                );
              })}
            </div>
          );
        };

        const Collapsible = ({ title, accent, bg, children, defaultOpen=false }) => {
          const [open, setOpen] = React.useState(defaultOpen);
          return (
            <div className="card" style={{ marginBottom:12, borderLeft:`4px solid ${accent}`, overflow:'hidden' }}>
              <div onClick={() => setOpen(o=>!o)} style={{ padding:'11px 16px', background:bg, display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', userSelect:'none' }}>
                <span style={{ fontWeight:700, fontSize:13, color:accent }}>{title}</span>
                <span style={{ fontSize:12, color:'#94a3b8' }}>{open?'▲ bezár':'▼ megnyit'}</span>
              </div>
              {open && <div className="card-body" style={{ paddingTop:12 }}>{children}</div>}
            </div>
          );
        };

        return (
          <div style={{ marginBottom:20 }}>

            {/* Budget summary — collapsible, closed by default */}
            <Collapsible
              title={`💰 Büdzsé — ${result.budgetStatus==='over'?'Túlköltés!':result.budgetStatus==='under'?'Hiány':'OK'}`}
              accent={result.budgetStatus==='over'?'#ef4444':result.budgetStatus==='under'?'#f59e0b':'#10b981'}
              bg={result.budgetStatus==='over'?'#fff1f2':result.budgetStatus==='under'?'#fffbeb':'#f0fdf4'}
              defaultOpen={false}
            >
              <div style={{ display:'flex', gap:24, flexWrap:'wrap', marginBottom: enSec['BUDGET']||huSec['BÜDZSÉ'] ? 12 : 0 }}>
                <div><div style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>ENGEDÉLYEZETT</div><div style={{ fontSize:22, fontWeight:800, color:'#0f172a' }}>{result.approvedBudget ?? 0} h</div></div>
                <div><div style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>FELHASZNÁLT</div><div style={{ fontSize:22, fontWeight:800, color:'#0f172a' }}>{result.totalScheduledHours ?? 0} h</div></div>
                <div><div style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>KÜLÖNBSÉG</div>
                  <div style={{ fontSize:22, fontWeight:800, color: result.budgetStatus==='over'?'#dc2626':result.budgetStatus==='under'?'#d97706':'#16a34a' }}>
                    {(result.budgetDifference??0)>0?'+':''}{(result.budgetDifference??0).toFixed(1)} h
                  </div>
                </div>
              </div>
              {(enSec['BUDGET']||huSec['BÜDZSÉ']) && <BulletList text={enSec['BUDGET']} />}
            </Collapsible>

            {/* Overtime table — collapsible, closed by default */}
            {overEmps.length > 0 && (
              <Collapsible title={`▲ Túlórák részletei (${overEmps.length} fő)`} accent="#f59e0b" bg="#fffbeb" defaultOpen={false}>
                <div style={{ padding:0, margin:-12 }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ background:'#fef3c7' }}>
                        <th style={{ padding:'8px 14px', textAlign:'left', fontWeight:700, color:'#78350f', borderBottom:'1px solid #fde68a' }}>Dolgozó</th>
                        <th style={{ padding:'8px 14px', textAlign:'center', fontWeight:700, color:'#78350f', borderBottom:'1px solid #fde68a' }}>Szerződéses</th>
                        <th style={{ padding:'8px 14px', textAlign:'center', fontWeight:700, color:'#78350f', borderBottom:'1px solid #fde68a' }}>Beosztott</th>
                        <th style={{ padding:'8px 14px', textAlign:'center', fontWeight:700, color:'#78350f', borderBottom:'1px solid #fde68a' }}>Felesleg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overEmps.map((e,i) => (
                        <tr key={e.name} style={{ background: i%2===0?'white':'#fffbeb' }}>
                          <td style={{ padding:'8px 14px', fontWeight:600, borderBottom:'1px solid #fef3c7' }}>{e.name}</td>
                          <td style={{ padding:'8px 14px', textAlign:'center', borderBottom:'1px solid #fef3c7' }}>{e.contractedHours} h</td>
                          <td style={{ padding:'8px 14px', textAlign:'center', borderBottom:'1px solid #fef3c7' }}>{e.scheduledHours} h</td>
                          <td style={{ padding:'8px 14px', textAlign:'center', fontWeight:700, color:'#dc2626', borderBottom:'1px solid #fef3c7' }}>+{e.difference} h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Collapsible>
            )}

            {/* English analysis box */}
            {(enSec['DAILY ISSUES'] || enSec['SUGGESTIONS']) && (
              <Collapsible title="📋 English Analysis" accent="#3b82f6" bg="#eff6ff" defaultOpen={false}>
                {enSec['DAILY ISSUES'] && <><div style={{ fontSize:11, fontWeight:700, color:'#3b82f6', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Daily Issues</div><BulletList text={enSec['DAILY ISSUES']} warn={false} /></>}
                {enSec['SUGGESTIONS'] && <><div style={{ height:10 }} /><div style={{ fontSize:11, fontWeight:700, color:'#3b82f6', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Suggestions</div><BulletList text={enSec['SUGGESTIONS']} /></>}
              </Collapsible>
            )}

            {/* Hungarian analysis box */}
            {(huSec['NAPI HIBÁK'] || huSec['JAVASLATOK']) && (
              <Collapsible title="📋 Magyar Elemzés" accent="#10b981" bg="#ecfdf5" defaultOpen={false}>
                {huSec['NAPI HIBÁK'] && <><div style={{ fontSize:11, fontWeight:700, color:'#10b981', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Napi Hibák</div><BulletList text={huSec['NAPI HIBÁK']} warn={false} /></>}
                {huSec['JAVASLATOK'] && <><div style={{ height:10 }} /><div style={{ fontSize:11, fontWeight:700, color:'#10b981', marginBottom:6, textTransform:'uppercase', letterSpacing:'.05em' }}>Javaslatok</div><BulletList text={huSec['JAVASLATOK']} /></>}
              </Collapsible>
            )}

            {result.aiUsage && (
              <div style={{ fontSize:11, color:'#94a3b8', display:'flex', gap:12, flexWrap:'wrap', padding:'2px 0' }}>
                <span>🤖 {result.aiUsage.model}</span>
                <span>{result.aiUsage.inputTokens?.toLocaleString()} in / {result.aiUsage.outputTokens?.toLocaleString()} out</span>
                <span>≈ ${result.aiUsage.estimatedCostUSD?.toFixed(4)}</span>
              </div>
            )}
          </div>
        );
      })()}

      {Array.isArray(result.parseLog) && result.parseLog.length > 0 && (
        <ParseLogPanel result={result} />
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
    const sunday = weekSundayFromDate(new Date());
    setWeekLabel(formatWeekLabel(sunday));
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
                <WeekPicker value={weekLabel} onChange={setWeekLabel} />
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
