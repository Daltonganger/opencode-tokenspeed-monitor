import { tool } from "@opencode-ai/plugin";
import { getUploadQueueEntries, getUploadQueueStatus } from "../upload/queue";
function formatQueueStatus(db, getUploadInfo) {
    const uploadInfo = getUploadInfo();
    const status = getUploadQueueStatus(db);
    const queue = getUploadQueueEntries(db, 5);
    const lines = [
        `Upload enabled: ${uploadInfo.enabled ? "YES" : "NO"}`,
        `Hub URL: ${uploadInfo.hubURL ?? "not configured"}`,
        `Queue pending: ${status.pending}, sent: ${status.sent}, dead: ${status.dead}, total: ${status.total}`,
    ];
    if (queue.length > 0) {
        lines.push("Recent queue entries:");
        for (const item of queue) {
            lines.push(`- ${item.status} | ${item.providerID}/${item.modelID} | req=${item.requestCount} | bucket=${item.bucketStart}-${item.bucketEnd} | tries=${item.attemptCount}`);
        }
    }
    return lines.join("\n");
}
export function createUploadStatusTool(db, getUploadInfo) {
    return tool({
        description: "Show upload queue status and hub config",
        args: {},
        async execute() {
            return formatQueueStatus(db, getUploadInfo);
        },
    });
}
export function createUploadFlushTool(db, onFlush, getUploadInfo) {
    return tool({
        description: "Flush upload queue now",
        args: {},
        async execute() {
            const result = await onFlush();
            const suffix = formatQueueStatus(db, getUploadInfo);
            return `${result.detail}\n\n${suffix}`;
        },
    });
}
//# sourceMappingURL=upload.js.map