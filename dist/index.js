import { MetricsCollector } from "./metrics/collector";
import { getAnonProjectID } from "./privacy/anon";
import { migrate } from "./storage/migrations";
import { saveRequest } from "./storage/database";
import { createTools } from "./tools";
import { startApiServer } from "./server/server";
import { startUploadDispatcher } from "./upload/dispatcher";
import { enqueueRequestBucket } from "./upload/queue";
const DEFAULT_BG_PORT = 3456;
function readStringField(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function resolveProjectRoot(input) {
    if (typeof input !== "object" || input === null)
        return process.cwd();
    const worktree = readStringField(Reflect.get(input, "worktree"));
    if (worktree)
        return worktree;
    const directory = readStringField(Reflect.get(input, "directory"));
    if (directory)
        return directory;
    return process.cwd();
}
function parsePort(value) {
    if (!value)
        return DEFAULT_BG_PORT;
    const port = Number(value);
    if (!Number.isFinite(port) || port < 0 || port > 65535)
        return DEFAULT_BG_PORT;
    return port;
}
function parseBooleanFlag(value) {
    if (!value)
        return false;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
function parsePositiveInt(value, fallback) {
    if (!value)
        return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.floor(parsed);
}
function formatMetricsLine(metrics) {
    const duration = metrics.durationMs !== undefined ? `${(metrics.durationMs / 1000).toFixed(1)}s` : "N/A";
    const tps = metrics.outputTps !== undefined ? `${metrics.outputTps} tok/s` : "N/A";
    return `${metrics.modelID} | ${tps} | ${duration}`;
}
export const TokenSpeedMonitor = async (input) => {
    const { client, $ } = input;
    const projectRoot = resolveProjectRoot(input);
    const state = {
        enabled: true,
        backgroundEnabled: true,
        apiUrl: null,
        sessionStats: {
            requestCount: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCost: 0,
        },
        activeRequests: {},
        lastMetrics: null,
    };
    const db = migrate();
    let apiServer = null;
    const bucketSeconds = parsePositiveInt(process.env.TS_UPLOAD_BUCKET_SEC, 300);
    const uploadEnabled = parseBooleanFlag(process.env.TS_UPLOAD_ENABLED);
    const uploadIntervalSeconds = parsePositiveInt(process.env.TS_UPLOAD_INTERVAL_SEC, 30);
    const hubURL = process.env.TS_HUB_URL?.trim() ?? "";
    let uploadDispatcher = null;
    const ensureApiServer = async () => {
        if (apiServer)
            return apiServer;
        const port = parsePort(process.env.TS_BG_PORT);
        apiServer = startApiServer(db, port, {
            uploadEnabled,
            uploadHubURL: hubURL || null,
            flushUploadNow: async () => {
                if (!uploadDispatcher)
                    return;
                await uploadDispatcher.flushNow();
            },
        });
        state.apiUrl = apiServer.url;
        await client.app.log({
            body: {
                service: "tokenspeed-monitor",
                level: "info",
                message: `TokenSpeed API available on ${apiServer.url}`,
            },
        });
        return apiServer;
    };
    const onCompleted = async (metrics) => {
        const storedMetrics = {
            ...metrics,
            projectID: projectRoot,
        };
        saveRequest(db, storedMetrics);
        try {
            const anonProjectID = getAnonProjectID(storedMetrics.projectID ?? "unknown-project");
            enqueueRequestBucket(db, storedMetrics, anonProjectID, bucketSeconds);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await client.app.log({
                body: {
                    service: "tokenspeed-monitor",
                    level: "warn",
                    message: `TokenSpeed queue enqueue failed: ${message}`,
                },
            });
        }
        state.sessionStats.requestCount += 1;
        state.sessionStats.totalInputTokens += storedMetrics.inputTokens;
        state.sessionStats.totalOutputTokens += storedMetrics.outputTokens;
        state.sessionStats.totalCost += storedMetrics.cost ?? 0;
        if (apiServer) {
            apiServer.publish({
                sessionID: storedMetrics.sessionID,
                messageID: storedMetrics.messageID,
                modelID: storedMetrics.modelID,
                outputTokens: storedMetrics.outputTokens,
                outputTps: storedMetrics.outputTps,
                durationMs: storedMetrics.durationMs,
                completedAt: storedMetrics.completedAt,
            });
        }
        if (!state.enabled)
            return;
        await client.app.log({
            body: {
                service: "tokenspeed-monitor",
                level: "info",
                message: `TokenSpeed: ${formatMetricsLine(storedMetrics)}`,
            },
        });
        await client.tui.showToast({
            body: {
                title: "TokenSpeed",
                message: formatMetricsLine(storedMetrics),
                variant: "info",
                duration: 3500,
            },
        });
    };
    const collector = new MetricsCollector(state, onCompleted);
    const onBackgroundToggle = async (enabled) => {
        const server = await ensureApiServer();
        state.backgroundEnabled = enabled;
        return {
            enabled: state.backgroundEnabled,
            detail: `TokenSpeed API is always ON (${server.url}).` +
                ` Background mode flag is now ${state.backgroundEnabled ? "ON" : "OFF"}.`,
        };
    };
    const getUploadInfo = () => ({
        enabled: uploadEnabled,
        hubURL: hubURL || null,
    });
    const onUploadFlush = async () => {
        if (!uploadDispatcher) {
            return {
                ok: false,
                detail: "Upload dispatcher is not enabled. Set TS_UPLOAD_ENABLED=1 and TS_HUB_URL.",
            };
        }
        await uploadDispatcher.flushNow();
        return {
            ok: true,
            detail: "Upload queue flush triggered.",
        };
    };
    await ensureApiServer();
    if (uploadEnabled && hubURL) {
        uploadDispatcher = startUploadDispatcher({
            db,
            hubURL,
            intervalSeconds: uploadIntervalSeconds,
            logger: async (message) => {
                await client.app.log({
                    body: {
                        service: "tokenspeed-monitor",
                        level: "info",
                        message,
                    },
                });
            },
        });
        await client.app.log({
            body: {
                service: "tokenspeed-monitor",
                level: "info",
                message: `TokenSpeed upload dispatcher enabled (${hubURL})`,
            },
        });
    }
    return {
        event: async ({ event }) => {
            await collector.handle(event);
        },
        tool: createTools(client, state, db, $, onBackgroundToggle, onUploadFlush, getUploadInfo),
    };
};
export default TokenSpeedMonitor;
//# sourceMappingURL=index.js.map