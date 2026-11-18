// Accueil simplifié (pur) : 3 blocs. 1) les décisions cruciales qui attendent l'administrateur ; 2) ce que l'agence a
// fait seule ces dernières 24 h ; 3) l'état des équipes d'agents. Jamais un chiffre inventé : une source illisible
// est dite illisible, un zéro n'est pas affiché.
import type { Inbox, InboxSection } from "@/lib/review/inbox";
import type { HealthState } from "@/lib/harness/health";

export type DecisionCard = Pick<InboxSection, "id" | "label" | "href" | "manual" | "items" | "crucial" | "status">;

/** Bloc 1 : seules les sections cruciales avec au moins une décision (ou illisibles), dans l'ordre de la boîte. */
export function decisionCards(inbox: Inbox | null): DecisionCard[] | null {
  if (!inbox) return null;
  return inbox.sections
    .filter((s) => s.crucial && (s.manual > 0 || s.status === "unavailable"))
    .map(({ id, label, href, manual, items, crucial, status }) => ({ id, label, href, manual, items: items.slice(0, 3), crucial, status }));
}

export type ActivityCounts = {
  published: number | null; reportsBuilt: number | null; reportsAutoApproved: number | null;
  runsSucceeded: number | null; runsFailed: number | null; imagesGenerated?: number | null; incidentsResolved: number | null;
};
export type ActivityLine = { key: string; text: string; href: string; tone: "neutral" | "red" };

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Bloc 2 : lignes lisibles, sans les zéros ; une source illisible est signalée une fois. */
export function activityLines(counts: ActivityCounts): { lines: ActivityLine[]; unreadable: number } {
  const lines: ActivityLine[] = [];
  let unreadable = 0;
  const add = (key: string, value: number | null | undefined, text: (n: number) => string, href: string, tone: ActivityLine["tone"] = "neutral") => {
    if (value === undefined) return;
    if (value === null) { unreadable++; return; }
    if (value > 0) lines.push({ key, text: text(value), href, tone });
  };
  add("published", counts.published, (n) => `${plural(n, "publication diffusée", "publications diffusées")} sur les réseaux`, "/publications/published");
  add("reports", counts.reportsBuilt, (n) => plural(n, "rapport produit", "rapports produits"), "/reports");
  add("auto-approved", counts.reportsAutoApproved, (n) => `${plural(n, "rapport approuvé", "rapports approuvés")} automatiquement`, "/reports?status=approved");
  add("images", counts.imagesGenerated, (n) => plural(n, "image générée par l’Agent Photo", "images générées par l’Agent Photo"), "/publications/images");
  add("runs", counts.runsSucceeded, (n) => plural(n, "analyse d’agent terminée", "analyses d’agents terminées"), "/agents");
  add("failed", counts.runsFailed, (n) => `${plural(n, "analyse en échec", "analyses en échec")} (relancées au prochain passage ou à la main)`, "/agents", "red");
  add("incidents", counts.incidentsResolved, (n) => plural(n, "incident résolu", "incidents résolus"), "/work?kind=incident");
  return { lines, unreadable };
}

export type TeamInput = { id: string; name: string; members: { name: string; state: HealthState }[] };
export type TeamStatus = { id: string; name: string; state: HealthState; problems: string[] };

const rank: Record<HealthState, number> = { manual: 0, ok: 1, off: 2, attention: 3, failed: 4 };

/** Bloc 3 : état le plus grave de chaque équipe et agents à regarder (en échec ou à vérifier). */
export function teamStatuses(teams: readonly TeamInput[]): TeamStatus[] {
  return teams.filter((team) => team.members.length).map((team) => {
    const state = team.members.reduce<HealthState>((worst, m) => (rank[m.state] > rank[worst] ? m.state : worst), "manual");
    const problems = team.members.filter((m) => m.state === "failed" || m.state === "attention").map((m) => m.name);
    return { id: team.id, name: team.name, state, problems };
  });
}
