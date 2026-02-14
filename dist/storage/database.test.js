import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { saveRequest, getRecentRequests, getSessionStats, getSessions } from "./database";
import { runMigrations } from "./migrations";
function sampleRequest(overrides = {}) {
    return {
        id: "req-1",
        sessionID: "ses-1",
        messageID: "msg-1",
        modelID: "model-a",
        providerID: "provider-a",
        inputTokens: 10,
        outputTokens: 20,
        reasoningTokens: 2,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        totalTokens: 32,
        startedAt: 1000,
        completedAt: 2000,
        durationMs: 1000,
        outputTps: 20,
        totalTps: 32,
        cost: 0.01,
        ...overrides,
    };
}
describe("database", () => {
    test("saves and reads request rows", () => {
        const db = new Database(":memory:", { strict: true });
        runMigrations(db);
        saveRequest(db, sampleRequest());
        const rows = getRecentRequests(db, 10);
        expect(rows.length).toBe(1);
        expect(rows[0]?.modelID).toBe("model-a");
        expect(rows[0]?.outputTokens).toBe(20);
        const totals = getSessionStats(db);
        expect(totals.requestCount).toBe(1);
        expect(totals.totalTokens).toBe(32);
        const sessions = getSessions(db, 10);
        expect(sessions.length).toBe(1);
        expect(sessions[0]?.id).toBe("ses-1");
        db.close();
    });
});
//# sourceMappingURL=database.test.js.map