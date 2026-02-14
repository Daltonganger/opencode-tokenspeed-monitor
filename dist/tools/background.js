import { tool } from "@opencode-ai/plugin";
export function createBackgroundTool(state, onToggle) {
    return tool({
        description: "Toggle background collection mode for TokenSpeed API",
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