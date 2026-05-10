import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env.js";

mkdirSync(env.DATA_DIR, { recursive: true });
export const db = new Database(join(env.DATA_DIR, "vibem.sqlite"));
db.pragma("journal_mode = WAL");

// Idempotent ALTER. Wraps each in try/catch so re-running a startup is safe.
function addColumn(table: string, col: string, ddl: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  } catch (e: unknown) {
    if (!String((e as Error).message ?? "").includes("duplicate column name")) throw e;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS kpis (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL,
  unit TEXT,
  current TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vms (
  id TEXT PRIMARY KEY,
  kpi_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  mission TEXT NOT NULL,
  status TEXT NOT NULL,
  container_id TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_event_at TEXT,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  steps INTEGER NOT NULL DEFAULT 0,
  state_json TEXT,
  FOREIGN KEY (kpi_id) REFERENCES kpis(id)
);

CREATE TABLE IF NOT EXISTS evals (
  id TEXT PRIMARY KEY,
  kpi_id TEXT NOT NULL,
  cron TEXT NOT NULL,
  criteria TEXT NOT NULL,
  last_run_at TEXT,
  last_result TEXT,
  FOREIGN KEY (kpi_id) REFERENCES kpis(id)
);

CREATE TABLE IF NOT EXISTS chat_turns (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vm_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vm_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  data_json TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Strategy + per-VM eval timing — added after initial schema, ALTER for safety.
addColumn("vms", "strategy_md", "TEXT");
addColumn("vms", "user_guidance", "TEXT");
addColumn("vms", "eval_after_minutes", "INTEGER");
addColumn("vms", "evaluate_at", "TEXT"); // ISO8601 — when the deferred eval should fire
addColumn("vms", "evaluated_at", "TEXT");
addColumn("vms", "eval_result", "TEXT");
