import type { Event } from "@opencode-ai/sdk";
import type { PluginState, RequestMetrics } from "../types";
type CompletedHandler = (metrics: RequestMetrics) => Promise<void> | void;
export declare class MetricsCollector {
    private readonly state;
    private readonly onCompleted;
    constructor(state: PluginState, onCompleted: CompletedHandler);
    handle(event: Event): Promise<void>;
}
export {};
//# sourceMappingURL=collector.d.ts.map