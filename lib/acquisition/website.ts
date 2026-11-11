/**
 * Lecture respectueuse du site d'une entreprise : page d'accueil et mentions légales
 * uniquement, robots.txt respecté, quelques requêtes par site, taille et durée bornées.
 * Objectif : confirmer le SIREN et trouver une adresse e-mail GÉNÉRIQUE (contact@, info@…)
 * sur le domaine de l'entreprise. Aucune adresse nominative n'est conservée.
 */

export const BOT_USER_AGENT = "CodevOS-Prospection/1.0 (lecture des mentions légales ; respecte robots.txt)";
const MAX_BYTES = 600_000;

/** Parties locales génériques acceptées : jamais prénom.nom. */
const GENERIC_LOCAL = /^(contact|info|infos|information|hello|bonjour|accueil|agence|cabinet|office|secretariat|admin|administration|commercial|commerciale|ventes?|sales|devis|reservation|reservations|booking|direction|service-?client|clients?|support|atelier|boutique|magasin|etude|courrier|mail|team|equipe|rh|recrutement|compta|comptabilite)([.\-_]?[a-z0-9]{0,12})?$/;

function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  return parts.slice(-2).join(".");
}

/**
 * Retourne l'adresse si elle est générique ; si un site est connu, elle doit être sur le même
 * domaine (évite les adresses du webmaster ou d'un prestataire).
 */
export function genericBusinessEmail(raw: string, website: string | null): string | null {
  const email = raw.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
  const m = /^([a-z0-9._%+-]{1,64})@([a-z0-9.-]+\.[a-z]{2,})$/.exec(email);
  if (!m || !GENERIC_LOCAL.test(m[1])) return null;
  if (website) {
    try { if (registrableDomain(new URL(website).hostname) !== registrableDomain(m[2])) return null; } catch { return null; }
  }
  return email;
}

/** robots.txt : règles « Disallow » du groupe User-agent: * (ou de notre agent). */
export function robotsAllows(robotsTxt: string | null, path: string): boolean {
  if (!robotsTxt) return true;
  let applies = false; let groupHasRules = false;
  const disallow: string[] = []; const allow: string[] = [];
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const [k, ...rest] = line.split(":");
    const key = k?.trim().toLowerCase(); const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (groupHasRules) { applies = false; groupHasRules = false; }
      if (value === "*" || value.toLowerCase().startsWith("codevos")) applies = true;
    } else if (key === "disallow" || key === "allow") {
      groupHasRules = true;
      if (applies && value) (key === "disallow" ? disallow : allow).push(value);
    }
  }
  const longest = (rules: string[]) => Math.max(-1, ...rules.filter((r) => path.startsWith(r.replace(/\*.*$/, ""))).map((r) => r.length));
  return longest(allow) >= longest(disallow);
}

export function extractEmails(html: string, website: string | null): string[] {
  const found = new Set<string>();
  const decoded = html.replace(/&#64;|&commat;|\[at\]|\(at\)/gi, "@").replace(/&#46;|\[dot\]|\(dot\)/gi, ".");
  for (const m of decoded.matchAll(/(?:mailto:)?([a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const email = genericBusinessEmail(m[1], website);
    if (email) found.add(email);
  }
  return [...found];
}

/** SIREN (9 chiffres) cités près de SIREN/SIRET/RCS, espaces tolérés. */
export function extractSirens(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;| /g, " ");
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:SIREN|SIRET|RCS)[^0-9]{0,40}((?:\d\s?){9,14})/gi)) {
    const digits = m[1].replace(/\s/g, "");
    if (digits.length >= 9) out.add(digits.slice(0, 9));
  }
  return [...out];
}

/** Lien vers les mentions légales trouvé dans la page d'accueil (même site). */
export function legalPageUrl(html: string, base: string): string | null {
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const label = `${m[1]} ${m[2]}`.toLowerCase();
    if (!/mentions?[-\s_]?l[ée]gales?|legal|impressum/.test(label)) continue;
    try {
      const url = new URL(m[1], base);
      if (url.hostname === new URL(base).hostname && (url.protocol === "https:" || url.protocol === "http:")) return url.toString();
    } catch { /* lien invalide */ }
  }
  return null;
}

export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export type WebsiteCheck = {
  status: "ok" | "robots_disallowed" | "unreachable" | "blocked_address" | "invalid";
  email: string | null; emailSourceUrl: string | null; sirens: string[]; pagesRead: number;
};

export type SafeFetch = (url: string) => Promise<{ ok: boolean; status: number; text: string; finalUrl: string } | null>;

/** Lit l'accueil et, si autorisé, la page de mentions légales. Au plus 3 requêtes par site. */
export async function checkWebsite(website: string, fetchPage: SafeFetch): Promise<WebsiteCheck> {
  let base: URL;
  try { base = new URL(website); } catch { return { status: "invalid", email: null, emailSourceUrl: null, sirens: [], pagesRead: 0 }; }
  if (base.protocol !== "https:" && base.protocol !== "http:") return { status: "invalid", email: null, emailSourceUrl: null, sirens: [], pagesRead: 0 };
  const robots = await fetchPage(new URL("/robots.txt", base).toString()).catch(() => null);
  const robotsTxt = robots?.ok ? robots.text.slice(0, 50_000) : null;
  if (!robotsAllows(robotsTxt, base.pathname || "/")) return { status: "robots_disallowed", email: null, emailSourceUrl: null, sirens: [], pagesRead: 0 };
  const home = await fetchPage(base.toString()).catch(() => null);
  if (!home?.ok) return { status: "unreachable", email: null, emailSourceUrl: null, sirens: [], pagesRead: 0 };
  let email = extractEmails(home.text, website)[0] ?? null; let emailSourceUrl = email ? home.finalUrl : null;
  const sirens = new Set(extractSirens(home.text)); let pagesRead = 1;
  const legal = legalPageUrl(home.text, home.finalUrl);
  if (legal && robotsAllows(robotsTxt, new URL(legal).pathname)) {
    const page = await fetchPage(legal).catch(() => null);
    if (page?.ok) {
      pagesRead += 1;
      for (const s of extractSirens(page.text)) sirens.add(s);
      if (!email) { email = extractEmails(page.text, website)[0] ?? null; emailSourceUrl = email ? page.finalUrl : null; }
    }
  }
  return { status: "ok", email, emailSourceUrl, sirens: [...sirens], pagesRead };
}

export const WEBSITE_MAX_BYTES = MAX_BYTES;
