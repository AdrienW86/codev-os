// Boîte « À valider » : seules les actions CRUCIALES attendent l'administrateur (lib/review/crucial.ts) ; le reste est
// traité automatiquement et seulement compté, pour mémoire. Fonction pure : lignes déjà lues en base → sections.
// Une source illisible est signalée, jamais comptée zéro.
import type { HarnessAgentId } from "@/lib/harness/charter";
import { crucialCategories, crucialCategoryOfAction, reportNeedsConfirmation, type CrucialCategory } from "./crucial";

export type InboxItem = { id: string; title: string; client: string | null; at: string; href: string };
export type InboxSection = {
  id: InboxSourceId; label: string; agent: HarnessAgentId | null; status: "available" | "unavailable";
  /** Catégorie cruciale (décision de l'administrateur) ; null = traité automatiquement, jamais une décision. */
  crucial: CrucialCategory | null;
  /** Total en attente, et part qui attend vraiment une main humaine (0 pour une section automatique). */
  count: number; manual: number; note: string | null; href: string; items: InboxItem[];
};
export type InboxSourceId = "reports" | "client-bilans" | "ads-reports" | "recommendations" | "actions" | "ads" | "publications" | "generated-images" | "prospection" | "leads" | "newsletters" | "ai-budget" | "seo" | "photos" | "alerts";
export type Inbox = { sections: InboxSection[]; manualTotal: number; unavailable: number; superseded: string[] };

type Named = { id: string; name: string | null };
export type InboxInput = {
  clients: readonly Named[];
  reports: readonly { id: string; client_id: string | null; kind: string; period_start: string; title?: string | null }[] | null;
  /** Rapports mensuels du mois écoulé portant un bilan client, non encore envoyés. Absent : aucune section. */
  bilans?: readonly { id: string; client_id: string | null; period_start: string }[] | null;
  recommendations: readonly { id: string; client_id: string | null; title: string; created_at: string }[] | null;
  actions: readonly { id: string; client_id: string | null; action_type: string; created_at: string; requires_approval: boolean }[] | null;
  ads: readonly { id: string; client_id: string | null; created_at: string; summary?: string | null }[] | null;
  publications: readonly { id: string; client_id: string; created_at: string }[] | null;
  autoApproveClients: ReadonlySet<string> | null;
  /** Images de l'Agent Photo en attente. Absent (undefined) : agent non installé, aucune section. */
  generatedImages?: readonly { id: string; client_id: string; created_at: string }[] | null;
  prospection: readonly { id: string; subject: string | null; created_at: string }[] | null;
  /** Réponses et relances de l'Agent Leads à valider (envoi au demandeur). Absent : agent non installé, aucune section. */
  leads?: readonly { id: string; client_id: string; subject: string | null; created_at: string }[] | null;
  /** Newsletters en brouillon (envoi aux contacts du client). Absent : module non installé, aucune section. */
  newsletters?: readonly { id: string; client_id: string; subject: string | null; created_at: string }[] | null;
  /** Clients dont le plafond IA mensuel est atteint. Absent : budget non installé, aucune section. */
  aiBudget?: readonly { client_id: string; spentEur: number; capEur: number }[] | null;
  seo: readonly { id: string; client_id: string | null; keyword: string | null; created_at: string; agent_id?: string | null }[] | null;
  seoAgentId: string | null;
  photos: readonly { client_id: string | null }[] | null;
  alerts: readonly { id: string; client_id: string; title: string; detected_at: string }[] | null;
};

const ITEMS = 8;
const monthLabel = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)) : day;
/** Premier jour du mois précédent (heure de Paris) : seuls les bilans du mois écoulé attendent un envoi. */
export function previousMonthStart(now: Date): string {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(now).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return date.toISOString().slice(0, 10);
}
const kindLabels: Record<string, string> = { weekly: "Rapport hebdomadaire", monthly: "Rapport mensuel", google_ads: "Rapport Google Ads" };
const SUPERSEDABLE = new Set(["weekly", "monthly"]);

/** Rapports à relire remplacés par un rapport plus récent du même client et du même type (hebdo / mensuel). */
export function supersededReports(reports: readonly { id: string; client_id: string | null; kind: string; period_start: string }[]): string[] {
  const latest = new Map<string, string>();
  for (const report of reports) {
    if (!report.client_id || !SUPERSEDABLE.has(report.kind)) continue;
    const key = `${report.client_id}:${report.kind}`;
    const current = latest.get(key);
    if (!current || report.period_start > current) latest.set(key, report.period_start);
  }
  return reports.filter((report) => report.client_id && SUPERSEDABLE.has(report.kind) && report.period_start < (latest.get(`${report.client_id}:${report.kind}`) ?? "")).map((report) => report.id);
}

