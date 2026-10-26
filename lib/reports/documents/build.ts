// Construction des documents d'un rapport complet (pur, déterministe, sans IA ni réseau) : un document par agent.
// Règles : aucune valeur inventée (absente = « — » ou document omis), comparaison avec la période précédente de même
// durée seulement si elle est connue, vocabulaire lisible par un client (pas d'identifiant technique).
import type { CampaignRow, LocalServicesLeads } from "@/lib/integrations/google-ads/dashboard";
import type { AdsMetrics } from "@/lib/integrations/google-ads/types";
import type { ReportChart, ReportDocument, ReportKpi, ReportTable } from "./model";

export type DocumentPeriod = { start: string; end: string };
const DAY = 86_400_000;
const parseDay = (value: string) => Date.parse(`${value}T00:00:00Z`);
export const shiftDay = (date: string, days: number) => new Date(parseDay(date) + days * DAY).toISOString().slice(0, 10);
export const periodLength = (period: DocumentPeriod) => Math.round((parseDay(period.end) - parseDay(period.start)) / DAY) + 1;
export const previousOf = (period: DocumentPeriod): DocumentPeriod => ({ start: shiftDay(period.start, -periodLength(period)), end: shiftDay(period.start, -1) });
export function daysOf(period: DocumentPeriod) {
  const days: string[] = [];
  for (let date = period.start; date <= period.end && days.length < 62; date = shiftDay(date, 1)) days.push(date);
  return days;
}
const dayLabel = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const clip = (value: string, max: number) => value.length > max ? value.slice(0, max - 1) + "…" : value;

const nf = (value: number, digits = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value).replace(/ | /g, " ");
const count = (value: number | null | undefined) => value === null || value === undefined ? "—" : nf(value);
const money = (value: number | null | undefined, currency: string) => value === null || value === undefined ? "—"
  : new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value).replace(/ | /g, " ");
const percent = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? "—" : `${nf(value * 100, digits)} %`;

/** Variation relative (ou en points / places) affichée sur une tuile. `lowerIsBetter` : coût par conversion, position. */
export function variation(now: number | null | undefined, before: number | null | undefined, options: { mode?: "relative" | "points" | "places"; lowerIsBetter?: boolean } = {}): Pick<ReportKpi, "change" | "trend" | "good"> {
  if (now === null || now === undefined || before === null || before === undefined) return {};
  const mode = options.mode ?? "relative";
  const diff = now - before;
  if (mode === "relative" && before === 0) return now === 0 ? { change: "stable", trend: "flat" } : {};
  const amount = mode === "relative" ? diff / before * 100 : mode === "points" ? diff * 100 : diff;
  const rounded = Math.round(amount * 10) / 10;
  if (Math.abs(rounded) < (mode === "relative" ? 1 : 0.1)) return { change: "stable", trend: "flat" };
  const trend = rounded > 0 ? "up" : "down";
  const unit = mode === "relative" ? " %" : mode === "points" ? " pt" : rounded === 1 || rounded === -1 ? " place" : " places";
  const digits = mode === "relative" && Math.abs(rounded) >= 10 ? 0 : 1;
  return { change: `${rounded > 0 ? "+" : "−"}${nf(Math.abs(rounded), digits)}${unit}`, trend, good: options.lowerIsBetter ? trend === "down" : trend === "up" };
}
const kpi = (label: string, value: string, change: Pick<ReportKpi, "change" | "trend" | "good"> = {}): ReportKpi => ({ label, value, ...change });
const comparedTo = (period: DocumentPeriod) => `Variations calculées par rapport à la période précédente de même durée (${dayLabel(previousOf(period).start)} – ${dayLabel(previousOf(period).end)}).`;

// --- Google Ads (dont Local Services) ------------------------------------------------------------
export type AdsDailyPoint = { date: string; cost: number | null; clicks: number | null; impressions: number | null; conversions: number | null };
export type AdsDocumentInput = {
  currency: string; campaigns: CampaignRow[]; totals: AdsMetrics; previousTotals: AdsMetrics | null;
  daily: AdsDailyPoint[] | null; leads: LocalServicesLeads | null;
};
const leadTypeLabels: Record<string, string> = { PHONE_CALL: "Appels", MESSAGE: "Messages", BOOKING: "Réservations", UNKNOWN: "Autres" };

