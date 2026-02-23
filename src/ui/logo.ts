import { readFileSync } from "node:fs";
import { join } from "node:path";

let cachedLogo: ArrayBuffer | null | undefined;

export function getTokenSpeedLogoWebp(): ArrayBuffer | null {
  if (cachedLogo !== undefined) return cachedLogo;

  const candidates = [
    join(import.meta.dir, "../../tokenspeed-logo.webp"),
    join(process.cwd(), "tokenspeed-logo.webp"),
  ];

  for (const candidate of candidates) {
    try {
      const data = readFileSync(candidate);
      cachedLogo = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return cachedLogo;
    } catch {
      // try next path
    }
  }

  cachedLogo = null;
  return null;
}
