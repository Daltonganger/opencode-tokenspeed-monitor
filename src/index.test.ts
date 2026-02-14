import { describe, expect, test } from "bun:test";
import { TokenSpeedMonitor } from "./index";

function createMockClient() {
  const logs: string[] = [];
  const toasts: string[] = [];

  return {
    logs,
    toasts,
    client: {
      app: {
        log: async (input: { body?: { message?: string } }) => {
          if (input.body?.message) logs.push(input.body.message);
          return true;
        },
      },
      tui: {
        showToast: async (input: { body?: { message?: string } }) => {
          if (input.body?.message) toasts.push(input.body.message);
          return true;
        },
      },
    },
  };
}

describe("plugin entry", () => {
  test("creates hooks and exposes expected tools", async () => {
    const mock = createMockClient();
    const hooks = await TokenSpeedMonitor({
      client: mock.client as never,
      project: {} as never,
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    expect(typeof hooks.event).toBe("function");
    expect(hooks.tool).toBeDefined();
    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([
      "ts",
      "ts-bg",
      "ts-history",
      "ts-stats",
      "ts-status",
    ]);
  });

  test("toggle tool flips state and emits log/toast", async () => {
    const mock = createMockClient();
    const hooks = await TokenSpeedMonitor({
      client: mock.client as never,
      project: {} as never,
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost"),
      $: {} as never,
    });

    const toggle = hooks.tool?.ts;
    expect(toggle).toBeDefined();
    const result = await toggle!.execute({}, {
      sessionID: "ses-1",
      messageID: "msg-1",
      agent: "general",
      directory: process.cwd(),
      worktree: process.cwd(),
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    });

    expect(result.includes("TokenSpeed monitor")).toBe(true);
    expect(mock.logs.length).toBeGreaterThan(0);
    expect(mock.toasts.length).toBeGreaterThan(0);
  });
});
