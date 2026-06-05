import React, { useRef } from 'react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Hours shown on the chart: 06:00 – 23:00
const START_HOUR = 6;
const END_HOUR = 23;
const TOTAL_HOURS = END_HOUR - START_HOUR;

// Fixed department colours matching Workcloud areas
const DEPT_COLORS = {
  'management':         { bg: '#1e3a8a', bar: '#1e3a8a', text: '#ffffff' }, // dark blue
  'customer service':   { bg: '#2563eb', bar: '#2563eb', text: '#ffffff' }, // blue
  'till':               { bg: '#2563eb', bar: '#2563eb', text: '#ffffff' }, // blue
  'floor':              { bg: '#7c3aed', bar: '#7c3aed', text: '#ffffff' }, // purple
  'replenishment':      { bg: '#16a34a', bar: '#16a34a', text: '#ffffff' }, // green
  'replen':             { bg: '#16a34a', bar: '#16a34a', text: '#ffffff' },
  'pricing':            { bg: '#ca8a04', bar: '#ca8a04', text: '#ffffff' }, // amber
  'cleaning':           { bg: '#0891b2', bar: '#0891b2', text: '#ffffff' }, // cyan
  'other':              { bg: '#64748b', bar: '#64748b', text: '#ffffff' }, // slate
};

const DEPT_PALETTE = [
  { bg: '#2563eb', bar: '#2563eb', text: '#ffffff' },
  { bg: '#16a34a', bar: '#16a34a', text: '#ffffff' },
  { bg: '#7c3aed', bar: '#7c3aed', text: '#ffffff' },
  { bg: '#ea580c', bar: '#ea580c', text: '#ffffff' },
  { bg: '#db2777', bar: '#db2777', text: '#ffffff' },
  { bg: '#0891b2', bar: '#0891b2', text: '#ffffff' },
  { bg: '#ca8a04', bar: '#ca8a04', text: '#ffffff' },
  { bg: '#475569', bar: '#475569', text: '#ffffff' },
];

function buildDeptMap(employees) {
  const map = {};
  let idx = 0;
  for (const emp of employees) {
    const key = (emp.area || 'Other').toLowerCase();
    if (!map[key]) {
      map[key] = DEPT_COLORS[key] || DEPT_PALETTE[idx++ % DEPT_PALETTE.length];
    }
  }
  return map;
}

function getDeptColor(area, deptMap) {
  const key = (area || 'Other').toLowerCase();
  return deptMap[key] || DEPT_COLORS[key] || DEPT_PALETTE[0];
}

function timeToFraction(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return (h + (m || 0) / 60 - START_HOUR) / TOTAL_HOURS;
}

function GanttBar({ start, end, color }) {
  const left = Math.max(0, timeToFraction(start) * 100);
  const right = Math.min(100, timeToFraction(end) * 100);
  const width = right - left;
  if (width <= 0) return null;
  return (
    <div style={{
      position: 'absolute',
      left: `${left}%`,
      width: `${width}%`,
      top: 3,
      bottom: 3,
      background: color.bar,
      borderRadius: 3,
      display: 'flex',
      alignItems: 'center',
      paddingLeft: 4,
      overflow: 'hidden',
    }}>
      <span style={{ color: 'white', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {start}–{end}
      </span>
    </div>
  );
}

function HourAxis() {
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: 0 }}>
      <div style={{ width: 130, flexShrink: 0 }} />
      <div style={{ flex: 1, position: 'relative', height: 18 }}>
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => i).map((i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${(i / TOTAL_HOURS) * 100}%`,
            fontSize: 8,
            color: '#94a3b8',
            transform: 'translateX(-50%)',
            top: 2,
          }}>
            {String(START_HOUR + i).padStart(2, '0')}
          </div>
        ))}
      </div>
    </div>
  );
}

function GridLines() {
  return (
    <>
      {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${(i / TOTAL_HOURS) * 100}%`,
          top: 0, bottom: 0,
          borderLeft: i === 0 ? 'none' : '1px solid #f1f5f9',
          pointerEvents: 'none',
        }} />
      ))}
    </>
  );
}