export function buildAdsDocument(input: AdsDocumentInput, period: DocumentPeriod): ReportDocument {
  const { totals: now, previousTotals: before, currency } = input;
  const active = input.campaigns.filter((row) => row.hasActivity || row.localServices);
  const kpis = [
    kpi("Budget dépensé", money(now.cost, currency), variation(now.cost, before?.cost)),
    kpi("Clics", count(now.clicks), variation(now.clicks, before?.clicks)),
    kpi("Impressions", count(now.impressions), variation(now.impressions, before?.impressions)),
    kpi("Taux de clic", percent(now.ctr, 2), variation(now.ctr, before?.ctr, { mode: "points" })),
    kpi("Coût par clic", money(now.averageCpc, currency), variation(now.averageCpc, before?.averageCpc, { lowerIsBetter: true })),
    kpi("Conversions", count(now.conversions === null ? null : Math.round(now.conversions * 10) / 10), variation(now.conversions, before?.conversions)),
    kpi("Coût par conversion", money(now.costPerConversion, currency), variation(now.costPerConversion, before?.costPerConversion, { lowerIsBetter: true })),
  ];
  if (input.leads?.available) kpis.push(kpi("Leads Local Services", count(input.leads.total)));

  const charts: ReportChart[] = [];
  const days = daysOf(period);
  if (input.daily?.length) {
    const byDay = new Map(input.daily.map((point) => [point.date, point]));
    const serie = (pick: (point: AdsDailyPoint) => number | null) => days.map((date) => { const point = byDay.get(date); return point ? pick(point) : 0; });
    charts.push({ type: "line", title: "Clics et conversions par jour", labels: days.map(dayLabel), series: [
      { name: "Clics", values: serie((point) => point.clicks) }, { name: "Conversions", values: serie((point) => point.conversions === null ? null : Math.round(point.conversions * 10) / 10) }] });
    charts.push({ type: "bar", title: "Budget dépensé par jour", unit: currency === "EUR" ? "€" : currency, labels: days.map(dayLabel), series: [{ name: "Dépenses", values: serie((point) => point.cost === null ? null : Math.round(point.cost * 100) / 100) }] });
  }
  const spending = active.filter((row) => (row.metrics.cost ?? 0) > 0).sort((a, b) => (b.metrics.cost ?? 0) - (a.metrics.cost ?? 0)).slice(0, 8);
  if (spending.length > 1) charts.push({ type: "bar", title: "Budget par campagne", unit: currency === "EUR" ? "€" : currency, labels: spending.map((row) => clip(row.name, 24)), series: [{ name: "Dépenses", values: spending.map((row) => Math.round((row.metrics.cost ?? 0) * 100) / 100) }] });

  const tables: ReportTable[] = [];
  if (active.length) tables.push({ title: "Résultats par campagne", columns: ["Campagne", "Dépenses", "Clics", "Conversions", "Coût / conv."],
    rows: active.slice(0, 40).map((row) => [clip(row.name, 60) + (row.localServices ? " (Local Services)" : ""), money(row.metrics.cost, currency), count(row.metrics.clicks),
      count(row.metrics.conversions === null ? null : Math.round(row.metrics.conversions * 10) / 10), money(row.metrics.costPerConversion, currency)]) });
  const notes: string[] = [];
  if (input.leads) {
    if (input.leads.available) {
      const rows = Object.entries(input.leads.byType).sort((a, b) => b[1] - a[1]).map(([type, total]) => [leadTypeLabels[type] ?? clip(type, 40), count(total)]);
      if (rows.length) tables.push({ title: "Leads Local Services par type", columns: ["Type de contact", "Leads"], rows: [...rows, ["Total", count(input.leads.total)], ...(input.leads.charged === null ? [] : [["Dont facturés", count(input.leads.charged)]])] });
      else notes.push("Local Services : aucun lead reçu sur la période.");
    } else notes.push("Local Services : les leads n’ont pas pu être récupérés pour cette période.");
  }
  if (before) notes.push(comparedTo(period));
  notes.push("Les conversions peuvent être attribuées avec quelques jours de retard : les derniers jours de la période peuvent encore évoluer.");
  const summary = !active.length
    ? "Aucune diffusion Google Ads sur la période."
    : `Sur la période, ${money(now.cost, currency)} ont été investis dans ${active.length} campagne${active.length > 1 ? "s" : ""} active${active.length > 1 ? "s" : ""}, pour ${count(now.clicks)} clics et ${count(now.conversions === null ? null : Math.round(now.conversions * 10) / 10)} conversions${now.costPerConversion !== null ? ` (${money(now.costPerConversion, currency)} par conversion)` : ""}.${input.leads?.available ? ` ${count(input.leads.total)} lead${input.leads.total > 1 ? "s" : ""} Local Services ${input.leads.total > 1 ? "ont été reçus" : "a été reçu"}.` : ""}`;
  return { key: "google_ads", title: "Google Ads", summary, kpis: kpis.slice(0, 8), charts, tables, notes };
}

