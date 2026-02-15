import { tool } from "@opencode-ai/plugin";
export function createBackgroundTool(state, onToggle) {
    return tool({
        description: "Toggle TokenSpeed background mode flag (API stays available)",
        args: {},
        async execute() {
            const next = !state.backgroundEnabled;
            const result = await onToggle(next);
            state.backgroundEnabled = result.enabled;
            return result.detail ?? `Background mode: ${state.backgroundEnabled ? "ON" : "OFF"}`;
        },
    });
}
//# sourceMappingURL=background.js.map