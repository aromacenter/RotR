import express from 'express';
import session from 'express-session';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';
import Anthropic from '@anthropic-ai/sdk';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import db from './db.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const SQLiteStore = require('connect-sqlite3')(session);

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Workcloud schedule parser ────────────────────────────────────────────────

const DAYS_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_PATTERNS = [
  /\b(0?[0-9]|[12][0-9]|3[01])\s+Jun\s+\(Sun\)/i,
  /\b(0?[0-9]|[12][0-9]|3[01])\s+Jun\s+\(Mon\)/i,
  // generic fallback handled below
];

function timeToHours(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh + em / 60) - (sh + sm / 60);
  if (diff <= 0) diff += 24; // overnight shift
  return Math.round(diff * 100) / 100;
}

// Extracts text from a PDF while preserving each text item's x-coordinate, so
// that table cells can be matched to the correct column by HORIZONTAL POSITION
// rather than by guessing/counting - this is essential for the Workcloud
// schedule grid where every row spans "Sun..Sat" columns and a naive
// left-to-right token count silently misaligns whenever a cell is empty or
// contains more than one time range (split shifts, meal breaks, etc).
async function extractPositionedLines(buffer) {
  const allLines = [];
  await pdfParse(buffer, {
    pagerender: (pageData) => pageData.getTextContent().then((tc) => {
      const items = tc.items
        .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width || 0 }))
        .filter(it => it.str && it.str.trim());
      // Group into rows by Y proximity (PDF coordinates: same row = same y)
      const rows = [];
      const Y_TOL = 2.5;
      for (const it of items) {
        let row = rows.find(r => Math.abs(r.y - it.y) <= Y_TOL);
        if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
        row.items.push(it);
      }
      // Top-to-bottom (PDF y grows upward), then left-to-right within a row
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        let text = '';
        const itemsWithOffsets = [];
        for (const it of row.items) {
          const start = text.length;
          text += it.str;
          itemsWithOffsets.push({ str: it.str, x: it.x, width: it.width, start, end: text.length });
          text += ' ';
        }
        allLines.push({ text: text.trim(), items: itemsWithOffsets, y: row.y });
      }
      return rows.map(r => r.items.map(i => i.str).join(' ')).join('\n');
    }),
  });
  return allLines;
}

