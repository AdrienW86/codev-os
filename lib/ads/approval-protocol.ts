import { createHash } from "node:crypto";
import type { AdsChange } from "./write-foundation";

/** Hash the exact validated action; changing any value invalidates the approval. */
export function adsChangeFingerprint(change: AdsChange) {
  const keys = Object.keys(change).sort();
  const canonical: Record<string, unknown> = {};
  for (const key of keys) {
    const value = change[key as keyof AdsChange];
    canonical[key] = key === "keywords" && Array.isArray(value)
      ? value.map(item => ({ text: item.text.trim().replace(/\\s+/g, " "), matchType: item.matchType }))
      : value;
  }
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
