// Boîte « À valider » : tout ce qui attend une décision de l'administrateur, toutes sources confondues.
// Fonction pure : lignes déjà lues en base → sections. Une source illisible est signalée, jamais comptée zéro.
import type { HarnessAgentId } from "@/lib/harness/charter";

export type InboxItem = { id: string; title: string; client: string | null; at: string; href: string };
export type InboxSection = {
  id: InboxSourceId; label: string; agent: HarnessAgentId | null; status: "available" | "unavailable";
  /** Total en attente, et part qui attend vraiment une main humaine (le reste est traité par une règle validée). */
  count: number; manual: number; note: string | null; href: string; items: InboxItem[];
};
export type InboxSourceId = "reports" | "recommendations" | "actions" | "ads" | "publications" | "prospection" | "seo" | "photos" | "alerts";
export type Inbox = { sections: InboxSection[]; manualTotal: number; unavailable: number; superseded: string[] };

type Named = { id: string; name: string | null };
export type InboxInput = {
  clients: readonly Named[];
  reports: readonly { id: string; client_id: string | null; kind: string; period_start: string; title?: string | null }[] | null;
  recommendations: readonly { id: string; client_id: string | null; title: string; created_at: string }[] | null;
  actions: readonly { id: string; client_id: string | null; action_type: string; created_at: string; requires_approval: boolean }[] | null;
  ads: readonly { id: string; client_id: string | null; created_at: string; summary?: string | null }[] | null;
  publications: readonly { id: string; client_id: string; created_at: string }[] | null;
  autoApproveClients: ReadonlySet<string> | null;
  prospection: readonly { id: string; subject: string | null; created_at: string }[] | null;
  seo: readonly { id: string; client_id: string | null; keyword: string | null; created_at: string; agent_id?: string | null }[] | null;
  seoAgentId: string | null;
  photos: readonly { client_id: string | null }[] | null;
  alerts: readonly { id: string; client_id: string; title: string; detected_at: string }[] | null;
};

const ITEMS = 8;
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

export function buildInbox(input: InboxInput): Inbox {
  const names = new Map(input.clients.map((client) => [client.id, client.name]));
  const client = (id: string | null | undefined) => (id ? names.get(id) ?? "Client" : null);
  const oldest = <T extends { at: string }>(items: T[]) => [...items].sort((a, b) => a.at.localeCompare(b.at)).slice(0, ITEMS);
  const sections: InboxSection[] = [];
  const add = (section: Omit<InboxSection, "status" | "items" | "count" | "manual" | "note"> & { rows: readonly unknown[] | null; items: () => InboxItem[]; manual?: () => number; note?: () => string | null }) => {
    if (!section.rows) { sections.push({ id: section.id, label: section.label, agent: section.agent, href: section.href, status: "unavailable", count: 0, manual: 0, note: "Source illisible : rien n’est affirmé sur son contenu.", items: [] }); return; }
    const count = section.rows.length;
    sections.push({ id: section.id, label: section.label, agent: section.agent, href: section.href, status: "available", count, manual: section.manual ? section.manual() : count, note: section.note ? section.note() : null, items: count ? oldest(section.items()) : [] });
  };

  const superseded = input.reports ? supersededReports(input.reports) : [];
  add({ id: "reports", label: "Rapports à relire", agent: "report", href: "/reports?status=ready_for_review", rows: input.reports,
    items: () => (input.reports ?? []).map((r) => ({ id: r.id, title: `${kindLabels[r.kind] ?? "Rapport"} du ${r.period_start}`, client: client(r.client_id), at: r.period_start, href: `/reports/${r.id}` })),
    note: () => superseded.length ? `${superseded.length} rapport(s) remplacé(s) par un plus récent du même client : archivables en un clic.` : null });
  add({ id: "recommendations", label: "Recommandations des agents", agent: null, href: "/work?view=review&kind=recommendation", rows: input.recommendations,
    items: () => (input.recommendations ?? []).map((r) => ({ id: r.id, title: r.title, client: client(r.client_id), at: r.created_at, href: `/recommendations/${r.id}` })) });
  const actions = input.actions?.filter((a) => a.requires_approval) ?? null;
  add({ id: "actions", label: "Actions à approuver", agent: null, href: "/work?view=review&kind=action", rows: actions,
    items: () => (actions ?? []).map((a) => ({ id: a.id, title: a.action_type, client: client(a.client_id), at: a.created_at, href: `/actions/${a.id}` })) });
  add({ id: "ads", label: "Modifications Google Ads", agent: "google-ads", href: "/advertising", rows: input.ads,
    items: () => (input.ads ?? []).map((a) => ({ id: a.id, title: a.summary || "Modification de campagne à approuver", client: client(a.client_id), at: a.created_at, href: "/advertising" })) });
  const auto = input.autoApproveClients;
  const manualPublications = (input.publications ?? []).filter((p) => !auto?.has(p.client_id));
  add({ id: "publications", label: "Publications à valider", agent: "publications", href: "/publications/review", rows: input.publications,
    manual: () => (auto ? manualPublications.length : (input.publications ?? []).length),
    items: () => perClient(auto ? manualPublications : input.publications ?? [], client, (id) => `/publications/review?client=${id}`, "publication(s)"),
    note: () => {
      const covered = (input.publications ?? []).length - manualPublications.length;
      return auto && covered ? `${covered} validée(s) automatiquement 12 h avant diffusion (règle choisie pour ces clients).` : null;
    } });
  add({ id: "prospection", label: "E-mails de prospection à approuver", agent: "prospection", href: "/acquisition", rows: input.prospection,
    items: () => (input.prospection ?? []).map((m) => ({ id: m.id, title: m.subject || "Premier contact", client: null, at: m.created_at, href: "/acquisition" })) });
  add({ id: "seo", label: "Opportunités SEO à examiner", agent: "seo", href: input.seoAgentId ? `/agents/${input.seoAgentId}/opportunities` : "/agents", rows: input.seo,
    items: () => (input.seo ?? []).map((o) => ({ id: o.id, title: o.keyword ? `« ${o.keyword} »` : "Opportunité", client: client(o.client_id), at: o.created_at, href: input.seoAgentId ? `/agents/${input.seoAgentId}/opportunities` : "/agents" })) });
  add({ id: "photos", label: "Photos en quarantaine ou non classées", agent: "media-library", href: "/clients", rows: input.photos,
    items: () => perClient((input.photos ?? []).flatMap((p) => p.client_id ? [{ id: p.client_id, client_id: p.client_id, created_at: "" }] : []), client, (id) => `/clients/${id}?tab=media`, "photo(s)") });
  add({ id: "alerts", label: "Alertes du chef de projet", agent: "director", href: "/work?kind=incident", rows: input.alerts,
    items: () => (input.alerts ?? []).map((a) => ({ id: a.id, title: a.title, client: client(a.client_id), at: a.detected_at, href: `/clients/${a.client_id}?tab=agents` })) });

  const order = (s: InboxSection) => (s.status === "unavailable" ? 1 : s.manual > 0 ? 0 : s.count > 0 ? 2 : 3);
  sections.sort((a, b) => order(a) - order(b));
  return { sections, manualTotal: sections.reduce((sum, s) => sum + s.manual, 0), unavailable: sections.filter((s) => s.status === "unavailable").length, superseded };
}

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
