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
  const { name, contractedHours, area = '', role = '', notes = '', skills = [] } = req.body || {};
  if (!name?.trim() || contractedHours == null) {
    return res.status(400).json({ error: 'Név és szerződéses óra megadása kötelező' });
  }
  const result = db
    .prepare('INSERT INTO employees (name, contracted_hours, area, role, notes, skills) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), Number(contractedHours), area.trim(), role.trim(), notes.trim(), JSON.stringify(skills));
  res.json({ id: result.lastInsertRowid, name: name.trim(), contracted_hours: Number(contractedHours), area, role, notes, skills });
});

app.put('/api/employees/:id', requireAuth, (req, res) => {
  const { name, contractedHours, area = '', role = '', notes = '', skills = [] } = req.body || {};
  if (!name?.trim() || contractedHours == null) {
    return res.status(400).json({ error: 'Hiányzó adatok' });
  }
  db.prepare('UPDATE employees SET name = ?, contracted_hours = ?, area = ?, role = ?, notes = ?, skills = ? WHERE id = ?').run(
    name.trim(), Number(contractedHours), area.trim(), role.trim(), notes.trim(), JSON.stringify(skills), req.params.id
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
    'INSERT INTO employees (name, contracted_hours, area, role, notes, skills) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const upsert = db.prepare(`
    INSERT INTO employees (name, contracted_hours, area, role, notes, skills) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      contracted_hours = excluded.contracted_hours,
      area = excluded.area,
      role = excluded.role,
      notes = excluded.notes,
      skills = excluded.skills
  `);

  let imported = 0;
  for (const emp of employees) {
    if (!emp.name?.trim()) continue;
    try {
      const skillsJson = JSON.stringify(emp.skills || []);
      if (mode === 'replace') {
        insert.run(emp.name.trim(), Number(emp.contractedHours) || 0, emp.area || '', emp.role || '', emp.notes || '', skillsJson);
      } else {
        upsert.run(emp.name.trim(), Number(emp.contractedHours) || 0, emp.area || '', emp.role || '', emp.notes || '', skillsJson);
      }
      imported++;
    } catch (e) {
      console.error('Import row error:', e.message, emp);
    }
  }

  res.json({ ok: true, imported });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

const DEFAULT_ANALYSIS_PROMPT = `You are a rota scheduling analyst. Your job is to review a weekly work schedule and provide:
1. A detailed written analysis of any issues found
2. Concrete, specific suggestions for corrections

Focus on:
- Anyone scheduled over their contracted hours (overtime risk)
- Anyone scheduled under their contracted hours (undertime / lost hours)
- Whether the total scheduled hours stay within the weekly approved budget
- Coverage gaps (days/times with too few staff)
- Any fairness or compliance concerns

Write your narrative analysis in clear English. Be specific: name the employees, state the exact hour differences, and suggest which shifts to move or swap.`;

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

    const employeeList = employees
      .map((e) => `- ${e.name} | contracted: ${e.contracted_hours}h/week | area: ${e.area || 'n/a'} | role: ${e.role || 'n/a'}`)
      .join('\n');

    const promptRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('analysis_prompt');
    const customInstructions = promptRow ? promptRow.value : DEFAULT_ANALYSIS_PROMPT;

    // ── Call 1: structured data via tool use (guaranteed valid JSON) ──────────
    const analysisTool = {
      name: 'submit_rota_analysis',
      description: 'Submit the structured rota analysis result',
      input_schema: {
        type: 'object',
        properties: {
          weekLabel: { type: 'string' },
          totalScheduledHours: { type: 'number' },
          approvedBudget: { type: 'number' },
          budgetStatus: { type: 'string', enum: ['ok', 'over', 'under'] },
          budgetDifference: { type: 'number' },
          employees: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                scheduledHours: { type: 'number' },
                contractedHours: { type: 'number' },
                difference: { type: 'number' },
                status: { type: 'string', enum: ['ok', 'over', 'under', 'not_found'] },
                shifts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      day: { type: 'string' },
                      start: { type: 'string' },
                      end: { type: 'string' },
                      hours: { type: 'number' },
                    },
                    required: ['day', 'hours'],
                  },
                },
              },
              required: ['name', 'scheduledHours', 'contractedHours', 'difference', 'status'],
            },
          },
          violations: { type: 'array', items: { type: 'string' } },
          suggestions: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['employees', 'totalScheduledHours', 'approvedBudget', 'budgetStatus'],
      },
    };

    const jsonMessage = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      tools: [analysisTool],
      tool_choice: { type: 'tool', name: 'submit_rota_analysis' },
      messages: [{
        role: 'user',
        content: `Analyse this weekly rota schedule.

EMPLOYEES (${employees.length} total – match by surname if needed):
${employeeList}

WEEKLY BUDGET: ${weeklyBudget}h | WEEK: ${weekLabel || 'not specified'}

SCHEDULE:
${pdfText.substring(0, 10000)}

Use the submit_rota_analysis tool to return the structured result.`,
      }],
    });

    const toolUse = jsonMessage.content.find((b) => b.type === 'tool_use');
    if (!toolUse) {
      const fallback = jsonMessage.content.find((b) => b.type === 'text');
      return res.status(500).json({
        error: 'Az AI nem hívta meg az elemző eszközt. Próbáld újra.',
        raw: fallback ? fallback.text.substring(0, 500) : 'no text',
      });
    }
    let analysis = toolUse.input;
    analysis.weekLabel = weekLabel;
    analysis.approvedBudget = weeklyBudget;

    // ── Call 2: narrative plain text ──────────────────────────────────────────
    const overList = (analysis.employees || []).filter(e => e.status === 'over').map(e => `${e.name} (+${e.difference}h)`).join(', ') || 'none';
    const underList = (analysis.employees || []).filter(e => e.status === 'under').map(e => `${e.name} (${e.difference}h)`).join(', ') || 'none';

    const narrativeMessage = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are a rota scheduling analyst. Write a detailed rota analysis and correction plan.

INSTRUCTIONS: ${customInstructions}

WEEK: ${weekLabel || 'not specified'} | BUDGET: ${weeklyBudget}h
TOTAL SCHEDULED: ${analysis.totalScheduledHours}h (${analysis.budgetStatus === 'over' ? 'OVER budget by ' + Math.abs(analysis.budgetDifference || 0) + 'h' : 'within budget'})
OVER contracted: ${overList}
UNDER contracted: ${underList}
VIOLATIONS: ${(analysis.violations || []).join('; ') || 'none'}

Write plain English paragraphs (no JSON, no bullet headers). Be specific: name employees, state exact hours, give concrete shift change recommendations. Min 200 words.`,
      }],
    });

    analysis.narrative = narrativeMessage.content[0].text.trim();

    db.prepare(
      'INSERT INTO analyses (week_label, filename, result_json, created_at) VALUES (?, ?, ?, datetime('now'))'
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
