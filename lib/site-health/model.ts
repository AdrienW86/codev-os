// Santé technique des sites (architecture des agents, lot 5), portée par l'Agent Monitoring. Règles PURES, sans import :
// certificat TLS, nom de domaine (expiration RDAP), DNS, robots.txt, sitemap, pages du sitemap, Core Web Vitals réels
// (Chrome, relevés par l'audit Lighthouse) et indexation Google (Search Console). Un contrôle qui n'a pas pu tourner
// est dit « non vérifié », jamais « conforme ».

export type HealthSeverity = "critical" | "high" | "medium" | "low";
export type HealthFinding = { code: string; severity: HealthSeverity; title: string; detail: string; fix: string };
export type HealthCheck = { key: string; label: string; state: "ok" | "issue" | "unverified"; detail: string };

export const HEALTH_INTERVAL_DAYS = 7;
export const HEALTH_RETRY_HOURS = 24;
export const MAX_SITEMAP_URLS = 200;
export const CRAWL_SAMPLE = 20;
export const INSPECT_SAMPLE = 5;
const DAY = 86_400_000;

/** Site dû : jamais contrôlé, contrôlé il y a plus de 7 jours, ou échec il y a plus de 24 h. */
export function healthDue(site: { lastCheckAt: string | null; lastFailureAt: string | null }, now: Date) {
  const last = site.lastCheckAt ? Date.parse(site.lastCheckAt) : NaN;
  const failure = site.lastFailureAt ? Date.parse(site.lastFailureAt) : NaN;
  if (Number.isFinite(failure) && now.getTime() - failure < HEALTH_RETRY_HOURS * 3_600_000 && (!Number.isFinite(last) || failure > last)) return false;
  return !Number.isFinite(last) || now.getTime() - last >= HEALTH_INTERVAL_DAYS * DAY;
}

export const daysUntil = (iso: string | null | undefined, now: Date) => {
  const at = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? Math.floor((at - now.getTime()) / DAY) : null;
};

/** Domaine à interroger au registre : l'hôte sans « www. » (les sous-domaines profonds restent « non vérifiés » si le registre ne répond pas). */
export function registrableDomain(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9.-]{3,253}$/.test(h) || !h.includes(".")) return null;
  const labels = h.split(".");
  const twoLevel = /^(co|com|org|net|gouv|asso|ac|gov)\.[a-z]{2}$/.test(labels.slice(-2).join("."));
  return labels.slice(twoLevel ? -3 : -2).join(".");
}

/** Date d'expiration dans une réponse RDAP (événement « expiration »). */
export function rdapExpiration(body: unknown): string | null {
  const events = body && typeof body === "object" ? (body as { events?: unknown }).events : null;
  if (!Array.isArray(events)) return null;
  const event = events.find((item) => item && typeof item === "object" && (item as { eventAction?: unknown }).eventAction === "expiration") as { eventDate?: unknown } | undefined;
  return typeof event?.eventDate === "string" && Number.isFinite(Date.parse(event.eventDate)) ? event.eventDate : null;
}

