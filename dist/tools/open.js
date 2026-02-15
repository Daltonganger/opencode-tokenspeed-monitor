import { tool } from "@opencode-ai/plugin";
function platformOpenCommand(shell, url) {
    switch (process.platform) {
        case "darwin":
            return shell.nothrow() `open ${url}`;
        case "linux":
            return shell.nothrow() `xdg-open ${url}`;
        case "win32":
            return shell.nothrow() `powershell -NoProfile -Command Start-Process ${url}`;
        default:
            return null;
    }
}
export function createOpenTool(client, state, shell) {
    return tool({
        description: "Open TokenSpeed API page in browser",
        args: {},
        async execute() {
            const url = state.apiUrl ? `${state.apiUrl}api/stats` : "http://localhost:3456/api/stats";
            const command = platformOpenCommand(shell, url);
            let opened = false;
            if (command) {
                const result = await command;
                opened = result.exitCode === 0;
            }
            await client.app.log({
                body: {
                    service: "tokenspeed-monitor",
                    level: "info",
                    message: opened
                        ? `TokenSpeed page opened: ${url}`
                        : `TokenSpeed page URL: ${url}`,
                },
            });
            await client.tui.showToast({
                body: {
                    title: "TokenSpeed",
                    message: opened ? "Opened TokenSpeed page" : "TokenSpeed page URL ready",
                    variant: "info",
                    duration: 2500,
                },
            });
            return opened ? `Opened ${url}` : `Open this URL: ${url}`;
        },
    });
}
//# sourceMappingURL=open.js.map