function DayPage({ day, dayIdx, employees, deptMap, weekLabel, printMode }) {
  // Filter employees who have a shift on this day
  const working = employees.filter((emp) =>
    (emp.shifts || []).some((s) => s.day?.toLowerCase() === day.toLowerCase())
  );

  if (working.length === 0) return null;

  return (
    <div style={{
      pageBreakAfter: printMode === 'daily' ? 'always' : 'avoid',
      padding: '12mm 10mm',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8, borderBottom: '2px solid #1e293b', paddingBottom: 6 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>
            {day.toUpperCase()}
          </div>
          {weekLabel && <div style={{ fontSize: 10, color: '#64748b' }}>{weekLabel}</div>}
        </div>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          {working.length} staff scheduled
        </div>
      </div>

      {/* Hour axis */}
      <HourAxis />

      {/* Employee rows */}
      <div>
        {working.map((emp) => {
          const color = getDeptColor(emp.area, deptMap);
          const dayShifts = (emp.shifts || []).filter((s) => s.day?.toLowerCase() === day.toLowerCase());
          return (
            <div key={emp.name} style={{
              display: 'flex',
              alignItems: 'center',
              borderBottom: '1px solid #f1f5f9',
              minHeight: 26,
            }}>
              <div style={{
                width: 130,
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 600,
                color: '#1e293b',
                paddingRight: 6,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                <span style={{
                  display: 'inline-block',
                  width: 8, height: 8,
                  borderRadius: '50%',
                  background: color.bar,
                  marginRight: 4,
                  flexShrink: 0,
                }} />
                {emp.name}
              </div>
              <div style={{ flex: 1, position: 'relative', height: 26 }}>
                <GridLines />
                {dayShifts.map((shift, i) => (
                  <GanttBar key={i} start={shift.start} end={shift.end} color={color} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Dept legend */}
      <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {Object.entries(deptMap).map(([dept, color]) => (
          <div key={dept} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color.bar }} />
            <span style={{ color: '#475569', textTransform: 'capitalize' }}>{dept}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PrintView({ analysis, employees, onClose }) {
  const [printMode, setPrintMode] = React.useState('daily');
  const printRef = useRef();

  // Merge employee area data from DB into analysis employees
  const enriched = (analysis.employees || []).map((ae) => {
    const dbEmp = employees.find((e) =>
      e.name.toLowerCase() === ae.name.toLowerCase() ||
      e.name.toLowerCase().includes(ae.name.split(',')[0].toLowerCase())
    );
    return { ...ae, area: dbEmp?.area || ae.area || 'Other' };
  });

  const deptMap = buildDeptMap(enriched);

  const handlePrint = () => {
    const style = document.createElement('style');
    style.innerHTML = `
      @media print {
        body > *:not(#print-root) { display: none !important; }
        #print-root { display: block !important; }
        @page { size: A4 landscape; margin: 0; }
      }
    `;
    document.head.appendChild(style);
    const orig = document.getElementById('root').innerHTML;
    document.getElementById('root').innerHTML = `<div id="print-root">${printRef.current.innerHTML}</div>`;
    window.print();
    document.getElementById('root').innerHTML = orig;
    document.head.removeChild(style);
    window.location.reload();
  };

  return (
    <div>
      <div className="page-header">
        <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ marginBottom: 12 }}>← Back</button>
        <h1 className="page-title">Print Preview — {analysis.weekLabel || 'Rota'}</h1>
      </div>

      {/* Controls */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label" style={{ display: 'inline', marginRight: 8 }}>Print mode:</label>
            <select className="form-select" value={printMode} onChange={(e) => setPrintMode(e.target.value)} style={{ width: 'auto', display: 'inline-block' }}>
              <option value="daily">Daily (one page per day)</option>
              <option value="weekly">Weekly overview (all days)</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={handlePrint}>🖨️ Print</button>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
            Only employees scheduled that day are shown. Department colours match the legend.
          </div>
        </div>
      </div>

      {/* Dept legend */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body">
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Department colours</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(deptMap).map(([dept, color]) => (
              <div key={dept} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 16, height: 16, borderRadius: 3, background: color.bar }} />
                <span style={{ fontSize: 13, textTransform: 'capitalize', color: 'var(--gray-700)' }}>{dept}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div ref={printRef} style={{ background: 'white', border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
        {DAYS.map((day, idx) => (
          <DayPage
            key={day}
            day={day}
            dayIdx={idx}
            employees={enriched}
            deptMap={deptMap}
            weekLabel={analysis.weekLabel}
            printMode={printMode}
          />
        ))}
      </div>
    </div>
  );
}