// --- Référencement Google (Search Console) ----------------------------------------------------
export type SearchDay = { date: string; clicks: number; impressions: number; position: number | null };
function searchTotals(days: SearchDay[], period: DocumentPeriod) {
  const rows = days.filter((row) => row.date >= period.start && row.date <= period.end);
  let clicks = 0, impressions = 0, weighted = 0, weight = 0;
  for (const row of rows) {
    clicks += row.clicks; impressions += row.impressions;
    if (row.position !== null && row.impressions > 0) { weighted += row.position * row.impressions; weight += row.impressions; }
  }
  return { days: new Set(rows.map((row) => row.date)).size, clicks, impressions, ctr: impressions ? clicks / impressions : null, position: weight ? weighted / weight : null };
}
export function buildSearchDocument(input: { days: SearchDay[] }, period: DocumentPeriod): ReportDocument | null {
  const now = searchTotals(input.days, period);
  if (!now.days) return null;
  const length = periodLength(period), prior = searchTotals(input.days, previousOf(period));
  const comparable = now.days === length && prior.days === length;
  const before = comparable ? prior : null;
  const byDay = new Map(input.days.map((row) => [row.date, row]));
  const days = daysOf(period).filter((date) => byDay.has(date));
  const notes = [
    "Clics et impressions issus de la recherche Google (hors annonces payantes), selon Google Search Console.",
    ...(now.days < length ? [`Google publie ces données avec 2 à 3 jours de retard : ${now.days} jour${now.days > 1 ? "s" : ""} sur ${length} disponibles à la génération ; variations non calculées.`] : []),
    ...(before ? [comparedTo(period)] : []),
    "Position moyenne : plus le chiffre est bas, mieux le site est classé (1 = premier résultat).",
  ];
  return {
    key: "search", title: "Référencement Google",
    summary: `Le site est apparu ${nf(now.impressions)} fois dans les résultats de recherche Google et a reçu ${nf(now.clicks)} visite${now.clicks > 1 ? "s" : ""} depuis ces résultats${now.position !== null ? `, avec une position moyenne de ${nf(now.position, 1)}` : ""}.`,
    kpis: [
      kpi("Clics depuis Google", nf(now.clicks), variation(now.clicks, before?.clicks)),
      kpi("Impressions", nf(now.impressions), variation(now.impressions, before?.impressions)),
      kpi("Taux de clic", percent(now.ctr), variation(now.ctr, before?.ctr, { mode: "points" })),
      kpi("Position moyenne", now.position === null ? "—" : nf(now.position, 1), variation(now.position, before?.position, { mode: "places", lowerIsBetter: true })),
    ],
    charts: days.length > 1 ? [
      { type: "line", title: "Clics depuis Google par jour", labels: days.map(dayLabel), series: [{ name: "Clics", values: days.map((date) => byDay.get(date)!.clicks) }] },
      { type: "bar", title: "Impressions par jour", labels: days.map(dayLabel), series: [{ name: "Impressions", values: days.map((date) => byDay.get(date)!.impressions) }] },
    ] : [],
    tables: [], notes,
  };
}

// --- Site web (Vercel Web Analytics) -----------------------------------------------------------
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const label = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const deviceLabels: Record<string, string> = { mobile: "Mobile", desktop: "Ordinateur", tablet: "Tablette" };
const eventLabels: Record<string, string> = { contact_form_submit: "Formulaire de contact envoyé", phone_click: "Clic sur le téléphone", whatsapp_click: "Clic WhatsApp", email_click: "Clic sur l’e-mail", quote_request: "Demande de devis" };
const friendlyEvent = (value: string) => eventLabels[value] ?? clip(value.replaceAll("_", " "), 60);

