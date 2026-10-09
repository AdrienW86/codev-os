// Garde des routes JSON appelées par le navigateur de l'administrateur :
// même origine stricte (anti-CSRF), type de contenu, taille bornée, limitation de débit.
export type GuardFailure = { ok: false; status: number; error: string };

/**
 * Refuse toute requête dont l'origine n'est pas exactement le site lui-même (CSRF, appels inter-sites).
 * Hôtes acceptés : celui de l'URL vue par Next et celui de la requête (Host / X-Forwarded-Host posés
 * par l'hébergeur) — un navigateur ne peut pas falsifier l'en-tête Origin.
 */
export function checkSameOrigin(headers: Headers, requestUrl: string): { ok: true } | GuardFailure {
  const origin = headers.get("origin");
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return { ok: false, status: 403, error: "cross_site" };
  if (!origin) return { ok: false, status: 403, error: "bad_origin" };
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return { ok: false, status: 403, error: "bad_origin" }; }
  if (!["http:", "https:"].includes(parsed.protocol) || origin !== parsed.origin) return { ok: false, status: 403, error: "bad_origin" };
  const allowed = new Set([new URL(requestUrl).host, headers.get("x-forwarded-host")?.split(",")[0]?.trim(), headers.get("host")].filter((value): value is string => Boolean(value)));
  return allowed.has(parsed.host) ? { ok: true } : { ok: false, status: 403, error: "bad_origin" };
}

/** Corps JSON borné : taille annoncée ET réelle vérifiées, type de contenu obligatoire. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | GuardFailure> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return { ok: false, status: 415, error: "unsupported_media_type" };
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, status: 413, error: "payload_too_large" };
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413, error: "payload_too_large" };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, status: 400, error: "malformed_json" }; }
}

/** Fenêtre glissante en mémoire (par instance) : protège des boucles et des doubles soumissions. */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) for (const [entry, times] of hits) if (!times.some((time) => now - time < windowMs)) hits.delete(entry);
    return true;
  };
}
