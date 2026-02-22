import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, resolveDatabasePath, runMigrations } from "./migrations";

const ORIGINAL_ENV = {
  TS_DB_PATH: process.env.TS_DB_PATH,
  OPENCODE_HOME: process.env.OPENCODE_HOME,
};

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tokenspeed-monitor-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.env.TS_DB_PATH = ORIGINAL_ENV.TS_DB_PATH;
  process.env.OPENCODE_HOME = ORIGINAL_ENV.OPENCODE_HOME;
});

describe("migrations path resolution", () => {
  test("uses TS_DB_PATH override when set", () => {
    const temp = makeTempDir();
    process.env.TS_DB_PATH = join(temp, "custom", "monitor.sqlite");
    process.env.OPENCODE_HOME = join(temp, "opencode-home");

    const path = resolveDatabasePath();
    expect(path).toBe(join(temp, "custom", "monitor.sqlite"));
  });

  test("uses OPENCODE_HOME when TS_DB_PATH is not set", () => {
    const temp = makeTempDir();
    process.env.TS_DB_PATH = "";
    process.env.OPENCODE_HOME = join(temp, "opencode-home");

    const path = resolveDatabasePath();
    expect(path).toBe(join(temp, "opencode-home", "tokenspeed-monitor", "tokenspeed-monitor.sqlite"));
  });

  test("creates default database under resolved OpenCode path", () => {
    const temp = makeTempDir();
    process.env.TS_DB_PATH = "";
    process.env.OPENCODE_HOME = join(temp, "opencode-home");

    const db = openDatabase();
    db.exec("CREATE TABLE IF NOT EXISTS smoke_test (id INTEGER PRIMARY KEY);");
    runMigrations(db);

    const expectedPath = resolve(
      join(temp, "opencode-home", "tokenspeed-monitor", "tokenspeed-monitor.sqlite"),
    );
    expect(existsSync(expectedPath)).toBe(true);

    const queueInfo = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='upload_queue';")
      .get();
    expect(queueInfo?.name).toBe("upload_queue");

    db.close();
  });
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});
