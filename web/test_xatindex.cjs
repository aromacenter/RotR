// Standalone test of the x-position interpolation logic used to map shifts
// to day columns - mirrors the actual functions now in server.js.

function xAtIndex(line, idx, charWidth) {
  for (const it of line.items) {
    if (idx >= it.start && idx <= it.end) {
      const len = it.end - it.start;
      if (len <= 26) return it.x;
      const localCharWidth = it.width > 0 ? it.width / len : charWidth;
      return it.x + (idx - it.start) * localCharWidth;
    }
  }
  let best = null, bestDist = Infinity;
  for (const it of line.items) {
    const d = Math.min(Math.abs(it.start - idx), Math.abs(it.end - idx));
    if (d < bestDist) { bestDist = d; best = it; }
  }
  if (!best) return 0;
  const refStart = idx < best.start ? best.start : best.end;
  return best.x + (refStart === best.start ? 0 : (best.end - best.start) * charWidth) + (idx - refStart) * charWidth;
}

function estimateCharWidth(line) {
  const items = line.items.filter(it => it.str && it.str.trim());
  if (items.length >= 2) {
    const first = items[0], last = items[items.length - 1];
    const dx = last.x - first.x;
    const dChars = last.start - first.start;
    if (dChars > 0 && dx > 0) return dx / dChars;
  }
  if (items.length === 1 && items[0].width > 0 && items[0].str.length > 1) {
    return items[0].width / items[0].str.length;
  }
  return 5;
}

function dayForX(dayColumns, x) {
  if (dayColumns.length === 0) return null;
  let best = dayColumns[0], bestDist = Math.abs(best.x - x);
  for (const c of dayColumns) {
    const d = Math.abs(c.x - x);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

// Builds a row where each string sits at a FIXED column x (mirrors a real
// table: columns have constant width regardless of cell content length -
// e.g. column N always starts at tableLeft + N*colWidth, with the cell text
// left-aligned within it).
function buildFixedColumnLine(strs, colXs, charWidthHint) {
  let text = '';
  const items = [];
  strs.forEach((s, i) => {
    if (!s) { text += '  '; return; } // empty cell - no item, just spacing
    const start = text.length;
    text += s;
    items.push({ str: s, x: colXs[i], width: s.length * charWidthHint, start, end: text.length });
    text += '  ';
  });
  return { text: text.trim(), items };
}

function runScenario(name, headerLine, rowBuilder) {
  console.log(`\n========== ${name} ==========`);
  const charWidth = estimateCharWidth(headerLine);
  console.log('estimated charWidth =', charWidth.toFixed(3));
  const dayMatches = [...headerLine.text.matchAll(/(\d{2}\s+\w{3})\s+\((\w{3})\)/g)];
  const dayColumns = dayMatches.map(m => ({ date: m[1], short: m[2], x: xAtIndex(headerLine, m.index, charWidth) }));
  dayColumns.sort((a, b) => a.x - b.x);
  console.log('Day columns:', dayColumns.map(c => `${c.short}@${c.x.toFixed(0)}`).join('  '));

  const rowLine = rowBuilder();
  const shiftRe = /(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})(?:\s*\(([^)]+)\))?/g;
  let m;
  const days = [];
  while ((m = shiftRe.exec(rowLine.text))) {
    const x = xAtIndex(rowLine, m.index, charWidth);
    const col = dayForX(dayColumns, x);
    days.push(col ? col.short : null);
    console.log(`  "${m[0]}" @charIdx=${m.index} x=${x.toFixed(1)} -> ${col ? col.short + ' ' + col.date : '???'}`);
  }
  const order = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const sorted = [...days].sort((a,b) => order.indexOf(a) - order.indexOf(b));
  const isMonotonic = JSON.stringify(days) === JSON.stringify(sorted) && new Set(days).size === days.length;
  console.log(isMonotonic ? '  -> OK: distinct, in chronological order' : '  -> FAIL: not distinct/ordered correctly');
  return isMonotonic;
}

const headerStrs = ['07 Jun (Sun)', '08 Jun (Mon)', '09 Jun (Tue)', '10 Jun (Wed)', '11 Jun (Thu)', '12 Jun (Fri)', '13 Jun (Sat)'];

let allOk = true;

const SHIFTS = ['09:00 - 14:00 (TL)','09:00 - 14:00 (TL)','09:00 - 14:00 (TL)','09:00 - 14:00 (P)','09:00 - 14:00 (TL)','25:00','21:00 - 07:00'];
const TABLE_LEFT = 100, TABLE_COL_W = 86, TABLE_WIDTH = TABLE_COL_W * 7;
const COL_XS = [0,1,2,3,4,5,6].map(i => TABLE_LEFT + i * TABLE_COL_W);

function mergedRowWithRealWidth() {
  const text = SHIFTS.join('   ');
  return { text, items: [{ str: text, x: TABLE_LEFT, width: TABLE_WIDTH, start: 0, end: text.length }] };
}
function headerFixedCols() { return buildFixedColumnLine(headerStrs, COL_XS, 5.5); }

// Scenario A: header + data row both rendered as separate fixed-width-column
// items (the ideal/common real-world case - each cell is its own run at its
// column's x). Short items -> trusted directly, no interpolation needed.
allOk = runScenario(
  'Header & Row: separate items at fixed column positions (ideal case)',
  headerFixedCols(),
  () => buildFixedColumnLine(SHIFTS, COL_XS, 5.5)
) && allOk;

// Scenario B: header = separate fixed-column items; data row = ONE merged
// item whose `width` accurately spans the real table (pdf.js measures true
// glyph extents for merged runs) - interpolated using the item's own width.
allOk = runScenario(
  'Header: separate items / Row: ONE merged item WITH real width',
  headerFixedCols(),
  mergedRowWithRealWidth
) && allOk;

// Scenario C: header itself is ONE merged string; row also merged - both
// interpolated via their own real widths.
const mergedHeaderText = headerStrs.join('   ');
const mergedHeaderLine = { text: mergedHeaderText, items: [{ str: mergedHeaderText, x: TABLE_LEFT, width: TABLE_WIDTH, start: 0, end: mergedHeaderText.length }] };
allOk = runScenario(
  'Header: ONE merged item / Row: ONE merged item (both real widths)',
  mergedHeaderLine,
  mergedRowWithRealWidth
) && allOk;

// Scenario D: merged row with NO width info at all (worst case - falls back
// to the page-wide charWidth estimated from the header's item spacing).
allOk = runScenario(
  'Header: separate items / Row: ONE merged item, NO width info (worst case)',
  headerFixedCols(),
  () => {
    const text = SHIFTS.join('   ');
    return { text, items: [{ str: text, x: TABLE_LEFT, width: 0, start: 0, end: text.length }] };
  }
) && allOk;

console.log('\n' + (allOk ? 'ALL SCENARIOS PASS' : 'SOME SCENARIOS FAILED'));
process.exit(allOk ? 0 : 1);