/** Décisions automatiques des rapports internes : le plus récent par client et type est approuvé, les remplacés archivés. */
export function planReportDecisions<T extends { id: string; client_id: string | null; kind: string; period_start: string }>(rows: readonly T[]): { approve: T[]; archive: T[] } {
  const internal = rows.filter((r) => r.client_id && !reportNeedsConfirmation(r.kind) && SUPERSEDABLE.has(r.kind));
  const superseded = new Set(supersededReports(internal));
  return { approve: internal.filter((r) => !superseded.has(r.id)), archive: internal.filter((r) => superseded.has(r.id)) };
}

const AUTO = {
  reports: "Approuvés automatiquement par le planificateur (les anciens remplacés sont archivés) ; l’envoi au client reste à votre initiative.",
  recommendations: "Conseils consultables dans la fiche de l’agent ; une action qui en découle et touche un tiers reste à confirmer.",
  seo: "Consultables dans l’Agent SEO ; seule une modification du site qui en découle reste à confirmer.",
  photos: "La décision de l’analyse s’applique (purge après la durée de conservation) ; visibles dans la photothèque.",
  alerts: "Information du chef de projet, suivie dans l’état des agents.",
} as const;

export function buildInbox(input: InboxInput): Inbox {
  const names = new Map(input.clients.map((client) => [client.id, client.name]));
  const client = (id: string | null | undefined) => (id ? names.get(id) ?? "Client" : null);
  const oldest = <T extends { at: string }>(items: T[]) => [...items].sort((a, b) => a.at.localeCompare(b.at)).slice(0, ITEMS);
  const sections: InboxSection[] = [];
  type Spec = Omit<InboxSection, "status" | "items" | "count" | "manual" | "note"> & { rows: readonly unknown[] | null; items: () => InboxItem[]; manual?: () => number; note?: () => string | null };
  const add = (section: Spec) => {
    const base = { id: section.id, label: section.label, agent: section.agent, href: section.href, crucial: section.crucial };
    if (!section.rows) { sections.push({ ...base, status: "unavailable", count: 0, manual: 0, note: "Source illisible : rien n’est affirmé sur son contenu.", items: [] }); return; }
    const count = section.rows.length;
    // Une section automatique n'attend jamais l'administrateur : elle est comptée pour mémoire, sans éléments à traiter.
    const manual = section.crucial ? (section.manual ? section.manual() : count) : 0;
    sections.push({ ...base, status: "available", count, manual, note: section.note ? section.note() : null, items: section.crucial && count ? oldest(section.items()) : [] });
  };

  // --- Confirmations cruciales -----------------------------------------------------------------------------------
  if (input.generatedImages !== undefined) add({ id: "generated-images", label: "Images générées à valider", agent: "publication-photo", crucial: "generated-image", href: "/publications/images", rows: input.generatedImages,
    items: () => perClient(input.generatedImages ?? [], client, () => "/publications/images", "image(s)") });
  add({ id: "ads", label: "Modifications Google Ads", agent: "google-ads", crucial: "ads-spend", href: "/advertising", rows: input.ads,
    items: () => (input.ads ?? []).map((a) => ({ id: a.id, title: a.summary || "Modification de campagne à approuver", client: client(a.client_id), at: a.created_at, href: "/advertising" })) });
  const adsReports = input.reports?.filter((r) => reportNeedsConfirmation(r.kind)) ?? null;
  add({ id: "ads-reports", label: "Rapports Google Ads à approuver avant envoi", agent: "report", crucial: "third-party-email", href: "/reports?status=ready_for_review", rows: adsReports,
    items: () => (adsReports ?? []).map((r) => ({ id: r.id, title: `${kindLabels[r.kind] ?? "Rapport"} du ${r.period_start}`, client: client(r.client_id), at: r.period_start, href: `/reports/${r.id}` })) });
  // Agent Bilan client : l'envoi au client est une décision de l'administrateur (aperçu, destinataire confirmé).
  if (input.bilans !== undefined) add({ id: "client-bilans", label: "Bilans mensuels à envoyer aux clients", agent: "client-bilan", crucial: "third-party-email", href: "/reports?kind=monthly", rows: input.bilans,
    items: () => (input.bilans ?? []).map((r) => ({ id: r.id, title: `Bilan de ${monthLabel(r.period_start)}`, client: client(r.client_id), at: r.period_start, href: `/reports/${r.id}` })) });
  const actions = input.actions?.filter((a) => a.requires_approval && crucialCategoryOfAction(a.action_type)) ?? null;
  add({ id: "actions", label: "Actions à approuver (site, envoi)", agent: null, crucial: "client-site", href: "/work?view=review&kind=action", rows: actions,
    items: () => (actions ?? []).map((a) => ({ id: a.id, title: a.action_type, client: client(a.client_id), at: a.created_at, href: `/actions/${a.id}` })) });
  const auto = input.autoApproveClients;
  const manualPublications = (input.publications ?? []).filter((p) => !auto?.has(p.client_id));
  add({ id: "publications", label: "Publications à valider", agent: "publications", crucial: "manual-publication", href: "/publications/review", rows: input.publications,
    manual: () => (auto ? manualPublications.length : (input.publications ?? []).length),
    items: () => perClient(auto ? manualPublications : input.publications ?? [], client, (id) => `/publications/review?client=${id}`, "publication(s)"),
    note: () => {
      const covered = (input.publications ?? []).length - manualPublications.length;
      return auto && covered ? `${covered} validée(s) automatiquement 12 h avant diffusion (règle choisie pour ces clients).` : null;
    } });
  add({ id: "prospection", label: "E-mails de prospection à approuver", agent: "prospection", crucial: "third-party-email", href: "/acquisition", rows: input.prospection,
    items: () => (input.prospection ?? []).map((m) => ({ id: m.id, title: m.subject || "Premier contact", client: null, at: m.created_at, href: "/acquisition" })) });
  if (input.leads !== undefined) add({ id: "leads", label: "Réponses aux demandes de devis", agent: "leads", crucial: "third-party-email", href: "/leads", rows: input.leads,
    items: () => (input.leads ?? []).map((m) => ({ id: m.id, title: m.subject || "Réponse au prospect", client: client(m.client_id), at: m.created_at, href: `/leads?client=${m.client_id}` })) });
  if (input.newsletters !== undefined) add({ id: "newsletters", label: "Newsletters à approuver", agent: "newsletter", crucial: "third-party-email", href: "/emailing", rows: input.newsletters,
    items: () => (input.newsletters ?? []).map((n) => ({ id: n.id, title: n.subject || "Newsletter", client: client(n.client_id), at: n.created_at, href: "/emailing" })) });
  if (input.aiBudget !== undefined) add({ id: "ai-budget", label: "Plafonds IA atteints", agent: null, crucial: "ai-budget", href: "/settings", rows: input.aiBudget,
    items: () => (input.aiBudget ?? []).map((b) => ({ id: b.client_id, title: `${b.spentEur.toFixed(2)} € dépensés sur ${b.capEur.toFixed(2)} € ce mois : relever le plafond ?`, client: client(b.client_id), at: "", href: `/clients/${b.client_id}?tab=agents` })) });

  // --- Traité automatiquement (compté pour mémoire) ---------------------------------------------------------------
  const superseded = input.reports ? supersededReports(input.reports) : [];
  const internalReports = input.reports?.filter((r) => !reportNeedsConfirmation(r.kind)) ?? null;
  add({ id: "reports", label: "Rapports internes", agent: "report", crucial: null, href: "/reports?status=ready_for_review", rows: internalReports, items: () => [], note: () => AUTO.reports });
  add({ id: "recommendations", label: "Recommandations des agents", agent: null, crucial: null, href: "/work?view=review&kind=recommendation", rows: input.recommendations, items: () => [], note: () => AUTO.recommendations });
  add({ id: "seo", label: "Opportunités SEO", agent: "seo", crucial: null, href: input.seoAgentId ? `/agents/${input.seoAgentId}/opportunities` : "/agents", rows: input.seo, items: () => [], note: () => AUTO.seo });
  add({ id: "photos", label: "Photos en quarantaine ou non classées", agent: "media-library", crucial: null, href: "/clients", rows: input.photos, items: () => [], note: () => AUTO.photos });
  add({ id: "alerts", label: "Alertes du chef de projet", agent: "director", crucial: null, href: "/work?kind=incident", rows: input.alerts, items: () => [], note: () => AUTO.alerts });

  const order = (s: InboxSection) => (s.status === "unavailable" ? 1 : s.manual > 0 ? 0 : s.crucial ? 2 : 3);
  sections.sort((a, b) => order(a) - order(b));
  return { sections, manualTotal: sections.reduce((sum, s) => sum + s.manual, 0), unavailable: sections.filter((s) => s.status === "unavailable").length, superseded };
}

/** Libellé et raison d'une catégorie cruciale (affichage). */
export const crucialLabel = (category: CrucialCategory) => crucialCategories[category];

/** Un élément par client (nombre en attente), pour les sources volumineuses. */
function perClient(rows: readonly { client_id: string; created_at: string }[], name: (id: string) => string | null, href: (id: string) => string, unit: string): InboxItem[] {
  const groups = new Map<string, { n: number; at: string }>();
  for (const row of rows) {
    const g = groups.get(row.client_id) ?? { n: 0, at: row.created_at };
    g.n++; if (row.created_at && (!g.at || row.created_at < g.at)) g.at = row.created_at;
    groups.set(row.client_id, g);
  }
  return [...groups.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, g]) => ({ id, title: `${g.n} ${unit}`, client: name(id), at: g.at, href: href(id) }));
}
