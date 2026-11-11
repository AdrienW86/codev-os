// Évaluation (pure) d'un contrôle HTTP de site.
export type CheckResult = { ok: boolean; status: number | null; ms: number | null; errorKind: string | null };
export type CheckVerdict = { state: "up" | "slow" | "down" | "blocked"; label: string };

export const SLOW_MS = 4000;

/** Normalise le site saisi sur la fiche client (« exemple.fr » → « https://exemple.fr/ »). */
export function siteUrl(website: string | null | undefined): string | null {
  const value = website?.trim();
  if (!value) return null;
  // Tout autre schéma explicite (ftp:, javascript:, file:…) est refusé, jamais « réparé ».
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value) && !/^https?:\/\//i.test(value)) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try { const url = new URL(withScheme); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; }
}

export function evaluateCheck(result: CheckResult): CheckVerdict {
  if (result.errorKind === "blocked") return { state: "blocked", label: "Adresse refusée par la politique réseau" };
  if (result.status === null || result.status >= 500) return { state: "down", label: result.status ? `Erreur ${result.status}` : result.errorKind === "timeout" ? "Pas de réponse (délai dépassé)" : "Injoignable" };
  if (result.status >= 400) return { state: "down", label: `Erreur ${result.status}` };
  if (result.ms !== null && result.ms > SLOW_MS) return { state: "slow", label: `Lent (${result.ms} ms)` };
  return { state: "up", label: `En ligne (${result.status}, ${result.ms ?? "?"} ms)` };
}

// ---------------------------------------------------------------------------------------------
// Audit technique de la page d'accueil (pur) : ce qu'un développeur senior / expert SEO technique
// contrôle en premier. Uniquement à partir de la réponse réellement reçue (en-têtes + HTML), sans
// supposition : un élément non lisible n'est jamais signalé comme absent.
// ---------------------------------------------------------------------------------------------
export type PageIssue = { code: string; severity: "critical" | "high" | "medium" | "low"; title: string; detail: string; fix: string };
export type PageAudit = { issues: PageIssue[]; score: number; checked: string[] };

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2).find((value) => value !== undefined) ?? null;
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];
const meta = (html: string, key: string, by: "name" | "property" = "name") => tags(html, "meta").find((tag) => attr(tag, by)?.toLowerCase() === key);
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

