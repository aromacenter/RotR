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

function parseWorkcloudSchedule(pdfText, dbEmployees) {
  const lines = pdfText.split('\n').map(l => l.trim());

  // Find column header line to determine date positions
  // e.g. "07 Jun (Sun) 08 Jun (Mon) 09 Jun (Tue)..."
  const headerLineIdx = lines.findIndex(l =>
    /\d{2}\s+\w+\s+\(Sun\)/.test(l) || /\d{2}\s+\w+\s+\(Mon\)/.test(l)
  );

  // Extract ordered day labels from header
  let dayLabels = [];
  if (headerLineIdx >= 0) {
    const header = lines[headerLineIdx];
    const dayMatches = [...header.matchAll(/(\d{2}\s+\w{3})\s+\((\w{3})\)/g)];
    dayLabels = dayMatches.map(m => ({ date: m[1], short: m[2] }));
  }

  // Employee name pattern: "Lastname, Firstname" or "Lastname-Name, Firstname"
  const empNameRe = /^([A-Z][a-zA-ZÀ-ÖØ-öø-ÿ\-]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ]+)?,\s*[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ]+(?:\s+[A-Z][a-zA-ZÀ-ÖØ-öø-ÿ]+)?)\s*(.*)/;
  const shiftRe = /(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})(?:\s*\(([^)]+)\))?/g;
  const totalHoursRe = /\b(\d{1,3}:\d{2})\s*$/;

  const SECTION_HEADERS = new Set(['management','customer service','floor','replenishment','pricing','cleaning','total scheduled','store hours']);

  const parsed = {}; // name -> { totalHours, shifts: [{day, start, end, hours, code}] }

  let currentName = null;
  let currentLines = [];

  const flush = () => {
    if (!currentName) return;
    const block = currentLines.join(' ');

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

    // Extract shifts – we'll assign days based on position in line sequence
    // Each line that contains a shift time range is one shift
    const shifts = [];
    const dayOffDays = [];
    let dayIdx = 0;
    // The first line begins with the employee's name; strip it so any shift
    // times glued onto the same line (e.g. "Evans, Lynne 11:00 - 15:00...") are
    // still picked up, while keeping the rest of the lines as-is.
    const scanLines = currentLines.map((line, idx) =>
      idx === 0 ? line.slice(currentName.length).trim() : line
    );
    for (const line of scanLines) {
      if (/Day Off/i.test(line)) {
        const day = dayLabels[dayIdx]
          ? `${dayLabels[dayIdx].short} ${dayLabels[dayIdx].date}`
          : DAYS_ORDER[dayIdx] || `Day${dayIdx + 1}`;
        dayOffDays.push(day);
        dayIdx++;
        continue;
      }
      const shiftMatches = [...line.matchAll(/(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})(?:\s*\(([^)m][^)]*)\))?/g)];
      for (const sm of shiftMatches) {
        const code = sm[3] || '';
        if (code === 'm') continue; // skip meal breaks
        const h = timeToHours(sm[1], sm[2]);
        if (h > 0) {
          const day = dayLabels[dayIdx]
            ? `${dayLabels[dayIdx].short} ${dayLabels[dayIdx].date}`
            : DAYS_ORDER[dayIdx] || `Day${dayIdx + 1}`;
          shifts.push({ day, start: sm[1], end: sm[2], hours: h, code });
        }
        dayIdx++;
      }
    }

    parsed[currentName] = { totalHours, shifts, dayOffDays };
    currentName = null;
    currentLines = [];
  };

  // Some PDF text extractions glue a department-summary row directly onto the
  // end of an employee's row (e.g. "Evans, Lynne 11:00 - 15:00...12:00Floor23:3006:00...").
  // Strip everything from the glued department name onward so it doesn't pollute
  // the employee's shift/total parsing.
  const DEPT_GLUE_RE = /(Management|Customer Service|Floor|Replenishment|Pricing|Cleaning)\d/i;
  const stripDeptGlue = (line) => {
    const m = line.match(DEPT_GLUE_RE);
    return m ? line.slice(0, m.index).trim() : line;
  };

  for (const rawLine of lines) {
    if (!rawLine) continue;
    const lower = rawLine.toLowerCase();
    if (SECTION_HEADERS.has(lower) || /^workcloud/i.test(rawLine) || /^printed on/i.test(rawLine)) {
      flush();
      continue;
    }
    // Pure glued department-summary line (no employee name) - skip entirely
    if (DEPT_GLUE_RE.test(rawLine) && !empNameRe.test(rawLine)) continue;

    const line = stripDeptGlue(rawLine);
    if (!line) continue;

    const empMatch = line.match(empNameRe);
    if (empMatch) {
      flush();
      currentName = empMatch[1].trim();
      currentLines = [line];
    } else if (currentName) {
      currentLines.push(line);
    }
  }
  flush();

  // Match parsed entries to DB employees (fuzzy surname match)
  const result = [];
  for (const dbEmp of dbEmployees) {
    const dbSurname = dbEmp.name.split(',')[0]?.trim().toLowerCase() || '';
    // Try exact match first
    let match = parsed[dbEmp.name];
    // Try fuzzy surname match
    if (!match) {
      const key = Object.keys(parsed).find(k =>
        k.toLowerCase() === dbEmp.name.toLowerCase() ||
        k.split(',')[0]?.trim().toLowerCase() === dbSurname
      );
      if (key) match = parsed[key];
    }

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

SCHEDULE FORMAT (Workcloud):
- Each row = one employee, columns = days of the week (Sun–Sat), last column = Total Hours for the week
- Shift format: "HH:MM - HH:MM (CODE)" e.g. "09:00 - 17:00 (TL)"
- Area codes: MA=Management, TL=Till/Customer Service, FL=Floor, R=Replenishment, P=Pricing, C=Cleaning, DR=Driver
- "(m)" entries are 30-min paid meal breaks WITHIN the shift — do NOT count these as separate hours
- Night shifts cross midnight: "20:00 - 07:00" = 11 hours (next day)
- "Day Off" means the employee is not scheduled
- The TOTAL HOURS column at the end of each row is the authoritative weekly hour count — use this directly instead of recalculating

ANALYSIS FOCUS:
- Compare each employee's Total Hours against their contracted hours
- Flag anyone over contracted hours (overtime risk)
- Flag anyone under contracted hours (lost hours / undertime)
- Check if total scheduled hours across all staff exceed the weekly approved budget
- Flag coverage gaps: times when departments have insufficient cover
- Note any compliance concerns (e.g. long shifts without breaks, back-to-back night shifts)

Write your analysis in clear English. Name specific employees, state exact hour differences, and give concrete shift adjustment recommendations.`;

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

app.post('/api/analyze', requireAuth, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nincs PDF fájl csatolva' });

    const employees = db.prepare('SELECT * FROM employees ORDER BY name COLLATE NOCASE').all();
    if (employees.length === 0) {
      return res.status(400).json({ error: 'Előbb add hozzá az alkalmazottakat a Munkavállalók oldalon' });
    }

    const weekLabel = (req.body.weekLabel || '').trim();
    const customBudget = req.body.weeklyBudget ? Number(req.body.weeklyBudget) : null;
    const budgetRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('weekly_budget');
    const weeklyBudget = customBudget ?? (budgetRow ? Number(budgetRow.value) : 0);

    // Parse PDF text
    let pdfText;
    try {
      const data = await pdfParse(req.file.buffer);
      pdfText = data.text;
    } catch (e) {
      return res.status(400).json({ error: 'Nem sikerült feldolgozni a PDF fájlt: ' + e.message });
    }

    if (!pdfText || pdfText.trim().length < 20) {
      return res.status(400).json({
        error: 'Nem sikerült szöveget kinyerni a PDF-ből. Ellenőrizd, hogy a fájl nem szkennelt kép-e.',
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Az ANTHROPIC_API_KEY környezeti változó nincs beállítva' });
    }

    const client = new Anthropic({ apiKey });

    const promptRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('analysis_prompt');
    const customInstructions = promptRow ? promptRow.value : DEFAULT_ANALYSIS_PROMPT;

    // ── Step 1: Parse schedule with built-in Workcloud parser (no AI needed) ──
    const parsedEmployees = parseWorkcloudSchedule(pdfText, employees);
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
    };

    // ── Step 2: AI writes narrative analysis ──────────────────────────────────
    const empSummary = parsedEmployees
      .filter(e => e.status !== 'not_found')
      .map(e => `  ${e.name}: ${e.scheduledHours}h scheduled / ${e.contractedHours}h contracted → ${e.status.toUpperCase()} (${e.difference > 0 ? '+' : ''}${e.difference}h)`)
      .join('\n');

    const narrativeMessage = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are a rota scheduling analyst. Write a detailed rota analysis and correction plan.

INSTRUCTIONS:
${customInstructions}

WEEK: ${weekLabel || 'not specified'}
WEEKLY BUDGET: ${weeklyBudget}h | TOTAL SCHEDULED: ${totalScheduled}h | BUDGET STATUS: ${budgetStatus.toUpperCase()} (${budgetDiff > 0 ? '+' : ''}${budgetDiff}h)

EMPLOYEE HOUR COMPARISON (parsed from schedule):
${empSummary}

NOT FOUND IN SCHEDULE (${notFound.length}): ${notFound.map(e => e.name).join(', ') || 'none'}

VIOLATIONS:
${violations.join('\n') || 'None found.'}

Write plain English paragraphs (no JSON, no markdown headers, no bullet symbols). Be specific: name employees, state exact hours, give concrete shift change or swap recommendations to fix every violation. Minimum 200 words.`,
      }],
    });

    analysis.narrative = narrativeMessage.content[0].text.trim();
    console.log(`Parsed ${parsedEmployees.length} employees. Total: ${totalScheduled}h. Over: ${overEmps.length}, Under: ${underEmps.length}`);

    db.prepare(
      `INSERT INTO analyses (week_label, filename, result_json, created_at) VALUES (?, ?, ?, datetime('now'))`
    ).run(weekLabel, req.file.originalname, JSON.stringify(analysis));

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
