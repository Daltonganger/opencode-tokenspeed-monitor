import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { Database } from "bun:sqlite";
import { getRecentRequests } from "../storage/database";

export function createHistoryTool(db: Database): ToolDefinition {
  return tool({
    description: "Show recent TokenSpeed requests",
    args: {
      limit: tool.schema.number().int().min(1).max(50).optional().describe("Number of rows to show (default 10)"),
    },
    async execute(args) {
      const limit = args.limit ?? 10;
      const rows = getRecentRequests(db, limit);

      if (rows.length === 0) {
        return "No request history yet.";
      }

      return rows
        .map((row, idx) => {
          const ts = new Date(row.completedAt ?? row.startedAt).toISOString();
          const tps = row.outputTps ?? 0;
          const duration = row.durationMs !== undefined ? `${(row.durationMs / 1000).toFixed(1)}s` : "N/A";
          return `${idx + 1}. ${ts} | ${row.modelID} | out=${row.outputTokens} | tps=${tps} | dur=${duration}`;
        })
        .join("\n");
    },
  });
}