export function buildSiteDocument(data: Row | null, period: DocumentPeriod): ReportDocument | null {
  if (!data) return null;
  const visitors = num(data.visitors), pageviews = num(data.pageviews);
  if (visitors === null && pageviews === null) return null;
  const previous = data.previous && typeof data.previous === "object" ? data.previous as Row : null;
  const beforeVisitors = previous ? num(previous.visitors) : null, beforeViews = previous ? num(previous.pageviews) : null;
  const events = rows(data.events).flatMap((row) => { const name = label(row.label), total = num(row.count); return name && total !== null ? [{ name, total }] : []; });
  const previousEvents = previous ? new Map(rows(previous.events).flatMap((row) => { const name = label(row.label), total = num(row.count); return name && total !== null ? [[name, total] as const] : []; })) : null;
  const eventTotal = events.reduce((sum, row) => sum + row.total, 0);
  const pagesPerVisit = visitors && pageviews !== null ? pageviews / visitors : null;
  const kpis = [
    kpi("Visiteurs", count(visitors), variation(visitors, beforeVisitors)),
    kpi("Pages vues", count(pageviews), variation(pageviews, beforeViews)),
    kpi("Pages par visiteur", pagesPerVisit === null ? "—" : nf(pagesPerVisit, 1), variation(pagesPerVisit, beforeVisitors && beforeViews !== null ? beforeViews / beforeVisitors : null)),
  ];
  if (events.length) kpis.push(kpi("Actions des visiteurs", nf(eventTotal), previousEvents ? variation(eventTotal, [...previousEvents.values()].reduce((a, b) => a + b, 0)) : {}));

  const charts: ReportChart[] = [];
  const trend = rows(data.trend).flatMap((row) => { const stamp = label(row.timestamp); return stamp ? [{ date: stamp.slice(0, 10), visitors: num(row.visitors) ?? 0, pageviews: num(row.pageviews) ?? 0 }] : []; });
  if (trend.length > 1) {
    const byDay = new Map(trend.map((point) => [point.date, point]));
    const days = daysOf(period);
    charts.push({ type: "line", title: "Visiteurs et pages vues par jour", labels: days.map(dayLabel), series: [
      { name: "Visiteurs", values: days.map((date) => byDay.get(date)?.visitors ?? 0) }, { name: "Pages vues", values: days.map((date) => byDay.get(date)?.pageviews ?? 0) }] });
  }
  const referrers = rows(data.topReferrers).flatMap((row) => { const name = label(row.label), total = num(row.visitors); return name && total !== null ? [{ name, total }] : []; }).slice(0, 8);
  if (referrers.length > 1) charts.push({ type: "bar", title: "Provenance des visiteurs", labels: referrers.map((row) => clip(row.name, 24)), series: [{ name: "Visiteurs", values: referrers.map((row) => row.total) }] });

  const tables: ReportTable[] = [];
  const pages = rows(data.topPages).flatMap((row) => { const name = label(row.label); return name ? [[clip(name, 90), count(num(row.visitors)), count(num(row.pageviews))]] : []; }).slice(0, 12);
  if (pages.length) tables.push({ title: "Pages les plus consultées", columns: ["Page", "Visiteurs", "Pages vues"], rows: pages });
  if (events.length) tables.push({ title: "Actions des visiteurs", columns: ["Action", "Nombre", "Évolution"], rows: events.slice(0, 12).map((row) => [friendlyEvent(row.name), nf(row.total), previousEvents?.has(row.name) ? variation(row.total, previousEvents.get(row.name)).change ?? "—" : "—"]) });
  const devices = rows(data.devices).flatMap((row) => { const name = label(row.label), total = num(row.visitors); return name && total !== null ? [{ name, total }] : []; });
  const deviceTotal = devices.reduce((sum, row) => sum + row.total, 0);
  if (devices.length && deviceTotal) tables.push({ title: "Appareils utilisés", columns: ["Appareil", "Visiteurs", "Part"], rows: devices.slice(0, 5).map((row) => [deviceLabels[row.name.toLowerCase()] ?? clip(row.name, 40), nf(row.total), percent(row.total / deviceTotal, 0)]) });
  const countries = rows(data.countries).flatMap((row) => { const name = label(row.label), total = num(row.visitors); return name && total !== null ? [[clip(name, 40), nf(total)]] : []; }).slice(0, 6);
  if (countries.length > 1) tables.push({ title: "Pays des visiteurs", columns: ["Pays", "Visiteurs"], rows: countries });

  const notes = ["Mesure d’audience Vercel Web Analytics, sans cookie : un visiteur est compté une fois par jour et par appareil."];
  if (previous && beforeVisitors !== null) notes.push(comparedTo(period));
  if (!events.length) notes.push("Aucune action de visiteur (formulaire, clic téléphone…) n’est encore mesurée sur ce site.");
  return {
    key: "site", title: "Site web",
    summary: `Le site a accueilli ${count(visitors)} visiteur${(visitors ?? 0) > 1 ? "s" : ""} pour ${count(pageviews)} pages vues${events.length ? `, et ${nf(eventTotal)} action${eventTotal > 1 ? "s" : ""} de contact ou d’intérêt ont été enregistrées` : ""}.`,
    kpis, charts, tables: tables.slice(0, 6), notes,
  };
}

