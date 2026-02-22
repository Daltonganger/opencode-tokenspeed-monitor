import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../storage/migrations";
import type { RequestMetrics } from "../types";
import {
  enqueueRequestBucket,
  getUploadQueueEntries,
  getUploadQueueStatus,
  getPendingUploadBuckets,
  markUploadBucketFailed,
  markUploadBucketSent,
} from "./queue";

function sampleMetrics(overrides: Partial<RequestMetrics> = {}): RequestMetrics {
  return {
    id: "req-1",
    sessionID: "ses-1",
    messageID: "msg-1",
    projectID: "/tmp/project-a",
    modelID: "model-a",
    providerID: "openai",
    inputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 31,
    startedAt: 1_000,
    completedAt: 6_000,
    durationMs: 5_000,
    outputTps: 4,
    totalTps: 6.2,
    cost: 0.01,
    ...overrides,
  };
}

describe("upload queue", () => {
  test("aggregates requests per bucket key", () => {
    const db = new Database(":memory:", { strict: true });
    runMigrations(db);

    enqueueRequestBucket(db, sampleMetrics({ id: "req-1", messageID: "msg-1" }), "anon-project", 300);
    enqueueRequestBucket(
      db,
      sampleMetrics({ id: "req-2", messageID: "msg-2", outputTokens: 10, outputTps: 2, cost: 0.02 }),
      "anon-project",
      300,
    );

    const pending = getPendingUploadBuckets(db, 10);
    expect(pending.length).toBe(1);
    expect(pending[0]?.requestCount).toBe(2);
    expect(pending[0]?.outputTokens).toBe(30);
    expect(pending[0]?.totalCost).toBe(0.03);
    expect(pending[0]?.avgOutputTps).toBe(3);

    const status = getUploadQueueStatus(db);
    expect(status.pending).toBe(1);
    expect(status.total).toBe(1);

    db.close();
  });

  test("marks sent and failed states", () => {
    const db = new Database(":memory:", { strict: true });
    runMigrations(db);

    enqueueRequestBucket(db, sampleMetrics(), "anon-project", 300);
    const before = getPendingUploadBuckets(db, 10);
    expect(before.length).toBe(1);
    const id = before[0]?.id;
    expect(id).toBeTruthy();

    if (id) {
      markUploadBucketFailed(db, id, "network issue", 30);
      const afterFail = getPendingUploadBuckets(db, 10);
      expect(afterFail.length).toBe(0);

      const failedEntries = getUploadQueueEntries(db, 10);
      expect(failedEntries[0]?.status).toBe("pending");
      expect(failedEntries[0]?.attemptCount).toBe(1);

      db.query("UPDATE upload_queue SET next_attempt_at = 0 WHERE id = $id;").run({ id });
      const retriable = getPendingUploadBuckets(db, 10);
      expect(retriable.length).toBe(1);

      markUploadBucketSent(db, id);
      const afterSent = getPendingUploadBuckets(db, 10);
      expect(afterSent.length).toBe(0);

      const status = getUploadQueueStatus(db);
      expect(status.sent).toBe(1);
    }

    db.close();
  });

  test("moves bucket to dead after too many failures", () => {
    const db = new Database(":memory:", { strict: true });
    runMigrations(db);

    enqueueRequestBucket(db, sampleMetrics(), "anon-project", 300);
    const pending = getPendingUploadBuckets(db, 10);
    const id = pending[0]?.id;
    expect(id).toBeTruthy();

    if (id) {
      for (let i = 0; i < 10; i += 1) {
        markUploadBucketFailed(db, id, "still failing", 30);
      }
      const status = getUploadQueueStatus(db);
      expect(status.dead).toBe(1);
      expect(getPendingUploadBuckets(db, 10).length).toBe(0);
    }

    db.close();
  });
});
