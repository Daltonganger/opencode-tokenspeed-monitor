import { tool } from "@opencode-ai/plugin";
import { getModelStats, getSessionStats } from "../storage/database";
export function createStatsTool(db) {
    return tool({
        description: "Show session totals and model stats",
        args: {},
        async execute() {
            const totals = getSessionStats(db);
            const models = getModelStats(db).slice(0, 5);
            const lines = [
                `Requests: ${totals.requestCount}`,
                `Input tokens: ${totals.totalInputTokens}`,
                `Output tokens: ${totals.totalOutputTokens}`,
                `Total tokens: ${totals.totalTokens}`,
                `Total cost: ${totals.totalCost}`,
            ];
            if (models.length > 0) {
                lines.push("Top models:");
                for (const model of models) {
                    lines.push(`- ${model.modelID}: req=${model.requestCount}, avgOutTPS=${model.avgOutputTps ?? "N/A"}`);
                }
            }
            return lines.join("\n");
        },
    });
}
//# sourceMappingURL=stats.js.map