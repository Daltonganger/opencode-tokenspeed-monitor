import { MetricsCollector } from "./metrics/collector";
import { migrate } from "./storage/migrations";
import { saveRequest } from "./storage/database";
import { createTools } from "./tools";
import { startApiServer } from "./server/server";
const DEFAULT_BG_PORT = 3456;
function parsePort(value) {
    if (!value)
        return DEFAULT_BG_PORT;
    const port = Number(value);
    if (!Number.isFinite(port) || port < 0 || port > 65535)
        return DEFAULT_BG_PORT;
    return port;
}
function formatMetricsLine(metrics) {
    const duration = metrics.durationMs !== undefined ? `${(metrics.durationMs / 1000).toFixed(1)}s` : "N/A";
    const tps = metrics.outputTps !== undefined ? `${metrics.outputTps} tok/s` : "N/A";
    return `${metrics.modelID} | ${tps} | ${duration}`;
}
export const TokenSpeedMonitor = async ({ client }) => {
    const state = {
        enabled: true,
        backgroundEnabled: true,
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
    const ensureApiServer = async () => {
        if (apiServer)
            return apiServer;
        const port = parsePort(process.env.TS_BG_PORT);
        apiServer = startApiServer(db, port);
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
        saveRequest(db, metrics);
        state.sessionStats.requestCount += 1;
        state.sessionStats.totalInputTokens += metrics.inputTokens;
        state.sessionStats.totalOutputTokens += metrics.outputTokens;
        state.sessionStats.totalCost += metrics.cost ?? 0;
        if (apiServer) {
            apiServer.publish({
                sessionID: metrics.sessionID,
                messageID: metrics.messageID,
                modelID: metrics.modelID,
                outputTokens: metrics.outputTokens,
                outputTps: metrics.outputTps,
                durationMs: metrics.durationMs,
                completedAt: metrics.completedAt,
            });
        }
        if (!state.enabled)
            return;
        await client.app.log({
            body: {
                service: "tokenspeed-monitor",
                level: "info",
                message: `TokenSpeed: ${formatMetricsLine(metrics)}`,
            },
        });
        await client.tui.showToast({
            body: {
                title: "TokenSpeed",
                message: formatMetricsLine(metrics),
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
    await ensureApiServer();
    return {
        event: async ({ event }) => {
            await collector.handle(event);
        },
        tool: createTools(client, state, db, onBackgroundToggle),
    };
};
export default TokenSpeedMonitor;
//# sourceMappingURL=index.js.map