export function auditPage(input: { requestedUrl: string; finalUrl: string; status: number; headers: Record<string, string | string[] | undefined>; body: string; ms: number | null }): PageAudit {
  const issues: PageIssue[] = [];
  const header = (name: string) => { const value = input.headers[name.toLowerCase()]; return Array.isArray(value) ? value.join(", ") : value ?? null; };
  const isHtml = /text\/html|application\/xhtml/i.test(header("content-type") ?? "") || /<html[\s>]/i.test(input.body.slice(0, 2000));
  const checked = ["https", "temps de réponse"];
  let final: URL | null = null;
  try { final = new URL(input.finalUrl); } catch { final = null; }

  if (final?.protocol === "http:") issues.push({ code: "no_https", severity: "high", title: "Site servi sans HTTPS", detail: `La page finale est ${final.origin} : navigateurs « Non sécurisé », confiance et référencement pénalisés.`, fix: "Activer le certificat TLS et rediriger tout le trafic HTTP vers HTTPS (301)." });
  else if (final?.protocol === "https:" && !header("strict-transport-security")) issues.push({ code: "no_hsts", severity: "low", title: "En-tête HSTS absent", detail: "Le navigateur n’est pas forcé à rester en HTTPS.", fix: "Ajouter Strict-Transport-Security: max-age=31536000; includeSubDomains." });
  if (input.ms !== null && input.ms > 1800) issues.push({ code: "slow_ttfb", severity: input.ms > SLOW_MS ? "high" : "medium", title: "Réponse serveur lente", detail: `Page d’accueil reçue en ${input.ms} ms (objectif < 800 ms pour le premier octet).`, fix: "Mettre en cache la page (CDN / génération statique), réduire le travail serveur et vérifier l’hébergement." });

  const robotsHeader = header("x-robots-tag");
  if (robotsHeader && /noindex/i.test(robotsHeader)) issues.push({ code: "noindex_header", severity: "critical", title: "Site exclu de Google (X-Robots-Tag)", detail: `En-tête « ${robotsHeader.slice(0, 80)} » : Google retire la page de ses résultats.`, fix: "Retirer noindex de l’en-tête X-Robots-Tag en production (souvent hérité d’un environnement de préproduction)." });

  if (isHtml && input.body.length > 0) {
    checked.push("indexation", "title", "meta description", "mobile", "balises de partage", "structure");
    const html = input.body;
    const robots = meta(html, "robots");
    if (robots && /noindex/i.test(attr(robots, "content") ?? "")) issues.push({ code: "noindex_meta", severity: "critical", title: "Site exclu de Google (meta robots)", detail: "La page d’accueil contient <meta name=\"robots\" content=\"noindex\"> : elle disparaît des résultats.", fix: "Retirer noindex de la balise meta robots en production." });
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const titleText = title ? decode(title) : "";
    if (!titleText) issues.push({ code: "title_missing", severity: "high", title: "Balise title absente", detail: "Google affiche un titre arbitraire et le taux de clic chute.", fix: "Ajouter un title unique : activité principale + ville + marque, environ 50 à 60 caractères." });
    else if (titleText.length < 20 || titleText.length > 65) issues.push({ code: "title_length", severity: "low", title: "Longueur du title à revoir", detail: `« ${titleText.slice(0, 90)} » (${titleText.length} caractères).`, fix: "Viser 30 à 60 caractères, expression principale en tête." });
    const description = meta(html, "description");
    const descriptionText = description ? decode(attr(description, "content") ?? "") : "";
    if (!descriptionText) issues.push({ code: "description_missing", severity: "medium", title: "Meta description absente", detail: "Google compose seul l’extrait affiché sous le lien.", fix: "Rédiger 140 à 160 caractères : bénéfice, zone, invitation à l’action." });
    else if (descriptionText.length < 70 || descriptionText.length > 170) issues.push({ code: "description_length", severity: "low", title: "Longueur de la meta description à revoir", detail: `${descriptionText.length} caractères.`, fix: "Viser 140 à 160 caractères." });
    if (!meta(html, "viewport")) issues.push({ code: "viewport_missing", severity: "high", title: "Page non adaptée au mobile", detail: "Aucune balise meta viewport : affichage dézoomé sur téléphone, pénalisé par l’indexation mobile-first.", fix: "Ajouter <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">." });
    if (!/<html[^>]*\blang\s*=/i.test(html)) issues.push({ code: "lang_missing", severity: "low", title: "Langue de la page non déclarée", detail: "Attribut lang absent sur <html>.", fix: "Déclarer <html lang=\"fr\">." });
    const h1 = tags(html, "h1").length;
    if (h1 === 0) issues.push({ code: "h1_missing", severity: "medium", title: "Aucun titre H1", detail: "La page ne déclare pas son sujet principal.", fix: "Un seul H1 décrivant l’activité et la zone." });
    else if (h1 > 1) issues.push({ code: "h1_multiple", severity: "low", title: "Plusieurs titres H1", detail: `${h1} balises H1 sur la page d’accueil.`, fix: "Garder un seul H1 et passer les autres en H2." });
    const canonical = tags(html, "link").find((tag) => attr(tag, "rel")?.toLowerCase() === "canonical");
    const canonicalHref = canonical ? attr(canonical, "href") : null;
    if (canonicalHref && final) {
      try { const target = new URL(canonicalHref, final); if (target.host !== final.host) issues.push({ code: "canonical_foreign", severity: "high", title: "Canonical vers un autre domaine", detail: `La page désigne ${target.host} comme version officielle : Google peut ignorer ce site.`, fix: "Faire pointer la canonical vers l’URL de production de la page." }); } catch { /* canonical illisible : non signalé */ }
    }
    if (!meta(html, "og:title", "property") || !meta(html, "og:image", "property")) issues.push({ code: "open_graph_missing", severity: "low", title: "Aperçu de partage incomplet", detail: "Balises Open Graph og:title / og:image absentes : liens partagés sans image ni titre maîtrisés.", fix: "Ajouter og:title, og:description et og:image (1200×630)." });
    if (final?.protocol === "https:" && /<(?:script|img|iframe|link)\b[^>]*\b(?:src|href)\s*=\s*["']http:\/\//i.test(html)) issues.push({ code: "mixed_content", severity: "medium", title: "Contenu mixte HTTP", detail: "Des ressources sont chargées en http:// sur une page HTTPS : bloquées ou signalées par les navigateurs.", fix: "Charger toutes les ressources en https://." });
    if (!/application\/ld\+json/i.test(html)) issues.push({ code: "structured_data_missing", severity: "low", title: "Aucune donnée structurée", detail: "Pas de JSON-LD (LocalBusiness / Organization) : moins d’éléments enrichis dans Google.", fix: "Ajouter un JSON-LD LocalBusiness avec nom, adresse, téléphone et horaires réels." });
  }
  const weight = { critical: 40, high: 15, medium: 7, low: 2 };
  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + weight[issue.severity], 0));
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return { issues: issues.sort((a, b) => rank[a.severity] - rank[b.severity]), score, checked };
}