// Given a line (with .items carrying character offsets + x-coordinates) and a
// character index into line.text, returns the on-page x-coordinate that
// character was rendered at - i.e. "where on the page was this match".
//
// IMPORTANT: a whole table ROW is sometimes emitted as a SINGLE text item
// spanning all 7 day columns (e.g. "09:00-14:00 (TL) 09:00-14:00 (TL) ...").
// Returning that one item's start-x for every match collapses every shift in
// the row onto the same (leftmost/Sunday) column - which is exactly the bug
// observed. So we ALWAYS interpolate the x position proportionally by
// character offset within the containing item, using `charWidth` (points per
// character) - a single value derived ONCE from the header row's own item
// spacing (see `estimateCharWidth`), not the possibly-missing/zero
// `it.width` field some PDF exports omit. This assumes roughly even glyph
// spacing, true for these monospaced/tabular exports, and is the only way to
// resolve a position inside a merged multi-cell text run.
function xAtIndex(line, idx, charWidth) {
  for (const it of line.items) {
    if (idx >= it.start && idx <= it.end) {
      const len = it.end - it.start;
      // Most table extractions place each cell's content as its OWN item -
      // a "short" item (one shift's text, e.g. "09:00 - 14:00 (TL)" ≈ 18-20
      // chars) is reliably ONE cell, so its real x is exact - trust it
      // directly. Interpolating here would only inject drift from a
      // globally-estimated per-character width that doesn't match this
      // specific run's actual glyph spacing.
      if (len <= 26) return it.x;
      // Long items span MULTIPLE cells (a merged row). Interpolate using
      // the item's own measured width when available (most accurate - it's
      // this exact run's real pixel span), else the page-wide estimate.
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
  // idx falls outside any item (e.g. trailing trimmed whitespace) - extrapolate
  const refStart = idx < best.start ? best.start : best.end;
  return best.x + (refStart === best.start ? 0 : (best.end - best.start) * charWidth) + (idx - refStart) * charWidth;
}

// Derives "points per character" from the spacing between distinct text items
// on the header row - e.g. the x-distance between the "07 Jun (Sun)" item and
// the "08 Jun (Mon)" item, divided by the character offset between them. This
// works whether each header cell is its own item (common case: average over
// consecutive pairs) or the header is itself one merged string (falls back to
// spanning first..last item). Independent of the `width` field some PDF
// exports leave at 0.
function estimateCharWidth(line) {
  const items = line.items.filter(it => it.str && it.str.trim());
  // Span first..last item: averages out per-pair gap noise (inter-cell
  // padding isn't proportional to character count) far better than
  // averaging consecutive-pair ratios, which systematically over-estimates.
  if (items.length >= 2) {
    const first = items[0], last = items[items.length - 1];
    const dx = last.x - first.x;
    const dChars = last.start - first.start;
    if (dChars > 0 && dx > 0) return dx / dChars;
  }
  if (items.length === 1 && items[0].width > 0 && items[0].str.length > 1) {
    return items[0].width / items[0].str.length;
  }
  return 5; // sane fallback for ~9-10pt monospace text
}

function parseWorkcloudSchedule(positionedLines, dbEmployees) {
  const lines = positionedLines;

  // Find the column header row, e.g. "07 Jun (Sun)  08 Jun (Mon)  09 Jun (Tue)…"
  // and record each date column's X position - every shift found later is
  // matched against THESE positions (nearest column wins) rather than counted
  // sequentially, so it always lands on the day it actually appears under.
  const headerLineIdx = lines.findIndex(l =>
    /\d{2}\s+\w+\s+\(Sun\)/.test(l.text) || /\d{2}\s+\w+\s+\(Mon\)/.test(l.text)
  );

  // "Points per character" - derived once from the header row's own item
  // spacing, used to interpolate x-positions inside merged multi-cell text
  // runs everywhere below (header columns AND every employee shift).
  let charWidth = 5;
  let dayColumns = []; // [{ date, short, x }] sorted left-to-right (Sun..Sat)
  if (headerLineIdx >= 0) {
    const headerLine = lines[headerLineIdx];
    charWidth = estimateCharWidth(headerLine);
    const dayMatches = [...headerLine.text.matchAll(/(\d{2}\s+\w{3})\s+\((\w{3})\)/g)];
    dayColumns = dayMatches.map(m => ({
      date: m[1], short: m[2], x: xAtIndex(headerLine, m.index, charWidth),
    }));
    dayColumns.sort((a, b) => a.x - b.x);
  }
  // dayLabels kept for the "no header found" fallback path
  const dayLabels = dayColumns;

  // Resolve a page-x-coordinate to the nearest detected day column.
  const dayForX = (x) => {
    if (dayColumns.length === 0) return null;
    let best = dayColumns[0], bestDist = Math.abs(best.x - x);
    for (const c of dayColumns) {
      const d = Math.abs(c.x - x);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return best;
  };

  // Employee name pattern: "Lastname, Firstname" or "Lastname-Name, Firstname"
  const empNameRe = /^([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ\-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ]+)?,\s*[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\s*(.*)/;
  const shiftRe = /(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})(?:\s*\(([^)]+)\))?/g;
  const totalHoursRe = /\b(\d{1,3}:\d{2})\s*$/;

  const SECTION_HEADERS = new Set(['management','customer service','floor','replenishment','pricing','cleaning','total scheduled','store hours']);

  const parsed = {}; // name -> { totalHours, shifts: [{day, start, end, hours, code}] }
  // Full traceable log: for every employee block found in the PDF, record the
  // raw extracted lines plus exactly what was derived from them (total hours,
  // and each shift mapped to a day) - so parsing mistakes can be inspected
  // and verified against the original document after the fact.
  const parseLog = [];

  let currentName = null;
  let currentLineObjs = [];

  const flush = () => {
    if (!currentName) return;
    const block = currentLineObjs.map(l => l.text).join(' ');
    const rawLinesSnapshot = currentLineObjs.map(l => l.text);

    // Extract total hours (last standalone HH:MM not followed by dash)
    // Note: no \b before the digits - PDF text extraction sometimes glues the
    // total directly onto the previous time (e.g. "...20:0012:00"), which would
    // otherwise prevent a word-boundary match.
    const totalMatch = block.match(/(\d{2}:\d{2})\s*$/);
    let totalHours = 0;
    if (totalMatch) {
      const [h, m] = totalMatch[1].split(':').map(Number);
      totalHours = h + m / 60;
    }

    // Assign every shift / Day-Off entry to a day by comparing its X position
    // on the page against the detected header-column X positions (nearest
    // wins) - NOT by counting matches in sequence. This is robust against
    // empty cells, split shifts (two ranges in one day), and stacked
    // meal-break lines, all of which previously desynced a running counter
    // and silently misassigned entire days.
    const shifts = [];
    const dayOffDays = [];
    const fallbackDay = (x) => {
      const col = dayForX(x);
      return col ? `${col.short} ${col.date}` : null;
    };

    currentLineObjs.forEach((line, idx) => {
      // The first line begins with the employee's name; strip it (and its
      // x-offset) so shift times glued onto the same line are still matched
      // at their correct page position.
      let text = line.text;
      let items = line.items;
      if (idx === 0) {
        const stripLen = currentName.length;
        const sliced = line.text.slice(stripLen);
        text = sliced.trim();
        const offset = stripLen + (sliced.length - sliced.trimStart().length);
        items = line.items
          .filter(it => it.end > offset)
          .map(it => ({ ...it, start: Math.max(0, it.start - offset), end: Math.max(0, it.end - offset) }));
      }
      const lineObj = { text, items };

      const dayOffRe = /Day Off/ig;
      let m;
      while ((m = dayOffRe.exec(text))) {
        const day = fallbackDay(xAtIndex(lineObj, m.index, charWidth));
        if (day) dayOffDays.push(day);
      }

      // Capture ANY parenthetical annotation after the time range (e.g.
      // "(TL)", "(m)") so meal breaks ("(m)") can be reliably identified and
      // skipped - they must never be counted as a shift nor placed on the
      // timeline (the previous "[^)m]" exclusion meant "(m)" never matched
      // the optional group, so breaks slipped through as real shifts).
      const shiftMatches = [...text.matchAll(/(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})(?:\s*\(([^)]+)\))?/g)];
      for (const sm of shiftMatches) {
        const code = (sm[3] || '').trim().toLowerCase();
        if (code === 'm') continue; // skip meal breaks entirely
        const h = timeToHours(sm[1], sm[2]);
        if (h <= 0) continue;
        const day = fallbackDay(xAtIndex(lineObj, sm.index, charWidth));
        if (day) shifts.push({ day, start: sm[1], end: sm[2], hours: h, code });
      }
    });

    parsed[currentName] = { totalHours, shifts, dayOffDays };
    parseLog.push({
      name: currentName,
      rawLines: rawLinesSnapshot,
      detectedTotalHours: totalHours,
      shifts: shifts.map(s => ({ day: s.day, start: s.start, end: s.end, hours: s.hours, code: s.code || null })),
      dayOff: dayOffDays.slice(),
    });
    currentName = null;
    currentLineObjs = [];
  };

  // Some PDF text extractions glue a department-summary row directly onto the
  // end of an employee's row (e.g. "Evans, Lynne 11:00 - 15:00...12:00Floor23:3006:00...").
  // Strip everything from the glued department name onward so it doesn't pollute
  // the employee's shift/total parsing.
  const DEPT_GLUE_RE = /(Management|Customer Service|Floor|Replenishment|Pricing|Cleaning)\d/i;
  const stripDeptGlue = (line) => {
    const m = line.text.match(DEPT_GLUE_RE);
    if (!m) return line;
    return {
      text: line.text.slice(0, m.index).trim(),
      items: line.items.filter(it => it.start < m.index),
    };
  };

  for (const rawLine of lines) {
    if (!rawLine.text) continue;
    const lower = rawLine.text.toLowerCase();
    if (SECTION_HEADERS.has(lower) || /^workcloud/i.test(rawLine.text) || /^printed on/i.test(rawLine.text)) {
      flush();
      continue;
    }
    // Pure glued department-summary line (no employee name) - skip entirely
    if (DEPT_GLUE_RE.test(rawLine.text) && !empNameRe.test(rawLine.text)) continue;

    const line = stripDeptGlue(rawLine);
    if (!line.text) continue;

    const empMatch = line.text.match(empNameRe);
    if (empMatch) {
      flush();
      currentName = empMatch[1].trim();
      currentLineObjs = [line];
    } else if (currentName) {
      currentLineObjs.push(line);
    }
  }
  flush();

  // Match parsed entries to DB employees. Names extracted from the PDF often
  // differ from the DB record in whitespace, accents, hyphenation or
  // abbreviated first names (e.g. "Phillips-Slatcher, Heidi" vs.
  // "Phillips Slatcher, Heidi J"), so plain string equality misses too many -
  // normalize (strip accents/punctuation, collapse whitespace, lowercase) and
  // compare surname + first-name-prefix instead of requiring an exact match.
  const norm = (s) => (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z,\s]/g, ' ') // punctuation/hyphens -> space (keep comma as separator)
    .replace(/\s+/g, ' ')
    .trim();
  const nameParts = (s) => {
    const n = norm(s);
    const [surnameRaw, firstRaw] = n.split(',').map((p) => (p || '').trim());
    return {
      surname: (surnameRaw || '').replace(/\s+/g, ''), // "phillips slatcher" -> "phillipsslatcher"
      first: (firstRaw || '').split(' ')[0] || '', // first token of given name(s)
    };
  };
  const parsedKeys = Object.keys(parsed);
  const parsedPartsByKey = {};
  for (const k of parsedKeys) parsedPartsByKey[k] = nameParts(k);

  // Pre-compute which surnames appear MORE THAN ONCE in the DB - these must
  // NEVER be matched on surname alone; the full first name is required to
  // distinguish e.g. "Palvolgyi, Gabor" from "Palvolgyi, Erika".
  const surnameCountInDb = {};
  for (const emp of dbEmployees) {
    const s = nameParts(emp.name).surname;
    surnameCountInDb[s] = (surnameCountInDb[s] || 0) + 1;
  }

  const result = [];
  for (const dbEmp of dbEmployees) {
    const dbParts = nameParts(dbEmp.name);
    let match = null;
    // 1) exact normalized match (accents stripped, punctuation normalised)
    let key = parsedKeys.find((k) => norm(k) === norm(dbEmp.name));
    // 2) same surname AND first-name prefix matches (handles "Gabor" vs "G.")
    //    ALWAYS required when there are multiple people with the same surname.
    if (!key) {
      key = parsedKeys.find((k) => {
        const p = parsedPartsByKey[k];
        if (!p.surname || p.surname !== dbParts.surname) return false;
        // Both sides must have a first name to compare when the surname is
        // shared - never allow a blank first name to match ambiguously.
        if (!p.first || !dbParts.first) {
          // Only safe when this surname belongs to exactly one DB record
          return surnameCountInDb[dbParts.surname] === 1;
        }
        return p.first === dbParts.first
          || p.first.startsWith(dbParts.first)
          || dbParts.first.startsWith(p.first);
      });
    }
    // 3) surname-only fallback — ONLY when the surname is unique in the DB
    //    (i.e. no risk of confusing two employees with the same family name)
    if (!key && surnameCountInDb[dbParts.surname] === 1) {
      key = parsedKeys.find((k) => parsedPartsByKey[k].surname === dbParts.surname);
    }
    if (key) match = parsed[key];

    // "Day Off" entries count as (contracted hours / contracted work days per week)
    // — i.e. the average daily hours the employee would have worked that day.
    const dayOffDays = match?.dayOffDays || [];
    const perDayOffHours = dbEmp.work_days > 0
      ? Math.round((dbEmp.contracted_hours / dbEmp.work_days) * 100) / 100
      : 0;
    const dayOffTotal = Math.round(perDayOffHours * dayOffDays.length * 100) / 100;
    const dayOffShifts = dayOffDays.map((day) => ({
      day, start: null, end: null, hours: perDayOffHours, code: 'day_off',
    }));

    const scheduled = Math.round(((match?.totalHours ?? 0) + dayOffTotal) * 100) / 100;
    const diff = Math.round((scheduled - dbEmp.contracted_hours) * 100) / 100;
    result.push({
      name: dbEmp.name,
      scheduledHours: scheduled,
      contractedHours: dbEmp.contracted_hours,
      difference: diff,
      status: (match?.totalHours ?? 0) === 0 && dayOffDays.length === 0 ? 'not_found'
        : diff > 0.25 ? 'over'
        : diff < -0.25 ? 'under'
        : 'ok',
      shifts: [...(match?.shifts || []), ...dayOffShifts],
    });
  }

  // Attach trace data (arrays are objects - safe to hang extra props off them)
  // so the caller can surface a full "what did we read / what did we derive"
  // log without changing the function's primary return shape.
  result.parseLog = parseLog;
  result.detectedDayLabels = dayLabels.map(d => `${d.short} ${d.date}`);
  result.headerLineFound = headerLineIdx >= 0 ? lines[headerLineIdx].text : null;

  return result;
}