// --- Réseaux sociaux (publications diffusées) ------------------------------------------------
export type SocialPost = { date: string; platform: "facebook" | "instagram" | "google_business_profile"; subject: string };
const platformLabels: Record<SocialPost["platform"], string> = { facebook: "Facebook", instagram: "Instagram", google_business_profile: "Google (fiche établissement)" };
const shortPlatform: Record<SocialPost["platform"], string> = { facebook: "Facebook", instagram: "Instagram", google_business_profile: "Fiche Google" };
export function buildSocialDocument(input: { posts: SocialPost[]; previousCount: number | null; channels: SocialPost["platform"][] }, period: DocumentPeriod): ReportDocument | null {
  if (!input.channels.length && !input.posts.length) return null;
  const posts = input.posts.filter((post) => post.date >= period.start && post.date <= period.end).sort((a, b) => a.date.localeCompare(b.date));
  const platforms = [...new Set([...input.channels, ...posts.map((post) => post.platform)])];
  const byPlatform = platforms.map((platform) => ({ platform, total: posts.filter((post) => post.platform === platform).length }));
  const subjects = new Set(posts.map((post) => post.subject)).size;
  return {
    key: "social", title: "Réseaux sociaux",
    summary: posts.length
      ? `${posts.length} publication${posts.length > 1 ? "s" : ""} ${posts.length > 1 ? "ont été diffusées" : "a été diffusée"} sur ${byPlatform.filter((row) => row.total).length} réseau${byPlatform.filter((row) => row.total).length > 1 ? "x" : ""}, autour de ${subjects} sujet${subjects > 1 ? "s" : ""}, à partir de photos réelles de vos chantiers et interventions.`
      : "Aucune publication n’a été diffusée sur la période.",
    kpis: [
      kpi("Publications diffusées", nf(posts.length), variation(posts.length, input.previousCount)),
      ...byPlatform.slice(0, 3).map((row) => kpi(shortPlatform[row.platform], nf(row.total))),
    ],
    charts: byPlatform.length > 1 ? [{ type: "bar", title: "Publications par réseau", labels: byPlatform.map((row) => shortPlatform[row.platform]), series: [{ name: "Publications", values: byPlatform.map((row) => row.total) }] }] : [],
    tables: posts.length ? [{ title: "Publications de la période", columns: ["Date", "Réseau", "Sujet"], rows: posts.slice(0, 60).map((post) => [`${post.date.slice(8, 10)}/${post.date.slice(5, 7)}/${post.date.slice(0, 4)}`, platformLabels[post.platform], clip(post.subject, 110)]) }] : [],
    notes: [
      "Chaque publication est validée par CODE-V avant diffusion.",
      ...(input.previousCount !== null ? [comparedTo(period)] : []),
    ],
  };
}

/** Synthèse de l'e-mail et du rapport : une phrase par document, dans l'ordre des agents. */
export function documentsSummary(documents: ReportDocument[]) {
  return documents.map((document) => `${document.title} : ${document.summary}`).join("\n");
}