/** robots.txt : blocage total pour tous les robots, et sitemaps déclarés. */
export function readRobots(text: string): { blocksAll: boolean; sitemaps: string[] } {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/#.*/, "").trim()).filter(Boolean);
  const sitemaps: string[] = [];
  let agents: string[] = [], inRules = false, blocksAll = false;
  const groups: { agents: string[]; disallowAll: boolean; allowRoot: boolean }[] = [];
  let current: { agents: string[]; disallowAll: boolean; allowRoot: boolean } | null = null;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase(), value = rest.join(":").trim();
    if (key === "sitemap") { if (/^https?:\/\//i.test(value)) sitemaps.push(value); continue; }
    if (key === "user-agent") {
      if (inRules || !current) { current = { agents: [], disallowAll: false, allowRoot: false }; groups.push(current); inRules = false; }
      current.agents.push(value.toLowerCase()); agents = current.agents; continue;
    }
    if (!current) continue;
    inRules = true;
    if (key === "disallow" && value === "/") current.disallowAll = true;
    if (key === "allow" && (value === "/" || value === "/$")) current.allowRoot = true;
  }
  void agents;
  const star = groups.filter((group) => group.agents.includes("*"));
  const google = groups.filter((group) => group.agents.some((agent) => agent === "googlebot"));
  const applicable = google.length ? google : star;
  blocksAll = applicable.some((group) => group.disallowAll && !group.allowRoot);
  return { blocksAll, sitemaps: [...new Set(sitemaps)].slice(0, 5) };
}

/** Adresses d'un sitemap (ou d'un index de sitemaps). */
export function readSitemap(xml: string): { index: boolean; urls: string[] } {
  const index = /<sitemapindex[\s>]/i.test(xml);
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => match[1].replace(/&amp;/g, "&")).filter((url) => /^https?:\/\//i.test(url));
  return { index, urls: [...new Set(urls)].slice(0, MAX_SITEMAP_URLS) };
}

/** Échantillon régulier des pages du sitemap (la page d'accueil n'en fait pas partie : elle est contrôlée à part). */
export function crawlSample(urls: readonly string[], size = CRAWL_SAMPLE): string[] {
  if (urls.length <= size) return [...urls];
  const step = urls.length / size;
  return Array.from({ length: size }, (_, i) => urls[Math.floor(i * step)]);
}

export type CrawlResult = { url: string; status: number | null; finalUrl?: string | null };
export type CertificateResult = { validTo: string | null; issuer: string | null; hostnameMatch: boolean | null } | null;
export type DnsResult = { apex: boolean | null; www: boolean | null; mx: boolean | null } | null;
export type InspectionResult = { url: string; verdict: string | null; coverage: string | null; robots: string | null; indexing: string | null };
export type FieldVitals = { lcpMs?: number; inpMs?: number; cls?: number; scope?: string } | null;

export type HealthInput = {
  host: string; homeUrl: string; now: Date;
  certificate: CertificateResult;
  domainExpiry: string | null | undefined; // undefined = non vérifié
  dns: DnsResult;
  robots: { status: number | null; text: string | null } | null;
  sitemap: { url: string | null; urls: string[] } | null;
  crawl: CrawlResult[];
  vitals: FieldVitals;
  inspections: InspectionResult[] | null; // null = Search Console non reliée
};

const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const pathOf = (url: string) => { try { const u = new URL(url); return u.pathname + u.search || "/"; } catch { return url.slice(0, 80); } };

/** Évaluation complète : constats (pour les incidents) et état de chaque contrôle (pour l'affichage). */
export function evaluateHealth(input: HealthInput): { findings: HealthFinding[]; checks: HealthCheck[]; score: number } {
  const findings: HealthFinding[] = [];
  const checks: HealthCheck[] = [];
  const add = (key: string, label: string, state: HealthCheck["state"], detail: string) => checks.push({ key, label, state, detail });

  // Certificat TLS.
  const cert = input.certificate;
  const certDays = cert ? daysUntil(cert.validTo, input.now) : null;
  if (!cert || certDays === null) add("tls", "Certificat HTTPS", "unverified", "Certificat non lu (port 443 injoignable ou réponse illisible).");
  else {
    if (certDays < 0) findings.push({ code: "ssl_expired", severity: "critical", title: "Certificat HTTPS expiré", detail: `Expiré depuis ${-certDays} jour(s) : les navigateurs bloquent le site.`, fix: "Renouveler le certificat chez l’hébergeur (renouvellement automatique Let’s Encrypt à vérifier)." });
    else if (certDays < 14) findings.push({ code: "ssl_expiring", severity: "high", title: "Certificat HTTPS bientôt expiré", detail: `Expire dans ${certDays} jour(s).`, fix: "Vérifier le renouvellement automatique du certificat chez l’hébergeur." });
    if (cert.hostnameMatch === false) findings.push({ code: "ssl_hostname", severity: "critical", title: "Certificat HTTPS d’un autre domaine", detail: `Le certificat présenté ne couvre pas ${input.host}.`, fix: "Ajouter le domaine au certificat (ou au projet chez l’hébergeur)." });
    add("tls", "Certificat HTTPS", certDays < 14 || cert.hostnameMatch === false ? "issue" : "ok", `${certDays < 0 ? "Expiré" : `Valide encore ${certDays} jours`}${cert.issuer ? ` (${cert.issuer})` : ""}.`);
  }

  // Nom de domaine.
  const domainDays = input.domainExpiry === undefined ? null : daysUntil(input.domainExpiry, input.now);
  if (input.domainExpiry === undefined || input.domainExpiry === null || domainDays === null) add("domain", "Nom de domaine", "unverified", "Date d’expiration non communiquée par le registre.");
  else {
    if (domainDays < 0) findings.push({ code: "domain_expired", severity: "critical", title: "Nom de domaine expiré", detail: `Expiré depuis ${-domainDays} jour(s) selon le registre.`, fix: "Renouveler le domaine immédiatement chez le registraire." });
    else if (domainDays < 30) findings.push({ code: "domain_expiring", severity: "high", title: "Nom de domaine bientôt expiré", detail: `Expire dans ${domainDays} jour(s) selon le registre.`, fix: "Renouveler le domaine et activer le renouvellement automatique." });
    add("domain", "Nom de domaine", domainDays < 30 ? "issue" : "ok", domainDays < 0 ? "Expiré." : `Expire dans ${domainDays} jours.`);
  }

  // DNS.
  const dns = input.dns;
  if (!dns || dns.apex === null) add("dns", "DNS", "unverified", "Résolution DNS non vérifiée.");
  else {
    if (!dns.apex) findings.push({ code: "dns_unresolved", severity: "critical", title: "Le domaine ne pointe vers aucun serveur", detail: `${input.host} ne se résout pas (aucune adresse A / AAAA).`, fix: "Vérifier les enregistrements DNS chez le registraire ou l’hébergeur." });
    const isWww = input.host.startsWith("www.");
    if (dns.www === false && !isWww) findings.push({ code: "dns_www_missing", severity: "medium", title: "La version www du site ne répond pas", detail: `www.${input.host} ne se résout pas : les visiteurs qui tapent « www » tombent sur une erreur.`, fix: "Ajouter un enregistrement CNAME www et une redirection 301 vers le domaine principal." });
    add("dns", "DNS", !dns.apex || (dns.www === false && !isWww) ? "issue" : "ok", `${dns.apex ? "Domaine résolu" : "Domaine non résolu"}${dns.www === null || isWww ? "" : dns.www ? ", www résolu" : ", www absent"}${dns.mx === null ? "" : dns.mx ? ", messagerie (MX) configurée" : ", aucune messagerie (MX)"}.`);
  }

  // robots.txt.
  const robots = input.robots;
  const parsedRobots = robots?.status === 200 && robots.text ? readRobots(robots.text) : null;
  if (!robots || robots.status === null) add("robots", "robots.txt", "unverified", "robots.txt non lu.");
  else if (robots.status === 404) add("robots", "robots.txt", "ok", "Absent (tout est autorisé aux robots).");
  else if (parsedRobots?.blocksAll) {
    findings.push({ code: "robots_block_all", severity: "critical", title: "robots.txt interdit tout le site à Google", detail: "« Disallow: / » pour tous les robots : Google n’explore plus aucune page.", fix: "Retirer « Disallow: / » du robots.txt de production (souvent hérité de la préproduction)." });
    add("robots", "robots.txt", "issue", "Bloque tout le site.");
  } else add("robots", "robots.txt", robots.status === 200 ? "ok" : "unverified", robots.status === 200 ? `Lu${parsedRobots?.sitemaps.length ? `, ${plural(parsedRobots.sitemaps.length, "sitemap déclaré", "sitemaps déclarés")}` : ", aucun sitemap déclaré"}.` : `Réponse ${robots.status}.`);

  // Sitemap.
  const sitemap = input.sitemap;
  if (!sitemap) add("sitemap", "Sitemap", "unverified", "Sitemap non vérifié.");
  else if (!sitemap.url || !sitemap.urls.length) {
    findings.push({ code: "sitemap_missing", severity: "medium", title: "Aucun sitemap lisible", detail: "Ni /sitemap.xml ni un sitemap déclaré dans robots.txt n’a été trouvé : Google découvre les pages plus lentement.", fix: "Publier un sitemap.xml listant les pages utiles et le déclarer dans robots.txt et Search Console." });
    add("sitemap", "Sitemap", "issue", "Introuvable ou vide.");
  } else add("sitemap", "Sitemap", "ok", `${plural(sitemap.urls.length, "page listée", "pages listées")}${sitemap.urls.length >= MAX_SITEMAP_URLS ? " (lecture limitée)" : ""}.`);

  // Pages du sitemap.
  const crawled = input.crawl.filter((row) => row.status !== null);
  if (!input.crawl.length) add("crawl", "Pages du sitemap", "unverified", "Aucune page à explorer.");
  else {
    const broken = crawled.filter((row) => (row.status ?? 0) >= 400);
    const redirected = crawled.filter((row) => row.finalUrl && row.finalUrl.replace(/\/$/, "") !== row.url.replace(/\/$/, ""));
    if (broken.length) findings.push({ code: "broken_pages", severity: "high", title: "Pages du sitemap en erreur", detail: `${plural(broken.length, "page en erreur", "pages en erreur")} sur ${crawled.length} explorées : ${broken.slice(0, 4).map((row) => `${pathOf(row.url)} (${row.status})`).join(", ")}${broken.length > 4 ? "…" : ""}.`, fix: "Corriger ou rediriger (301) ces pages, puis les retirer du sitemap si elles n’existent plus." });
    if (redirected.length >= 3) findings.push({ code: "sitemap_redirects", severity: "low", title: "Le sitemap liste des adresses redirigées", detail: `${plural(redirected.length, "page redirigée", "pages redirigées")} sur ${crawled.length} : Google préfère les adresses finales.`, fix: "Mettre à jour le sitemap avec les adresses finales." });
    add("crawl", "Pages du sitemap", broken.length ? "issue" : "ok", `${crawled.length} explorée(s) sur ${input.crawl.length}, ${broken.length} en erreur${redirected.length ? `, ${redirected.length} redirigée(s)` : ""}.`);
  }

  // Core Web Vitals réels (Chrome, relevés par l'audit Lighthouse mobile).
  const vitals = input.vitals;
  if (!vitals || vitals.scope === "unavailable" || (!num(vitals.lcpMs) && !num(vitals.inpMs) && !num(vitals.cls))) add("vitals", "Core Web Vitals réels", "unverified", "Pas assez de visites Chrome pour des mesures réelles (ou pas encore d’audit).");
  else {
    const poor = [num(vitals.lcpMs) && vitals.lcpMs > 4000 ? `LCP ${(vitals.lcpMs / 1000).toFixed(1)} s` : null, num(vitals.inpMs) && vitals.inpMs > 500 ? `INP ${Math.round(vitals.inpMs)} ms` : null, num(vitals.cls) && vitals.cls > 0.25 ? `CLS ${vitals.cls.toFixed(2)}` : null].filter(Boolean);
    const weak = [num(vitals.lcpMs) && vitals.lcpMs > 2500 && vitals.lcpMs <= 4000 ? `LCP ${(vitals.lcpMs / 1000).toFixed(1)} s` : null, num(vitals.inpMs) && vitals.inpMs > 200 && vitals.inpMs <= 500 ? `INP ${Math.round(vitals.inpMs)} ms` : null, num(vitals.cls) && vitals.cls > 0.1 && vitals.cls <= 0.25 ? `CLS ${vitals.cls.toFixed(2)}` : null].filter(Boolean);
    if (poor.length) findings.push({ code: "vitals_poor", severity: "high", title: "Expérience réelle des visiteurs mauvaise (Core Web Vitals)", detail: `Mesures Chrome des vrais visiteurs : ${poor.join(", ")} (seuils Google : LCP 2,5 s, INP 200 ms, CLS 0,1).`, fix: "Alléger la page d’accueil (images, scripts tiers), voir les pistes de l’audit Performance." });
    else if (weak.length) findings.push({ code: "vitals_weak", severity: "medium", title: "Expérience réelle des visiteurs à améliorer (Core Web Vitals)", detail: `Mesures Chrome des vrais visiteurs : ${weak.join(", ")} (seuils Google : LCP 2,5 s, INP 200 ms, CLS 0,1).`, fix: "Optimiser les images et le chargement des scripts, voir l’audit Performance." });
    add("vitals", "Core Web Vitals réels", poor.length || weak.length ? "issue" : "ok", [num(vitals.lcpMs) ? `LCP ${(vitals.lcpMs / 1000).toFixed(1)} s` : null, num(vitals.inpMs) ? `INP ${Math.round(vitals.inpMs)} ms` : null, num(vitals.cls) ? `CLS ${vitals.cls.toFixed(2)}` : null].filter(Boolean).join(", ") + ".");
  }

  // Indexation Google (Search Console, inspection d'URL).
  if (input.inspections === null) add("index", "Indexation Google", "unverified", "Search Console non reliée à ce client.");
  else if (!input.inspections.length) add("index", "Indexation Google", "unverified", "Inspection Search Console impossible cette fois.");
  else {
    const home = input.inspections.find((row) => row.url === input.homeUrl) ?? input.inspections[0];
    const notIndexed = input.inspections.filter((row) => row.verdict && row.verdict !== "PASS");
    if (home.verdict && home.verdict !== "PASS") findings.push({ code: "home_not_indexed", severity: "critical", title: "Page d’accueil absente de Google", detail: `Search Console : « ${home.coverage ?? home.verdict} »${home.robots && home.robots !== "ALLOWED" ? `, robots ${home.robots}` : ""}${home.indexing && home.indexing !== "INDEXING_ALLOWED" ? `, ${home.indexing}` : ""}.`, fix: "Corriger la cause indiquée puis demander l’indexation dans Search Console." });
    const others = notIndexed.filter((row) => row !== home);
    if (others.length) findings.push({ code: "pages_not_indexed", severity: "medium", title: "Pages importantes non indexées", detail: `${plural(others.length, "page non indexée", "pages non indexées")} sur ${input.inspections.length - 1} vérifiées : ${others.slice(0, 3).map((row) => `${pathOf(row.url)} (${row.coverage ?? row.verdict})`).join(", ")}.`, fix: "Vérifier le contenu (unique, utile), les liens internes vers ces pages et demander l’indexation." });
    add("index", "Indexation Google", notIndexed.length ? "issue" : "ok", `${input.inspections.length - notIndexed.length} indexée(s) sur ${input.inspections.length} vérifiée(s).`);
  }

  const weights: Record<HealthSeverity, number> = { critical: 30, high: 15, medium: 7, low: 2 };
  const score = Math.max(0, 100 - findings.reduce((sum, finding) => sum + weights[finding.severity], 0));
  return { findings, checks, score };
}

/** Codes possibles (pour résoudre les incidents disparus). */
export const HEALTH_CODES = ["ssl_expired", "ssl_expiring", "ssl_hostname", "domain_expired", "domain_expiring", "dns_unresolved", "dns_www_missing", "robots_block_all", "sitemap_missing", "broken_pages", "sitemap_redirects", "vitals_poor", "vitals_weak", "home_not_indexed", "pages_not_indexed"] as const;
export const healthFingerprint = (clientId: string, code: string) => `site-health:${clientId}:${code}`;
/** Un incident n'est ouvert que pour ce qui compte (critique, élevé, moyen) ; le reste reste visible dans le contrôle. */
export const opensIncident = (finding: HealthFinding) => finding.severity !== "low";

/** Lecture d'une inspection d'URL Search Console (urlInspection/index:inspect). */
export function readInspection(url: string, body: unknown): InspectionResult | null {
  const result = body && typeof body === "object" ? (body as { inspectionResult?: { indexStatusResult?: Record<string, unknown> } }).inspectionResult?.indexStatusResult : null;
  if (!result || typeof result !== "object") return null;
  const str = (value: unknown) => (typeof value === "string" ? value.slice(0, 120) : null);
  return { url, verdict: str(result.verdict), coverage: str(result.coverageState), robots: str(result.robotsTxtState), indexing: str(result.indexingState) };
}
