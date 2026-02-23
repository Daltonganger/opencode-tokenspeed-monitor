import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveOpenCodeHome } from "../storage/migrations";
const SALT_FILE_NAME = "anon-salt.txt";
let cachedSalt = null;
function resolveSaltPath() {
    const override = process.env.TS_ANON_SALT_PATH?.trim();
    if (override)
        return override;
    return join(resolveOpenCodeHome(), "tokenspeed-monitor", SALT_FILE_NAME);
}
function readOrCreateSalt() {
    if (cachedSalt)
        return cachedSalt;
    const saltPath = resolveSaltPath();
    if (existsSync(saltPath)) {
        cachedSalt = readFileSync(saltPath, "utf8").trim();
        if (cachedSalt.length > 0)
            return cachedSalt;
    }
    cachedSalt = randomBytes(32).toString("hex");
    mkdirSync(dirname(saltPath), { recursive: true });
    writeFileSync(saltPath, `${cachedSalt}\n`, "utf8");
    return cachedSalt;
}
export function getAnonProjectID(projectID) {
    const salt = readOrCreateSalt();
    return createHmac("sha256", salt).update(projectID).digest("hex");
}
export function getAnonDeviceID() {
    const salt = readOrCreateSalt();
    const digest = createHmac("sha256", "tokenspeed-device").update(salt).digest("hex");
    return `dev_${digest.slice(0, 20)}`;
}
export function getAnonUserID() {
    const salt = readOrCreateSalt();
    const digest = createHmac("sha256", "tokenspeed-user").update(salt).digest("hex");
    return `usr_${digest.slice(0, 24)}`;
}
//# sourceMappingURL=anon.js.map