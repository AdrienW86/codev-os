/**
 * OpenStreetMap via l'API Overpass (données ouvertes, licence ODbL : attribution
 * « © les contributeurs d'OpenStreetMap » obligatoire). Sert à compléter les fiches
 * Sirene : site web, téléphone, e-mail générique. Rapprochement par SIRET (tag
 * ref:FR:SIRET), sinon par nom normalisé + code postal.
 */
import { normalizeText } from "./prescribers";
import { genericBusinessEmail } from "./website";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
export const OSM_ATTRIBUTION = "© les contributeurs d'OpenStreetMap (ODbL)";

export type OsmBusiness = {
  ref: string; name: string; siret: string | null; postcode: string | null; city: string | null;
  website: string | null; phone: string | null; email: string | null;
};

/** Lieux nommés à vocation économique, avec au moins un moyen de contact ou un SIRET. */
export function buildOverpassQuery(input: { lat: number; lon: number; radiusKm: number }): string {
  const r = Math.round(Math.min(Math.max(input.radiusKm, 1), 50) * 1000);
  const around = `(around:${r},${input.lat},${input.lon})`;
  const keys = ["shop", "office", "craft", "amenity", "tourism", "healthcare", "industrial"];
  const contact = ["website", "contact:website", "phone", "contact:phone", "email", "contact:email", "ref:FR:SIRET"];
  const lines = keys.flatMap((k) => contact.map((c) => `  nwr${around}["name"]["${k}"]["${c}"];`));
  return `[out:json][timeout:120];\n(\n${lines.join("\n")}\n);\nout tags center;`;
}

const tag = (tags: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { const v = tags[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
  return null;
};

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") && !u.username ? u.toString() : null;
  } catch { return null; }
}

export function parseOverpass(payload: unknown): OsmBusiness[] {
  const elements = Array.isArray((payload as { elements?: unknown })?.elements) ? (payload as { elements: Record<string, unknown>[] }).elements : [];
  const seen = new Set<string>();
  const out: OsmBusiness[] = [];
  for (const el of elements) {
    const tags = (el.tags ?? {}) as Record<string, unknown>;
    const name = tag(tags, "name");
    const ref = `${String(el.type ?? "")}/${String(el.id ?? "")}`;
    if (!name || seen.has(ref)) continue;
    seen.add(ref);
    const siret = tag(tags, "ref:FR:SIRET")?.replace(/\s/g, "") ?? null;
    const website = safeUrl(tag(tags, "website", "contact:website", "url"));
    const email = tag(tags, "email", "contact:email");
    out.push({
      ref, name, siret: siret && /^\d{14}$/.test(siret) ? siret : null,
      postcode: tag(tags, "addr:postcode"), city: tag(tags, "addr:city"),
      website, phone: tag(tags, "phone", "contact:phone")?.slice(0, 40) ?? null,
      email: email ? genericBusinessEmail(email, website) : null,
    });
  }
  return out;
}

export type MatchTarget = { id: string; siren: string | null; siret: string | null; name: string; postalCode: string | null };

/** Nom réduit à ses mots significatifs (sans formes juridiques). */
export function nameKey(name: string): string {
  const legal = new Set(["sarl", "sas", "sasu", "eurl", "sa", "sci", "snc", "selarl", "selas", "scp", "ei", "eirl", "et", "de", "du", "des", "la", "le", "les", "l", "d"]);
  return normalizeText(name).split(" ").filter((w) => w.length > 1 && !legal.has(w)).join(" ");
}

/** Associe chaque lieu OSM à au plus une fiche : SIRET exact d'abord, sinon nom + code postal identiques. */
export function matchOsm(targets: MatchTarget[], places: OsmBusiness[]): Map<string, OsmBusiness> {
  const bySiret = new Map<string, MatchTarget>();
  const bySiren = new Map<string, MatchTarget>();
  const byNamePostcode = new Map<string, MatchTarget | null>();
  for (const t of targets) {
    if (t.siret) bySiret.set(t.siret, t);
    if (t.siren) bySiren.set(t.siren, t);
    if (t.postalCode) {
      const key = `${nameKey(t.name)}|${t.postalCode}`;
      // Deux fiches au même nom dans le même code postal : ambigu, pas de rapprochement.
      byNamePostcode.set(key, byNamePostcode.has(key) ? null : t);
    }
  }
  const result = new Map<string, OsmBusiness>();
  for (const p of places) {
    const target = (p.siret && (bySiret.get(p.siret) ?? bySiren.get(p.siret.slice(0, 9))))
      || (p.postcode ? byNamePostcode.get(`${nameKey(p.name)}|${p.postcode}`) : null);
    if (target && !result.has(target.id)) result.set(target.id, p);
  }
  return result;
}
