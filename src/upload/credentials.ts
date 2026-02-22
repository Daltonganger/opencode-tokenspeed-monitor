import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveOpenCodeHome } from "../storage/migrations";

type StoredCredential = {
  hubURL: string;
  deviceID: string;
  signingKey: string;
  updatedAt: number;
};

type CredentialStore = {
  credentials: StoredCredential[];
};

function normalizeHubURL(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function resolveCredentialPath(): string {
  return join(resolveOpenCodeHome(), "tokenspeed-monitor", "hub-credentials.json");
}

function readStore(): CredentialStore {
  const path = resolveCredentialPath();
  if (!existsSync(path)) return { credentials: [] };

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { credentials?: unknown }).credentials)) {
      const credentials = (parsed as { credentials: unknown[] }).credentials
        .filter(item => typeof item === "object" && item !== null)
        .map(item => item as StoredCredential)
        .filter(item =>
          typeof item.hubURL === "string" &&
          typeof item.deviceID === "string" &&
          typeof item.signingKey === "string" &&
          typeof item.updatedAt === "number",
        );
      return { credentials };
    }
  } catch {
    return { credentials: [] };
  }

  return { credentials: [] };
}

function writeStore(store: CredentialStore): void {
  const path = resolveCredentialPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function loadHubCredential(hubURL: string, preferredDeviceID?: string): { deviceID: string; signingKey: string } | null {
  const normalized = normalizeHubURL(hubURL);
  const store = readStore();

  const matches = store.credentials
    .filter(item => normalizeHubURL(item.hubURL) === normalized)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (matches.length === 0) return null;

  const preferred = preferredDeviceID
    ? matches.find(item => item.deviceID === preferredDeviceID)
    : null;

  const selected = preferred ?? matches[0] ?? null;
  if (!selected) return null;
  return {
    deviceID: selected.deviceID,
    signingKey: selected.signingKey,
  };
}

export function saveHubCredential(hubURL: string, deviceID: string, signingKey: string): void {
  const normalized = normalizeHubURL(hubURL);
  const store = readStore();
  const updatedAt = Date.now();

  const existingIndex = store.credentials.findIndex(
    item => normalizeHubURL(item.hubURL) === normalized && item.deviceID === deviceID,
  );

  const record: StoredCredential = {
    hubURL: normalized,
    deviceID,
    signingKey,
    updatedAt,
  };

  if (existingIndex >= 0) {
    store.credentials[existingIndex] = record;
  } else {
    store.credentials.push(record);
  }

  writeStore(store);
}
