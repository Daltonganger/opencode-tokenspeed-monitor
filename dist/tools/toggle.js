import { tool } from "@opencode-ai/plugin";
export function createToggleTool(client, state) {
    return tool({
        description: "Toggle TokenSpeed monitor on/off",
        args: {},
        async execute() {
            state.enabled = !state.enabled;
            const status = state.enabled ? "ON" : "OFF";
            await client.app.log({
                body: {
                    service: "tokenspeed-monitor",
                    level: "info",
                    message: `TokenSpeed monitor: ${status}`,
                },
            });
            await client.tui.showToast({
                body: {
                    title: "TokenSpeed Monitor",
                    message: `Monitor is now ${state.enabled ? "enabled" : "disabled"}`,
                    variant: state.enabled ? "success" : "warning",
                    duration: 2000,
                },
            });
            return `TokenSpeed monitor: ${status}`;
        },
    });
}
//# sourceMappingURL=toggle.js.map