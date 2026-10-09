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
    const groups = expandIpv6(address.toLowerCase());
    if (!groups) return true;
    const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
    const embedded = `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
    // IPv4 encapsulée (::ffff:a.b.c.d, y compris sous forme hexadécimale ::ffff:7f00:1) ou compatible (::a.b.c.d).
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || (g5 === 0 && (g6 || g7)))) return isPrivateAddress(embedded);
    if (groups.every((group) => group === 0) || (groups.slice(0, 7).every((group) => group === 0) && g7 === 1)) return true; // :: et ::1
    if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00) return true; // ULA, lien local, multicast
    if (g0 === 0x64 && g1 === 0xff9b) return true; // NAT64
    if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
    if (g0 === 0x2002) return isPrivateAddress(`${g1 >> 8}.${g1 & 255}.${g2 >> 8}.${g2 & 255}`); // 6to4
    return false;
  }
  return true;
}

/** Développe une adresse IPv6 en 8 groupes de 16 bits ; `null` si invalide. */
function expandIpv6(address: string): number[] | null {
  let value = address.split("%")[0];
  const dotted = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const parts = dotted[1].split(".").map(Number);
    if (parts.some((part) => part > 255)) return null;
    value = value.slice(0, -dotted[1].length) + `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const [head, tail] = value.split("::");
  if (value.split("::").length > 2) return null;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 1) return null;
  const all = [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right];
  const groups = all.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  return groups.some(Number.isNaN) ? null : groups;
}