// ─── "Daily Store Schedule - Summary" parser ──────────────────────────────────
// A different Workcloud export: ONE day per report (header like "06 Jun (Sat)"),
// employees grouped under department headings ("Management 17:00"), each with
// a single shift on that date plus an optional meal-break range, e.g.:
//   "Palmer, Fred    12:00 - 21:00    17:15 - 17:45"
// No weekly day-column grid exists here, so day resolution is trivial - every
// shift found belongs to the single date in the report header.
function looksLikeDailySummary(positionedLines) {
  const text = positionedLines.map(l => l.text).join('\n');
  return /Daily Store Schedule/i.test(text) && /^\s*\d{2}\s+\w{3}\s+\(\w{3}\)/m.test(text);
}

function parseDailyStoreSchedule(positionedLines, dbEmployees) {
  const lines = positionedLines;

  // Report date, e.g. "06 Jun (Sat)" -> dayLabel "Sat 06 Jun"
  let dayLabel = null;
  let dateLine = null;
  for (const l of lines) {
    const m = l.text.trim().match(/^(\d{2}\s+\w{3})\s+\((\w{3})\)/);
    if (m) { dateLine = l; dayLabel = `${m[2]} ${m[1]}`; break; }
  }

  const empNameRe = /^([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ\-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ]+)?,\s*[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\s+(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\b(.*)$/;
  const timeRangeRe = /(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/g;

  const parsed = {};
  const parseLog = [];

  for (const rawLine of lines) {
    const text = rawLine.text.trim();
    if (!text || text === dateLine?.text.trim()) continue;
    const m = text.match(empNameRe);
    if (!m) continue;
    const name = m[1].trim();
    const start = m[2], end = m[3];
    const rest = m[4] || '';
    const shiftHours = timeToHours(start, end);
    if (shiftHours <= 0) continue;

    // Anything after the shift range that ALSO looks like a time range is a
    // meal break (the report has a dedicated "Meal Break" column) - subtract
    // its duration from the shift's gross hours to get net worked hours.
    let breakHours = 0;
    const breaks = [];
    let bm;
    timeRangeRe.lastIndex = 0;
    while ((bm = timeRangeRe.exec(rest))) {
      const bh = timeToHours(bm[1], bm[2]);
      if (bh > 0 && bh < shiftHours) { breakHours += bh; breaks.push({ start: bm[1], end: bm[2] }); }
    }
    const netHours = Math.round(Math.max(0, shiftHours - breakHours) * 100) / 100;

    const shift = { day: dayLabel, start, end, hours: netHours, code: null, mealBreaks: breaks };
    parsed[name] = { totalHours: netHours, shifts: [shift], dayOffDays: [] };
    parseLog.push({
      name,
      rawLines: [rawLine.text],
      detectedTotalHours: netHours,
      shifts: [{ day: dayLabel, start, end, hours: netHours, code: null }],
      dayOff: [],
    });
  }

  // Same normalized fuzzy name matching as the weekly parser (accents,
  // hyphenation, abbreviated first names all vary between PDF and DB record).
  const norm = (s) => (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z,\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const nameParts = (s) => {
    const n = norm(s);
    const [surnameRaw, firstRaw] = n.split(',').map((p) => (p || '').trim());
    return {
      surname: (surnameRaw || '').replace(/\s+/g, ''),
      first: (firstRaw || '').split(' ')[0] || '',
    };
  };
  const parsedKeys = Object.keys(parsed);
  const partsByKey = {};
  for (const k of parsedKeys) partsByKey[k] = nameParts(k);

  // Surnames shared by multiple DB employees must never match on surname alone
  const surnameCountInDb2 = {};
  for (const emp of dbEmployees) {
    const s = nameParts(emp.name).surname;
    surnameCountInDb2[s] = (surnameCountInDb2[s] || 0) + 1;
  }

  const result = [];
  for (const dbEmp of dbEmployees) {
    const dbParts = nameParts(dbEmp.name);
    let key = parsedKeys.find((k) => norm(k) === norm(dbEmp.name));
    if (!key) {
      key = parsedKeys.find((k) => {
        const p = partsByKey[k];
        if (!p.surname || p.surname !== dbParts.surname) return false;
        if (!p.first || !dbParts.first) return surnameCountInDb2[dbParts.surname] === 1;
        return p.first === dbParts.first || p.first.startsWith(dbParts.first) || dbParts.first.startsWith(p.first);
      });
    }
    if (!key && surnameCountInDb2[dbParts.surname] === 1) {
      key = parsedKeys.find((k) => partsByKey[k].surname === dbParts.surname);
    }
    const match = key ? parsed[key] : null;

    // This is a SINGLE-DAY report - "scheduled" here means hours worked on
    // this one date, not a weekly total, so there's nothing meaningful to
    // diff against weekly contracted hours. Status simply reflects whether
    // the employee appears on this day's schedule at all.
    const scheduled = Math.round((match?.totalHours ?? 0) * 100) / 100;
    result.push({
      name: dbEmp.name,
      scheduledHours: scheduled,
      contractedHours: dbEmp.contracted_hours,
      difference: Math.round((scheduled - dbEmp.contracted_hours) * 100) / 100,
      status: match ? 'ok' : 'not_found',
      shifts: match?.shifts || [],
    });
  }

  result.parseLog = parseLog;
  result.detectedDayLabels = dayLabel ? [dayLabel] : [];
  result.headerLineFound = dateLine ? dateLine.text : null;
  result.isDailyFormat = true;
  result.dayLabel = dayLabel;

  return result;
}

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

app.use(express.json());
const sessionDbPath = process.env.DB_PATH
  ? dirname(process.env.DB_PATH)
  : __dirname;

app.use(
  session({
    store: new SQLiteStore({ dir: sessionDbPath, db: 'sessions.db' }),
    secret: process.env.SESSION_SECRET || 'rota-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
  })
);

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Nincs bejelentkezve' });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const adminUser = process.env.ADMIN_USERNAME || 'admin';

  if (username !== adminUser) {
    return res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó' });
  }

  const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_password_hash');

  let valid = false;
  if (stored) {
    valid = await bcrypt.compare(password, stored.value);
  } else {
    const envPass = process.env.ADMIN_PASSWORD || 'admin123';
    valid = password === envPass;
    if (valid) {
      const hash = await bcrypt.hash(envPass, 10);
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('admin_password_hash', hash);
    }
  }

  if (!valid) return res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó' });

  req.session.user = username;
  res.json({ ok: true, username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: req.session.user });
});

// ─── Employees ────────────────────────────────────────────────────────────────

app.get('/api/employees', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM employees ORDER BY name COLLATE NOCASE').all());
});

app.post('/api/employees', requireAuth, (req, res) => {
  const { name, contractedHours, area = '', role = '', notes = '', skills = [], workDays = 0, deptGroup = '' } = req.body || {};
  if (!name?.trim() || contractedHours == null) {
    return res.status(400).json({ error: 'Név és szerződéses óra megadása kötelező' });
  }
  const result = db
    .prepare('INSERT INTO employees (name, contracted_hours, area, role, notes, skills, work_days, dept_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), Number(contractedHours), area.trim(), role.trim(), notes.trim(), JSON.stringify(skills), Number(workDays) || 0, deptGroup.trim());
  res.json({ id: result.lastInsertRowid, name: name.trim(), contracted_hours: Number(contractedHours), area, role, notes, skills, work_days: Number(workDays) || 0, dept_group: deptGroup.trim() });
});

app.put('/api/employees/:id', requireAuth, (req, res) => {
  const { name, contractedHours, area = '', role = '', notes = '', skills = [], workDays = 0, deptGroup = '' } = req.body || {};
  if (!name?.trim() || contractedHours == null) {
    return res.status(400).json({ error: 'Hiányzó adatok' });
  }
  db.prepare('UPDATE employees SET name = ?, contracted_hours = ?, area = ?, role = ?, notes = ?, skills = ?, work_days = ?, dept_group = ? WHERE id = ?').run(
    name.trim(), Number(contractedHours), area.trim(), role.trim(), notes.trim(), JSON.stringify(skills), Number(workDays) || 0, deptGroup.trim(), req.params.id
  );
  res.json({ ok: true });
});

app.delete('/api/employees/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Employee PDF import ──────────────────────────────────────────────────────

app.post('/api/employees/import-preview', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nincs PDF fájl csatolva' });

    let pdfText;
    try {
      const data = await pdfParse(req.file.buffer);
      pdfText = data.text;
    } catch (e) {
      return res.status(400).json({ error: 'Nem sikerült feldolgozni a PDF fájlt: ' + e.message });
    }

    if (!pdfText || pdfText.trim().length < 10) {
      return res.status(400).json({ error: 'Nem sikerült szöveget kinyerni a PDF-ből.' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Az ANTHROPIC_API_KEY nincs beállítva' });

    const client = new Anthropic({ apiKey });

    const prompt = `Az alábbi szöveg egy alkalmazotti listát tartalmazó PDF-ből lett kinyerve.

Azonosítsd az összes alkalmazottat és a hozzájuk tartozó adatokat:
- Teljes név
- Terület / részleg ahol dolgoznak (pl. pénztár, raktár, értékesítés, adminisztráció, stb.)
- Szerepkör / pozíció (pl. keyholder, supervisor, manager, colleague, stb.)
- Heti szerződéses munkaórák száma (általában a sor végén vagy egy dedikált oszlopban szerepel)
- Certifications / képesítések: az alkalmazott neve alatt vagy mellett felsorolt tanúsítványok, képesítések, jogosultságok (pl. first aid, fire marshal, DBS, food hygiene, stb.) – ezeket vesszővel elválasztva add meg a notes mezőben

PDF szöveg:
---
${pdfText.substring(0, 10000)}
---

VÁLASZOLJ KIZÁRÓLAG érvényes JSON formátumban, semmi más szöveg nélkül:
{
  "employees": [
    {
      "name": "Teljes Név",
      "area": "terület/részleg",
      "role": "szerepkör",
      "contractedHours": 40,
      "notes": "Certifications: First Aid, Fire Marshal, Food Hygiene"
    }
  ],
  "sourceInfo": "rövid leírás hogy milyen típusú dokumentumból lettek kinyerve az adatok"
}

Fontos szabályok:
- Ha nem találsz contracted hours értéket, használj 0-t
- Ha nem találsz területet, hagyd üres stringként
- Ha nem találsz szerepkört, hagyd üres stringként
- Ha van certification / képesítés adat az alkalmazott neve alatt vagy mellett, azt mindenképpen add meg a notes mezőben "Certifications: ..." formátumban
- Ha nincs certification, a notes mező legyen üres string
- Ne találj ki adatokat, csak ami egyértelműen szerepel a szövegben`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawResponse = message.content[0].text;
    let extracted;
    try {
      const stripped = rawResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      extracted = JSON.parse(jsonMatch ? jsonMatch[0] : stripped);
    } catch (e) {
      return res.status(500).json({ error: 'Az AI érvénytelen JSON-t adott vissza', detail: e.message, raw: rawResponse.substring(0, 400) });
    }

    res.json(extracted);
  } catch (e) {
    console.error('Import preview error:', e);
    res.status(500).json({ error: e.message || 'Ismeretlen hiba' });
  }
});

app.post('/api/employees/import-confirm', requireAuth, (req, res) => {
  const { employees, mode } = req.body || {};
  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ error: 'Nincsenek importálandó alkalmazottak' });
  }

  if (mode === 'replace') {
    db.prepare('DELETE FROM employees').run();
  }

  const insert = db.prepare(
    'INSERT INTO employees (name, contracted_hours, area, role, notes, skills, work_days, dept_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const upsert = db.prepare(`
    INSERT INTO employees (name, contracted_hours, area, role, notes, skills, work_days, dept_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      contracted_hours = excluded.contracted_hours,
      area = excluded.area,
      role = excluded.role,
      notes = excluded.notes,
      skills = excluded.skills,
      work_days = excluded.work_days,
      dept_group = excluded.dept_group
  `);

  let imported = 0;
  for (const emp of employees) {
    if (!emp.name?.trim()) continue;
    try {
      const skillsJson = JSON.stringify(emp.skills || []);
      const workDays = Number(emp.workDays) || 0;
      const deptGroup = (emp.deptGroup || '').trim();
      if (mode === 'replace') {
        insert.run(emp.name.trim(), Number(emp.contractedHours) || 0, emp.area || '', emp.role || '', emp.notes || '', skillsJson, workDays, deptGroup);
      } else {
        upsert.run(emp.name.trim(), Number(emp.contractedHours) || 0, emp.area || '', emp.role || '', emp.notes || '', skillsJson, workDays, deptGroup);
      }
      imported++;
    } catch (e) {
      console.error('Import row error:', e.message, emp);
    }
  }

  res.json({ ok: true, imported });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

const DEFAULT_ANALYSIS_PROMPT = `You are a rota scheduling analyst reviewing a Zebra Workcloud weekly schedule export.

MANDATORY COVERAGE RULES (flag as a violation if not met):
1. EVERY shift (day or night) must have at least: 1 Keyholder, 2 Till staff, 1 Floor member.
2. NIGHT shifts must have: 1 Keyholder AND at least 4 Replenishment staff.
3. A "Keyholder" is any Management-area employee or an employee whose name/code indicates keyholder responsibility.
4. If no Keyholder is on shift — flag it explicitly as a CRITICAL issue.

OUTPUT FORMAT — write two clearly separated sections, ENGLISH first then HUNGARIAN:

=== ENGLISH ANALYSIS ===

BUDGET SUMMARY
• This week X hours are available (approved budget). Y hours have been used. [Over/Under/On budget] by Z hours.
[If over budget: call this out prominently and list ONLY the over-contracted employees with their excess hours.]

OVERTIME — EMPLOYEES TO CUT BACK
[For each employee scheduled over their contracted hours: name, contracted hours, scheduled hours, excess. Suggest which shift(s) to shorten or remove, always keeping mandatory coverage rules in place.]

COVERAGE WARNINGS
[List every day/shift where keyholder, till count, floor count, or night replen count falls below the mandatory minimum. Be specific: day, time window, what is missing, who is on shift.]

=== MAGYAR ELEMZÉS ===

BÜDZSÉ ÖSSZEFOGLALÓ
• Erre a hétre X óra áll rendelkezésre (jóváhagyott keret). Ebből Y órát használtál el. [Túllépés/Hiány/Egyensúly]: Z óra.
[Ha túllépés van: emeld ki és listázd CSAK azokat a dolgozókat, akik a szerződéses óráikon felül vannak, a felesleges óraszámmal.]

TÚLÓRA — VISSZAVÁGANDÓ DOLGOZÓK
[Minden szerződéses óráját meghaladó dolgozónál: név, szerződéses órák, beosztott órák, különbség. Konkrét javaslat melyik műszakot kell rövidíteni vagy törölni, mindig betartva a kötelező lefedettségi szabályokat.]

FEDEZETI FIGYELMEZTETÉSEK
[Listázd azokat a napokat/műszakokat, ahol a keyholder, tills létszám, floor vagy éjszakai replen létszám a kötelező minimum alá esik. Konkrétan: nap, időablak, mi hiányzik, kik vannak beosztva.]

RULES FOR WRITING:
- Start EVERY section with its heading exactly as shown above (use the === and bold headings).
- Use bullet points (•) within sections — no plain paragraphs.
- Do NOT repeat the same information in English and Hungarian — the content must match but the language changes.
- Be concise and specific: always name employees, state exact hours, give concrete actionable recommendations.
- Never use vague language like "consider adjusting" — say exactly what to change.`;

app.get('/api/settings/public', requireAuth, (req, res) => {
  const budget = db.prepare('SELECT value FROM settings WHERE key = ?').get('weekly_budget');
  const promptRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('analysis_prompt');
  res.json({
    weeklyBudget: budget ? Number(budget.value) : 0,
    analysisPrompt: promptRow ? promptRow.value : DEFAULT_ANALYSIS_PROMPT,
    defaultPrompt: DEFAULT_ANALYSIS_PROMPT,
  });
});

app.post('/api/settings', requireAuth, async (req, res) => {
  const { weeklyBudget, newPassword, analysisPrompt } = req.body || {};

  if (weeklyBudget != null) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'weekly_budget', String(Number(weeklyBudget))
    );
  }

  if (analysisPrompt != null) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'analysis_prompt', analysisPrompt.trim() || DEFAULT_ANALYSIS_PROMPT
    );
  }

  if (newPassword) {
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'A jelszónak legalább 6 karakter hosszúnak kell lennie' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('admin_password_hash', hash);
  }

  res.json({ ok: true });
});

// ─── Analysis ─────────────────────────────────────────────────────────────────

app.post('/api/analyze', requireAuth, upload.array('pdf', 7), async (req, res) => {
  try {
    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : []);
    if (!files.length) return res.status(400).json({ error: 'Nincs PDF fájl csatolva' });

    const employees = db.prepare('SELECT * FROM employees ORDER BY name COLLATE NOCASE').all();
    if (employees.length === 0) {
      return res.status(400).json({ error: 'Előbb add hozzá az alkalmazottakat a Munkavállalók oldalon' });
    }

    const weekLabel = (req.body.weekLabel || '').trim();
    const customBudget = req.body.weeklyBudget ? Number(req.body.weeklyBudget) : null;
    const budgetRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('weekly_budget');
    const weeklyBudget = customBudget ?? (budgetRow ? Number(budgetRow.value) : 0);

    // Parse every uploaded PDF (allows uploading up to 7 daily reports at
    // once - one per day of the week - and combining them into a single
    // weekly analysis) - extracted WITH x/y position data so table cells can
    // be matched to the correct day column by their actual on-page position.
    const perFileParsed = [];
    for (const f of files) {
      let positionedLines, pdfText;
      try {
        positionedLines = await extractPositionedLines(f.buffer);
        pdfText = positionedLines.map(l => l.text).join('\n');
      } catch (e) {
        return res.status(400).json({ error: `Nem sikerült feldolgozni a(z) "${f.originalname}" PDF fájlt: ` + e.message });
      }
      if (!pdfText || pdfText.trim().length < 20) {
        return res.status(400).json({
          error: `Nem sikerült szöveget kinyerni a(z) "${f.originalname}" fájlból. Ellenőrizd, hogy a fájl nem szkennelt kép-e.`,
        });
      }
      const parsed = looksLikeDailySummary(positionedLines)
        ? parseDailyStoreSchedule(positionedLines, employees)
        : parseWorkcloudSchedule(positionedLines, employees);
      perFileParsed.push({ filename: f.originalname, parsed });
    }

    // Merge results from all uploaded files into one weekly view: sum each
    // employee's scheduled hours and concatenate their shifts (each shift
    // already carries its own day label, resolved independently per file -
    // e.g. one file per day of the week), then recompute status against the
    // (weekly) contracted hours once over the combined total.
    const parsedEmployees = (() => {
      if (perFileParsed.length === 1) return perFileParsed[0].parsed;
      const byName = new Map();
      for (const emp of employees) {
        byName.set(emp.name, { name: emp.name, contractedHours: emp.contracted_hours, scheduledHours: 0, shifts: [] });
      }
      const parseLog = [];
      const detectedDayLabels = [];
      for (const { filename, parsed } of perFileParsed) {
        for (const e of parsed) {
          const acc = byName.get(e.name);
          if (!acc) continue;
          acc.scheduledHours = Math.round((acc.scheduledHours + (e.scheduledHours || 0)) * 100) / 100;
          acc.shifts.push(...(e.shifts || []));
        }
        for (const entry of (parsed.parseLog || [])) parseLog.push({ ...entry, sourceFile: filename });
        for (const d of (parsed.detectedDayLabels || [])) {
          if (!detectedDayLabels.includes(d)) detectedDayLabels.push(d);
        }
      }
      const merged = [];
      for (const emp of employees) {
        const acc = byName.get(emp.name);
        const diff = Math.round((acc.scheduledHours - emp.contracted_hours) * 100) / 100;
        merged.push({
          name: emp.name,
          scheduledHours: acc.scheduledHours,
          contractedHours: emp.contracted_hours,
          difference: diff,
          status: acc.shifts.length === 0 ? 'not_found'
            : diff > 0.25 ? 'over'
            : diff < -0.25 ? 'under'
            : 'ok',
          shifts: acc.shifts,
        });
      }
      merged.parseLog = parseLog;
      merged.detectedDayLabels = detectedDayLabels;
      merged.headerLineFound = perFileParsed.map(p => p.parsed.headerLineFound).filter(Boolean).join(' | ');
      merged.isDailyFormat = perFileParsed.every(p => p.parsed.isDailyFormat);
      merged.dayLabel = null;
      merged.mergedFromFiles = perFileParsed.map(p => p.filename);
      return merged;
    })();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Az ANTHROPIC_API_KEY környezeti változó nincs beállítva' });
    }

    const client = new Anthropic({ apiKey });

    const promptRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('analysis_prompt');
    const customInstructions = promptRow ? promptRow.value : DEFAULT_ANALYSIS_PROMPT;

    const totalScheduled = Math.round(parsedEmployees.reduce((s, e) => s + e.scheduledHours, 0) * 100) / 100;
    const budgetDiff = Math.round((totalScheduled - weeklyBudget) * 100) / 100;
    const budgetStatus = budgetDiff > 0.5 ? 'over' : budgetDiff < -0.5 ? 'under' : 'ok';

    const overEmps = parsedEmployees.filter(e => e.status === 'over');
    const underEmps = parsedEmployees.filter(e => e.status === 'under');
    const notFound = parsedEmployees.filter(e => e.status === 'not_found');

    const violations = [
      ...(budgetStatus === 'over' ? [`Total scheduled hours (${totalScheduled}h) exceed weekly budget of ${weeklyBudget}h by ${budgetDiff}h`] : []),
      ...overEmps.map(e => `${e.name}: scheduled ${e.scheduledHours}h but contracted ${e.contractedHours}h (over by ${e.difference}h)`),
      ...underEmps.map(e => `${e.name}: scheduled ${e.scheduledHours}h but contracted ${e.contractedHours}h (short by ${Math.abs(e.difference)}h)`),
    ];

    const analysis = {
      weekLabel,
      employees: parsedEmployees,
      totalScheduledHours: totalScheduled,
      approvedBudget: weeklyBudget,
      budgetStatus,
      budgetDifference: budgetDiff,
      violations,
      suggestions: [],
      summary: `Week ${weekLabel}: ${totalScheduled}h scheduled vs ${weeklyBudget}h budget. ${overEmps.length} over, ${underEmps.length} under contracted hours.`,
      // Full traceable parse log: exactly what raw text was read for each
      // employee and what data was derived from it (totals, per-day shifts,
      // day-off entries) plus the detected day-column header - so the
      // extraction can be checked against the original PDF after the fact.
      parseLog: parsedEmployees.parseLog || [],
      detectedDayLabels: parsedEmployees.detectedDayLabels || [],
      headerLineFound: parsedEmployees.headerLineFound || null,
      isDailyFormat: !!parsedEmployees.isDailyFormat,
      dayLabel: parsedEmployees.dayLabel || null,
    };

    // ── Step 2: AI writes narrative analysis ──────────────────────────────────
    const empSummary = parsedEmployees
      .filter(e => e.status !== 'not_found')
      .map(e => `  ${e.name}: ${e.scheduledHours}h scheduled / ${e.contractedHours}h contracted → ${e.status.toUpperCase()} (${e.difference > 0 ? '+' : ''}${e.difference}h)`)
      .join('\n');

    // Build employee skills reference (from DB) so AI knows who is a
    // keyholder, till-trained, supervisor, etc. when checking coverage rules.
    const skillsIndex = {};
    for (const dbEmp of employees) {
      let skills = [];
      try { skills = JSON.parse(dbEmp.skills || '[]'); } catch {}
      if (skills.length) skillsIndex[dbEmp.name] = skills;
    }
    const skillLabels = {
      keyholder: 'Keyholder 🔑',
      till_trained: 'Till Trained 🛒',
      cash_office: 'Cash Office 💷',
      till_supervisor: 'Till Supervisor (TS)',
      floor_supervisor: 'Floor Supervisor (FS)',
      replen_supervisor: 'Replen Supervisor (RS)',
      forklift: 'Forklift/EPT (FT)',
      bailer: 'Bailer Trained (BA)',
      cleaning_machine: 'Cleaning Machine (CM)',
    };
    const empSkillsSummary = Object.entries(skillsIndex)
      .map(([name, skills]) => `  ${name}: ${skills.map(k => skillLabels[k] || k).join(', ')}`)
      .join('\n') || '  (no skill data recorded)';

    // Build per-day roster — include each employee's skills so the AI can
    // verify keyholder/till/floor/replen coverage per shift directly.
    const allDays = [...new Set(parsedEmployees.flatMap(e => (e.shifts||[]).map(s=>s.day)))].sort();
    const dayRosters = allDays.map(day => {
      const onShift = parsedEmployees
        .filter(e => (e.shifts||[]).some(s => s.day === day && s.start && s.end))
        .map(e => {
          const sh = (e.shifts||[]).filter(s => s.day === day && s.start && s.end);
          const skills = (skillsIndex[e.name] || []).map(k => skillLabels[k] || k).join(', ');
          return `    ${e.name} [${e.area||'?'}] ${sh.map(s=>`${s.start}-${s.end}`).join(', ')}${skills ? ` | Skills: ${skills}` : ''}`;
        });
      return `  ${day}:\n${onShift.join('\n') || '    (nobody scheduled)'}`;
    }).join('\n');

    const narrativeMessage = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `You are a rota scheduling analyst. Follow the output format in INSTRUCTIONS exactly.

INSTRUCTIONS:
${customInstructions}

WEEK: ${weekLabel || 'not specified'}
WEEKLY BUDGET: ${weeklyBudget}h | TOTAL SCHEDULED: ${totalScheduled}h | BUDGET STATUS: ${budgetStatus.toUpperCase()} (${budgetDiff > 0 ? '+' : ''}${budgetDiff}h)

EMPLOYEE HOUR COMPARISON:
${empSummary}

EMPLOYEE SKILLS (use these to determine who can fill keyholder, till, floor, replen supervisor roles):
${empSkillsSummary}

PER-DAY ROSTER (use this to check keyholder/till/floor/replen coverage for EACH day — skills are listed inline):
${dayRosters}

NOT FOUND IN SCHEDULE (${notFound.length}): ${notFound.map(e => e.name).join(', ') || 'none'}`,
      }],
    });

    analysis.narrative = narrativeMessage.content[0].text.trim();

    // Estimated AI cost for this call (Claude Sonnet pricing: $3 / MTok input, $15 / MTok output — approximate, check console.anthropic.com for exact current rates)
    const usage = narrativeMessage.usage || {};
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const PRICE_PER_MTOK_INPUT = 3;
    const PRICE_PER_MTOK_OUTPUT = 15;
    const estimatedCostUSD = Math.round(
      ((inputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT + (outputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT) * 1e6
    ) / 1e6;
    analysis.aiUsage = {
      model: 'claude-sonnet-4-6',
      inputTokens,
      outputTokens,
      estimatedCostUSD,
      note: 'Estimated from token usage at approximate published rates. The Anthropic API does not expose your account balance — check console.anthropic.com for exact billing.',
    };

    console.log(`Parsed ${parsedEmployees.length} employees. Total: ${totalScheduled}h. Over: ${overEmps.length}, Under: ${underEmps.length}. AI cost ≈ $${estimatedCostUSD} (${inputTokens} in / ${outputTokens} out tokens)`);

    db.prepare(
      `INSERT INTO analyses (week_label, filename, result_json, created_at) VALUES (?, ?, ?, datetime('now'))`
    ).run(weekLabel, files.map(f => f.originalname).join(', '), JSON.stringify(analysis));

    res.json(analysis);
  } catch (e) {
    console.error('Elemzési hiba:', e);
    res.status(500).json({ error: e.message || 'Ismeretlen hiba az elemzés során' });
  }
});

// ─── Analysis history ─────────────────────────────────────────────────────────

app.get('/api/analyses', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT id, week_label, filename, created_at FROM analyses ORDER BY created_at DESC LIMIT 30')
    .all();
  res.json(rows);
});

app.get('/api/analyses/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nem található' });
  res.json({ ...row, result: JSON.parse(row.result_json) });
});

app.delete('/api/analyses/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM analyses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Frontend static files ────────────────────────────────────────────────────

const distPath = join(__dirname, 'frontend', 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(distPath, 'index.html'));
    }
  });
} else {
  app.get('/', (_req, res) =>
    res.send('Frontend build hiányzik. Futtasd: cd frontend && npm install && npm run build')
  );
}

// ─── Catch unmatched /api routes → always return JSON ────────────────────────

app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
});

// ─── Global error handler → always return JSON ───────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Rota Planner fut: http://localhost:${PORT}`);
  console.log(`Routes: POST /api/employees/import-preview, POST /api/employees/import-confirm`);
});
