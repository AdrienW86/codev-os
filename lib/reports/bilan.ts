// Agent Bilan client : le bilan du mois à envoyer au client, en tête du rapport mensuel. Module PUR (aucune lecture).
// Il ne calcule aucun résultat nouveau : il compte le travail enregistré sur la période (publications diffusées, articles,
// newsletters, tâches, actions, contrôles du site) et reprend tels quels les chiffres clés déjà calculés par les documents
// des agents, avec leur évolution. Ce qui est seulement prévu ou « à valider » n'est jamais compté comme réalisé.
// Le bilan passe par la même approbation et le même envoi confirmé que le rapport : rien ne part sans l'administrateur.
import type { Period, ReportContent, ReportInput } from "./build";
import { BILAN_RESULTS_TABLE, BILAN_WORK_TABLE, type ReportDocument, type ReportKpi } from "./documents/model";

export type BilanSource = {
  clientName: string;
  period: Period;
  input: ReportInput;
  /** Version client du rapport (synthèse IA vérifiée ou résumé calculé, rubriques client). */
  client: ReportContent;
  /** Documents des agents (Google Ads, référencement, site, réseaux), sans le bilan. */
  documents: readonly ReportDocument[];
};

const inPeriod = (value: string | null | undefined, period: Period) => Boolean(value) && value!.slice(0, 10) >= period.start && value!.slice(0, 10) <= period.end;
const plural = (count: number, one: string, many: string) => `${count.toLocaleString("fr-FR").replace(/ | /g, " ")} ${count > 1 ? many : one}`;
const cut = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`);
const platforms: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", google_business_profile: "Fiche Google", tiktok: "TikTok", snapchat: "Snapchat" };
const documentDomains: Record<string, string> = { google_ads: "Google Ads", search: "Référencement", site: "Site web", social: "Réseaux sociaux" };
const monthName = (period: Period) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period.start}T00:00:00Z`));

/** Synthèse bornée à 1 500 caractères, coupée en fin de phrase plutôt qu'au milieu d'un mot. */
function boundedSummary(text: string): string {
  const value = text.trim();
  if (value.length <= 1500) return value;
  const head = value.slice(0, 1500);
  const end = head.lastIndexOf(". ");
  return end > 400 ? head.slice(0, end + 1) : cut(value, 1500);
}

export type BilanWork = { domain: string; done: string; count: number; kpi: string };

/** Travail réellement livré sur la période, compté à partir des lignes enregistrées (jamais d'estimation). */
export function bilanWork(input: ReportInput, period: Period): BilanWork[] {
  const out: BilanWork[] = [];
  const extras = input.extras;
  const deliveries = (extras?.deliveries ?? []).filter((row) => inPeriod(row.published_at, period));
  if (deliveries.length) {
    const byPlatform = new Map<string, number>();
    for (const row of deliveries) byPlatform.set(row.platform, (byPlatform.get(row.platform) ?? 0) + 1);
    const detail = [...byPlatform.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key, n]) => `${platforms[key] ?? key} ${n}`).join(", ");
    out.push({ domain: "Réseaux sociaux", done: `${plural(deliveries.length, "publication diffusée", "publications diffusées")} (${detail})`, count: deliveries.length, kpi: "Publications diffusées" });
  } else {
    const published = input.publications.filter((item) => item.status === "published" && inPeriod(item.target_date ?? item.updated_at, period));
    if (published.length) out.push({ domain: "Réseaux sociaux", done: plural(published.length, "publication diffusée", "publications diffusées"), count: published.length, kpi: "Publications diffusées" });
  }
  const articles = (extras?.articles ?? []).filter((row) => inPeriod(row.published_at, period));
  if (articles.length) out.push({ domain: "Blog", done: `${plural(articles.length, "article publié", "articles publiés")} : ${articles.slice(0, 3).map((row) => `« ${cut(row.title, 50)} »`).join(", ")}${articles.length > 3 ? "…" : ""}`, count: articles.length, kpi: "Articles publiés" });
  const newsletters = (extras?.newsletters ?? []).filter((row) => inPeriod(row.sent_at, period));
  if (newsletters.length) {
    const recipients = newsletters.reduce((sum, row) => sum + (Number.isFinite(row.sent_count) ? row.sent_count : 0), 0);
    out.push({ domain: "Newsletter", done: `${plural(newsletters.length, "newsletter envoyée", "newsletters envoyées")}${recipients ? ` (${plural(recipients, "destinataire", "destinataires")})` : ""}`, count: newsletters.length, kpi: "Newsletters envoyées" });
  }
  const tasks = input.tasks.filter((task) => inPeriod(task.completed_at, period) || (task.status === "Terminé" && !task.completed_at && inPeriod(task.created_at, period)));
  const actions = input.actions.filter((item) => item.status === "executed" && inPeriod(item.executed_at, period));
  const delivered = tasks.length + actions.length;
  if (delivered) out.push({ domain: "Interventions", done: `${plural(delivered, "intervention réalisée", "interventions réalisées")} : ${[...tasks.map((task) => task.title), ...actions.map((item) => item.label)].slice(0, 3).map((label) => cut(label, 50)).join(", ")}${delivered > 3 ? "…" : ""}`, count: delivered, kpi: "Interventions réalisées" });
  const checks = input.siteChecks.filter((item) => inPeriod(item.checked_at, period));
  if (checks.length) {
    const uptime = Math.round((checks.filter((item) => item.ok).length / checks.length) * 1000) / 10;
    out.push({ domain: "Surveillance du site", done: `${plural(checks.length, "contrôle", "contrôles")} de disponibilité, site disponible ${uptime.toString().replace(".", ",")} % du temps`, count: checks.length, kpi: "Contrôles du site" });
  }
  const resolved = input.incidents.filter((item) => item.status === "resolved" && inPeriod(item.resolved_at, period));
  if (resolved.length) out.push({ domain: "Incidents", done: `${plural(resolved.length, "incident détecté et résolu", "incidents détectés et résolus")}`, count: resolved.length, kpi: "Incidents résolus" });
  return out;
}

