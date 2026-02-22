import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
export const LEGACY_DB_PATH = "./data/tokenspeed-monitor.sqlite";
export const DEFAULT_DB_FILE = "tokenspeed-monitor.sqlite";
function resolvePathFromEnv(value) {
    return isAbsolute(value) ? value : resolve(process.cwd(), value);
}
export function resolveOpenCodeHome() {
    const configured = process.env.OPENCODE_HOME?.trim();
    if (configured)
        return resolvePathFromEnv(configured);
    return resolve(homedir(), ".local", "share", "opencode");
}
export function resolveDefaultDatabasePath() {
    return join(resolveOpenCodeHome(), "tokenspeed-monitor", DEFAULT_DB_FILE);
}
export function resolveDatabasePath(dbPath) {
    const direct = dbPath?.trim();
    if (direct)
        return resolvePathFromEnv(direct);
    const envPath = process.env.TS_DB_PATH?.trim();
    if (envPath)
        return resolvePathFromEnv(envPath);
    return resolveDefaultDatabasePath();
}
function maybeMigrateLegacyDatabase(targetPath) {
    if (process.env.TS_DB_PATH?.trim())
        return;
    const legacyPath = resolve(process.cwd(), LEGACY_DB_PATH);
    if (legacyPath === targetPath)
        return;
    if (!existsSync(legacyPath) || existsSync(targetPath))
        return;
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(legacyPath, targetPath);
}
export function openDatabase(dbPath) {
    const absolutePath = resolveDatabasePath(dbPath);
    maybeMigrateLegacyDatabase(absolutePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    const db = new Database(absolutePath, { create: true, strict: true });
    db.exec("PRAGMA journal_mode = WAL;");
    return db;
}
function columnExists(db, tableName, columnName) {
    const rows = db.query(`PRAGMA table_info(${tableName});`).all();
    return rows.some(row => row.name === columnName);
}
function ensureColumn(db, tableName, columnName, sqlType) {
    if (!columnExists(db, tableName, columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType};`);
    }
}
export function runMigrations(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      project_id TEXT,
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
      project_id TEXT,
      started_at INTEGER,
      last_activity INTEGER,
      request_count INTEGER NOT NULL DEFAULT 0
    );
  `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen INTEGER
    );
  `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS upload_queue (
      id TEXT PRIMARY KEY,
      bucket_start INTEGER NOT NULL,
      bucket_end INTEGER NOT NULL,
      anon_project_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      output_tps_sum REAL NOT NULL DEFAULT 0,
      output_tps_count INTEGER NOT NULL DEFAULT 0,
      output_tps_min REAL,
      output_tps_max REAL,
      last_seen INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      sent_at INTEGER
    );
  `);
    ensureColumn(db, "requests", "project_id", "TEXT");
    ensureColumn(db, "sessions", "project_id", "TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_requests_session_id ON requests(session_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_requests_project_id ON requests(project_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_requests_model_id ON requests(model_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_requests_provider_id ON requests(provider_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_requests_started_at ON requests(started_at);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_projects_last_seen ON projects(last_seen);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_upload_queue_pending ON upload_queue(status, next_attempt_at, bucket_start);");
}
export function migrate(dbPath) {
    const db = openDatabase(dbPath);
    runMigrations(db);
    return db;
}
if (import.meta.main) {
    const db = migrate(process.env.TS_DB_PATH);
    db.close();
}
//# sourceMappingURL=migrations.js.map