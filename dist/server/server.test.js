import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { saveRequest } from "../storage/database";
import { runMigrations } from "../storage/migrations";
import { startApiServer } from "./server";
describe("api server", () => {
    test("serves stats and history endpoints", async () => {
        const db = new Database(":memory:", { strict: true });
        runMigrations(db);
        saveRequest(db, {
            id: "req-1",
            sessionID: "ses-1",
            messageID: "msg-1",
            modelID: "model-a",
            inputTokens: 10,
            outputTokens: 20,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 30,
            startedAt: 1000,
            completedAt: 2000,
            durationMs: 1000,
            outputTps: 20,
            totalTps: 30,
            cost: 0.01,
        });
        const server = startApiServer(db, 0);
        const statsRes = await fetch(`${server.url}api/stats`);
        expect(statsRes.status).toBe(200);
        const stats = await statsRes.json();
        expect(stats.requestCount).toBe(1);
        const historyRes = await fetch(`${server.url}api/history?limit=10`);
        expect(historyRes.status).toBe(200);
        const history = await historyRes.json();
        expect(Array.isArray(history)).toBe(true);
        expect(history.length).toBe(1);
        await server.stop();
        db.close();
    });
});
//# sourceMappingURL=server.test.js.map