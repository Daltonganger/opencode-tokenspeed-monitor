import type { PluginInput } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { PluginState } from "../types";

function platformOpenCommand(shell: PluginInput["$"], url: string) {
  switch (process.platform) {
    case "darwin":
      return shell.nothrow()`open ${url}`;
    case "linux":
      return shell.nothrow()`xdg-open ${url}`;
    case "win32":
      return shell.nothrow()`powershell -NoProfile -Command Start-Process ${url}`;
    default:
      return null;
  }
}

export function createOpenTool(
  client: PluginInput["client"],
  state: PluginState,
  shell: PluginInput["$"],
): ToolDefinition {
  return tool({
    description: "Open TokenSpeed dashboard in browser",
    args: {},
    async execute() {
      const url = state.apiUrl ? state.apiUrl : "http://localhost:3456/";
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
