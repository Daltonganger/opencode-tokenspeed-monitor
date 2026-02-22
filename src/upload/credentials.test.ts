import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHubCredential, saveHubCredential } from "./credentials";

const originalOpenCodeHome = process.env.OPENCODE_HOME;
const tempDirs: string[] = [];

afterEach(() => {
  process.env.OPENCODE_HOME = originalOpenCodeHome;
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("hub credentials store", () => {
  test("saves and loads credentials by hub and device", () => {
    const temp = mkdtempSync(join(tmpdir(), "tokenspeed-creds-"));
    tempDirs.push(temp);
    process.env.OPENCODE_HOME = temp;

    saveHubCredential("https://hub.example.test", "dev_1", "key_1");
    saveHubCredential("https://hub.example.test", "dev_2", "key_2");

    const exact = loadHubCredential("https://hub.example.test", "dev_1");
    expect(exact?.deviceID).toBe("dev_1");
    expect(exact?.signingKey).toBe("key_1");

    const fallback = loadHubCredential("https://hub.example.test");
    expect(fallback?.deviceID).toBeTruthy();
    expect(fallback?.signingKey).toBeTruthy();
  });
});
