import { createHmac, randomBytes } from "node:crypto";
import { getAnonDeviceID } from "../privacy/anon";
import { loadHubCredential, saveHubCredential } from "./credentials";
import { getPendingUploadBuckets, markUploadBucketFailed, markUploadBucketSent, } from "./queue";
function computeSignature(payload, timestamp, nonce, signingKey) {
    const input = `${timestamp}.${nonce}.${payload}`;
    return createHmac("sha256", signingKey).update(input).digest("hex");
}
function retryDelaySeconds(attemptCount) {
    return Math.min(900, 2 ** Math.min(8, attemptCount + 1));
}
async function registerDevice(hubURL, inviteToken, desiredDeviceID) {
    const endpoint = `${hubURL.replace(/\/$/, "")}/v1/devices/register`;
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            deviceId: desiredDeviceID,
            inviteToken,
            label: process.env.TS_HUB_DEVICE_LABEL?.trim() || undefined,
        }),
    });
    if (!response.ok) {
        const message = await response.text();
        throw new Error(`register failed: HTTP ${response.status}: ${message}`);
    }
    const body = (await response.json());
    if (typeof body !== "object" ||
        body === null ||
        typeof body.deviceId !== "string" ||
        typeof body.signingKey !== "string") {
        throw new Error("register failed: invalid response schema");
    }
    return {
        deviceId: body.deviceId,
        signingKey: body.signingKey,
        status: typeof body.status === "string" ? body.status : "unknown",
    };
}
async function uploadBucket(hubURL, bucket, deviceID, signingKey) {
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
export function startUploadDispatcher(options) {
    const intervalSeconds = Math.max(5, options.intervalSeconds ?? 30);
    let deviceID = process.env.TS_HUB_DEVICE_ID?.trim() || getAnonDeviceID();
    let signingKey = process.env.TS_HUB_SIGNING_KEY?.trim() || "";
    const inviteToken = process.env.TS_HUB_INVITE_TOKEN?.trim() || "";
    let nextRegisterAttemptAt = 0;
    const log = async (message) => {
        if (options.logger)
            await options.logger(message);
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
    const ensureCredentials = async () => {
        if (signingKey)
            return true;
        if (!inviteToken)
            return false;
        const now = Date.now();
        if (nextRegisterAttemptAt > now)
            return false;
        try {
            const registered = await registerDevice(options.hubURL, inviteToken, deviceID);
            deviceID = registered.deviceId;
            signingKey = registered.signingKey;
            saveHubCredential(options.hubURL, deviceID, signingKey);
            nextRegisterAttemptAt = 0;
            await log(`TokenSpeed upload device registered: ${deviceID}`);
            return true;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            nextRegisterAttemptAt = now + 60_000;
            await log(`TokenSpeed upload registration failed: ${message}`);
            return false;
        }
    };
    const flushNow = async () => {
        if (stopped || inFlight)
            return;
        inFlight = true;
        try {
            const hasCredentials = await ensureCredentials();
            if (!hasCredentials) {
                await log("TokenSpeed upload skipped: no device credentials configured.");
                return;
            }
            const pending = getPendingUploadBuckets(options.db, 20);
            if (pending.length === 0)
                return;
            for (const bucket of pending) {
                try {
                    const response = await uploadBucket(options.hubURL, bucket, deviceID, signingKey);
                    if (response.ok) {
                        markUploadBucketSent(options.db, bucket.id);
                    }
                    else {
                        const responseText = await response.text();
                        if (response.status === 403 && inviteToken) {
                            signingKey = "";
                            nextRegisterAttemptAt = 0;
                        }
                        markUploadBucketFailed(options.db, bucket.id, `HTTP ${response.status}: ${responseText}`, retryDelaySeconds(bucket.attemptCount));
                    }
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    markUploadBucketFailed(options.db, bucket.id, message, retryDelaySeconds(bucket.attemptCount));
                }
            }
        }
        finally {
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
//# sourceMappingURL=dispatcher.js.map