/** Chiffres clés des documents des agents, repris à l'identique (valeur et évolution déjà calculées). */
export function bilanResults(documents: readonly ReportDocument[]): { domain: string; kpi: ReportKpi }[] {
  return documents.filter((document) => document.key !== "bilan").flatMap((document) => document.kpis.map((kpi) => ({ domain: documentDomains[document.key] ?? document.title, kpi })));
}

/** Priorités et échéances destinées au client, reprises de sa version du rapport. */
function nextSteps(client: ReportContent): string[] {
  const of = (title: string) => client.sections.find((section) => section.title === title)?.lines ?? [];
  return [...new Set([...of("Nos priorités pour la suite"), ...of("À venir")])].slice(0, 6).map((line) => cut(line, 400));
}

/** Bilan du mois (document « bilan ») ; null quand le rapport est vide (rien à présenter au client). */
export function buildClientBilan(source: BilanSource): ReportDocument | null {
  if (source.client.empty) return null;
  const work = bilanWork(source.input, source.period);
  const results = bilanResults(source.documents);
  // Rapport sans document d'agent (aucune source branchée) : les résultats de la version client sont repris en notes.
  const legacyResults = source.documents.length ? [] : (source.client.sections.find((section) => section.title === "Résultats")?.lines ?? []);
  if (!work.length && !results.length && !legacyResults.length && !source.client.summary.trim()) return null;
  // Tuiles : le travail livré d'abord (4 au plus), puis le premier chiffre clé de chaque document.
  const firstPerDomain = results.filter((item, index) => results.findIndex((other) => other.domain === item.domain) === index);
  const kpis: ReportKpi[] = [
    ...work.slice(0, 4).map((item) => ({ label: cut(item.kpi, 60), value: cut(item.count.toLocaleString("fr-FR").replace(/ | /g, " "), 40) })),
    ...firstPerDomain.map((item) => item.kpi),
  ].slice(0, 8);
  const tables: ReportDocument["tables"] = [];
  if (work.length) tables.push({ title: BILAN_WORK_TABLE, columns: ["Domaine", "Réalisé"], rows: work.map((item) => [cut(item.domain, 160), cut(item.done, 160)]) });
  if (results.length) tables.push({ title: BILAN_RESULTS_TABLE, columns: ["Domaine", "Indicateur", "Valeur", "Évolution"], rows: results.slice(0, 24).map((item) => [item.domain, cut(item.kpi.label, 160), cut(item.kpi.value, 160), item.kpi.change ? cut(item.kpi.change, 160) : "—"]) });
  const notes = [...nextSteps(source.client).map((line) => `Prochaine étape : ${line}`), ...legacyResults.map((line) => cut(line, 400))].map((line) => cut(line, 400)).slice(0, 10);
  return {
    key: "bilan",
    title: cut(`Bilan de ${monthName(source.period)}`, 120),
    summary: boundedSummary(source.client.summary || `Voici le bilan de ${monthName(source.period)} pour ${source.clientName}.`),
    kpis, charts: [], tables, notes,
  };
}
