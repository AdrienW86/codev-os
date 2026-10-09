// Politique réseau des agents : aucune URL arbitraire.
// Seules les URL http(s) publiques, sur les ports 80/443, sans identifiants, sont autorisées ;
// les adresses privées, locales, de lien local, réservées ou de métadonnées cloud sont refusées.
import { isIP } from "node:net";

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

export function checkPublicUrl(raw: string, options: { allowHttp?: boolean } = {}): UrlCheck {
  if (typeof raw !== "string" || raw.length > 2048) return { ok: false, reason: "URL invalide." };
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return { ok: false, reason: "URL invalide." }; }
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) return { ok: false, reason: "Protocole refusé." };
  if (url.username || url.password) return { ok: false, reason: "Identifiants dans l’URL refusés." };
  if (url.port && !["80", "443"].includes(url.port)) return { ok: false, reason: "Port refusé." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.test(host)) return { ok: false, reason: "Hôte local refusé." };
  if (isIP(host) && isPrivateAddress(host)) return { ok: false, reason: "Adresse privée refusée." };
  if (!isIP(host) && !host.includes(".")) return { ok: false, reason: "Hôte non qualifié refusé." };
  return { ok: true, url };
}

/** Adresses non publiques (IPv4 et IPv6, y compris IPv4 encapsulée). */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (version === 6) {
    const value = address.toLowerCase();
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9")
      || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("ff") || value.startsWith("64:ff9b") || value.startsWith("2001:db8");
  }
  return true;
}
