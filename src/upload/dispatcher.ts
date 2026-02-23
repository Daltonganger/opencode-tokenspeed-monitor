import { createHmac, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import { getAnonDeviceID, getAnonUserID } from "../privacy/anon";
import { loadHubCredential, saveHubCredential } from "./credentials";
import {
  getPendingUploadBuckets,
  markUploadBucketFailed,
  markUploadBucketSent,
  type UploadBucketPayload,
} from "./queue";

export interface UploadDispatcherHandle {
  flushNow(): Promise<void>;
  stop(): void;
}

type UploadDispatcherOptions = {
  db: Database;
  hubURL: string;
  intervalSeconds?: number;
  logger?: (message: string) => Promise<void> | void;
};

type RegisterResponse = {
  deviceId: string;
  anonUserId?: string;
  signingKey: string;
  status: string;
};

function computeSignature(payload: string, timestamp: string, nonce: string, signingKey: string): string {
  const input = `${timestamp}.${nonce}.${payload}`;
  return createHmac("sha256", signingKey).update(input).digest("hex");
}

function retryDelaySeconds(attemptCount: number): number {
  return Math.min(900, 2 ** Math.min(8, attemptCount + 1));
}

async function registerDevice(
  hubURL: string,
  inviteToken: string,
  desiredDeviceID: string,
  anonUserID: string,
): Promise<RegisterResponse> {
  const endpoint = `${hubURL.replace(/\/$/, "")}/v1/devices/register`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceId: desiredDeviceID,
      anonUserId: anonUserID,
      inviteToken,
      label: process.env.TS_HUB_DEVICE_LABEL?.trim() || undefined,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`register failed: HTTP ${response.status}: ${message}`);
  }

  const body = (await response.json()) as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { deviceId?: unknown }).deviceId !== "string" ||
    typeof (body as { signingKey?: unknown }).signingKey !== "string"
  ) {
    throw new Error("register failed: invalid response schema");
  }

  return {
    deviceId: (body as { deviceId: string }).deviceId,
    signingKey: (body as { signingKey: string }).signingKey,
    status: typeof (body as { status?: unknown }).status === "string" ? (body as { status: string }).status : "unknown",
  };
}

async function uploadBucket(
  hubURL: string,
  bucket: UploadBucketPayload,
  deviceID: string,
  signingKey: string,
): Promise<Response> {
  const endpoint = `${hubURL.replace(/\/$/, "")}/v1/ingest/buckets`;
  const payloadObject = {
    schemaVersion: 1,
    deviceId: deviceID,
    buckets: [
      {
        bucketStart: bucket.bucketStart,
        bucketEnd: bucket.bucketEnd,
        anonProjectId: bucket.anonProjectID,
        providerId: bucket.providerID,
        modelId: bucket.modelID,
        requestCount: bucket.requestCount,
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        reasoningTokens: bucket.reasoningTokens,
        cacheReadTokens: bucket.cacheReadTokens,
        cacheWriteTokens: bucket.cacheWriteTokens,
        totalCost: bucket.totalCost,
        avgOutputTps: bucket.avgOutputTps,
        minOutputTps: bucket.minOutputTps,
        maxOutputTps: bucket.maxOutputTps,
      },
    ],
  };

  const payload = JSON.stringify(payloadObject);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(12).toString("hex");
  const signature = computeSignature(payload, timestamp, nonce, signingKey);

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-TS-Device-ID": deviceID,
      "X-TS-Timestamp": timestamp,
      "X-TS-Nonce": nonce,
      "X-TS-Signature": signature,
    },
    body: payload,
  });
}

async function bootstrapDevice(
  hubURL: string,
  desiredDeviceID: string,
  anonUserID: string,
): Promise<RegisterResponse> {
  const endpoint = `${hubURL.replace(/\/$/, "")}/v1/devices/bootstrap`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceId: desiredDeviceID,
      anonUserId: anonUserID,
      label: process.env.TS_HUB_DEVICE_LABEL?.trim() || undefined,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`bootstrap failed: HTTP ${response.status}: ${message}`);
  }

  const body = (await response.json()) as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { deviceId?: unknown }).deviceId !== "string" ||
    typeof (body as { signingKey?: unknown }).signingKey !== "string"
  ) {
    throw new Error("bootstrap failed: invalid response schema");
  }

  return {
    deviceId: (body as { deviceId: string }).deviceId,
    anonUserId:
      typeof (body as { anonUserId?: unknown }).anonUserId === "string"
        ? (body as { anonUserId: string }).anonUserId
        : undefined,
    signingKey: (body as { signingKey: string }).signingKey,
    status: typeof (body as { status?: unknown }).status === "string" ? (body as { status: string }).status : "unknown",
  };
}

export function startUploadDispatcher(options: UploadDispatcherOptions): UploadDispatcherHandle {
  const intervalSeconds = Math.max(5, options.intervalSeconds ?? 30);
  let deviceID = process.env.TS_HUB_DEVICE_ID?.trim() || getAnonDeviceID();
  const anonUserID = process.env.TS_HUB_ANON_USER_ID?.trim() || getAnonUserID();
  let signingKey = process.env.TS_HUB_SIGNING_KEY?.trim() || "";
  const inviteToken = process.env.TS_HUB_INVITE_TOKEN?.trim() || "";
  let nextRegisterAttemptAt = 0;
  const log = async (message: string) => {
    if (options.logger) await options.logger(message);
  };

  if (!signingKey) {
    const saved = loadHubCredential(options.hubURL, deviceID);
    if (saved) {
      deviceID = saved.deviceID;
      signingKey = saved.signingKey;
    }
  }

  let stopped = false;
  let inFlight = false;

  const ensureCredentials = async (): Promise<boolean> => {
    if (signingKey) return true;

    const now = Date.now();
    if (nextRegisterAttemptAt > now) return false;

    try {
      const registered = inviteToken
        ? await registerDevice(options.hubURL, inviteToken, deviceID, anonUserID)
        : await bootstrapDevice(options.hubURL, deviceID, anonUserID);
      deviceID = registered.deviceId;
      signingKey = registered.signingKey;
      saveHubCredential(options.hubURL, deviceID, signingKey);
      nextRegisterAttemptAt = 0;
      await log(`TokenSpeed upload device registered: ${deviceID}${registered.anonUserId ? ` (${registered.anonUserId})` : ""}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nextRegisterAttemptAt = now + 60_000;
      await log(`TokenSpeed upload registration failed: ${message}`);
      return false;
    }
  };

  const flushNow = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const hasCredentials = await ensureCredentials();
      if (!hasCredentials) {
        await log("TokenSpeed upload skipped: no device credentials configured.");
        return;
      }

      const pending = getPendingUploadBuckets(options.db, 20);
      if (pending.length === 0) return;

      for (const bucket of pending) {
        try {
          const response = await uploadBucket(options.hubURL, bucket, deviceID, signingKey);
          if (response.ok) {
            markUploadBucketSent(options.db, bucket.id);
          } else {
            const responseText = await response.text();
            if (response.status === 403 && inviteToken) {
              signingKey = "";
              nextRegisterAttemptAt = 0;
            }
            markUploadBucketFailed(
              options.db,
              bucket.id,
              `HTTP ${response.status}: ${responseText}`,
              retryDelaySeconds(bucket.attemptCount),
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          markUploadBucketFailed(options.db, bucket.id, message, retryDelaySeconds(bucket.attemptCount));
        }
      }
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void flushNow();
  }, intervalSeconds * 1000);

  void flushNow();

  return {
    flushNow,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
