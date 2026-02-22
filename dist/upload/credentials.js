import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveOpenCodeHome } from "../storage/migrations";
function normalizeHubURL(input) {
    return input.trim().replace(/\/+$/, "");
}
function resolveCredentialPath() {
    return join(resolveOpenCodeHome(), "tokenspeed-monitor", "hub-credentials.json");
}
function readStore() {
    const path = resolveCredentialPath();
    if (!existsSync(path))
        return { credentials: [] };
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.credentials)) {
            const credentials = parsed.credentials
                .filter(item => typeof item === "object" && item !== null)
                .map(item => item)
                .filter(item => typeof item.hubURL === "string" &&
                typeof item.deviceID === "string" &&
                typeof item.signingKey === "string" &&
                typeof item.updatedAt === "number");
            return { credentials };
        }
    }
    catch {
        return { credentials: [] };
    }
    return { credentials: [] };
}
function writeStore(store) {
    const path = resolveCredentialPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}
export function loadHubCredential(hubURL, preferredDeviceID) {
    const normalized = normalizeHubURL(hubURL);
    const store = readStore();
    const matches = store.credentials
        .filter(item => normalizeHubURL(item.hubURL) === normalized)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    if (matches.length === 0)
        return null;
    const preferred = preferredDeviceID
        ? matches.find(item => item.deviceID === preferredDeviceID)
        : null;
    const selected = preferred ?? matches[0] ?? null;
    if (!selected)
        return null;
    return {
        deviceID: selected.deviceID,
        signingKey: selected.signingKey,
    };
}
export function saveHubCredential(hubURL, deviceID, signingKey) {
    const normalized = normalizeHubURL(hubURL);
    const store = readStore();
    const updatedAt = Date.now();
    const existingIndex = store.credentials.findIndex(item => normalizeHubURL(item.hubURL) === normalized && item.deviceID === deviceID);
    const record = {
        hubURL: normalized,
        deviceID,
        signingKey,
        updatedAt,
    };
    if (existingIndex >= 0) {
        store.credentials[existingIndex] = record;
    }
    else {
        store.credentials.push(record);
    }
    writeStore(store);
}
//# sourceMappingURL=credentials.js.map