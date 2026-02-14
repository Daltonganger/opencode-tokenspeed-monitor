import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
export const DEFAULT_DB_PATH = "./data/tokenspeed-monitor.sqlite";
export function resolveDatabasePath(dbPath = DEFAULT_DB_PATH) {
    return resolve(process.cwd(), dbPath);
}
export function openDatabase(dbPath = DEFAULT_DB_PATH) {
    const absolutePath = resolveDatabasePath(dbPath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    const db = new Database(absolutePath, { create: true, strict: true });
    db.exec("PRAGMA journal_mode = WAL;");
    return db;
}
export function runMigrations(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      provider_id TEXT,
      agent TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      duration_ms INTEGER,
      output_tps REAL,
      total_tps REAL,
      cost REAL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS model_stats (
      model_id TEXT PRIMARY KEY,
      request_count INTEGER NOT NULL DEFAULT 0,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      avg_output_tps REAL,
      min_output_tps REAL,
      max_output_tps REAL,
      last_seen INTEGER
    );
  `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER,
      last_activity INTEGER,
      request_count INTEGER NOT NULL DEFAULT 0
    );
  `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_requests_session_id ON requests(session_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_requests_model_id ON requests(model_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_requests_started_at ON requests(started_at);");
}
export function migrate(dbPath) {
    const db = openDatabase(dbPath);
    runMigrations(db);
    return db;
}
if (import.meta.main) {
    const dbPath = process.env.TS_DB_PATH ?? DEFAULT_DB_PATH;
    const db = migrate(dbPath);
    db.close();
}
//# sourceMappingURL=migrations.js.map