import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, 'rota.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    contracted_hours REAL NOT NULL DEFAULT 0,
    area TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_label TEXT,
    filename TEXT,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrate existing DB: add columns if missing
for (const col of [
  "ALTER TABLE employees ADD COLUMN area TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE employees ADD COLUMN role TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE employees ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE employees ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE employees ADD COLUMN work_days REAL NOT NULL DEFAULT 0",
]) {
  try { db.exec(col); } catch { /* column already exists */ }
}

export default db;
