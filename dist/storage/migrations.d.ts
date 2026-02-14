import { Database } from "bun:sqlite";
export declare const DEFAULT_DB_PATH = "./data/tokenspeed-monitor.sqlite";
export declare function resolveDatabasePath(dbPath?: string): string;
export declare function openDatabase(dbPath?: string): Database;
export declare function runMigrations(db: Database): void;
export declare function migrate(dbPath?: string): Database;
//# sourceMappingURL=migrations.d.ts.map