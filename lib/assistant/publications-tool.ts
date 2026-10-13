// Outils Publications de l'assistant (phase 6). Dépendances injectées (testables sans base ni réseau) ; la
// liaison réelle est dans publications-deps.ts et ne fait qu'appeler les fonctions serveur existantes (Agent v2,
// supervision, publication_reschedule, file de validation) avec le même contrôle requireAdmin que l'interface.
//
// Règles :
//  - lectures : exécutées directement, jamais d'écriture ;
//  - écritures : préparées (vérifiées, client et publication résolus, ou question de précision) puis exécutées
//    UNIQUEMENT après confirmation explicite dans une requête distincte (mécanisme commun de l'assistant) ;
//  - AUCUNE dépendance ne publie, n'approuve ni ne soumet : il n'existe pas d'outil de publication.
import type { AssistantContext, TableView } from "@/lib/assistant/views";
import type { PrepareResult, ToolOutcome } from "@/lib/assistant/orchestrator";
import {
  classificationSummary, formatDay, formatRange, formatSlot, libraryHref, matchSlot, MAX_ASSISTANT_PREPARATIONS, MAX_CONTEXT_ITEMS, nextWeekRange, photoExclusionReasons,
  photoStatusLabel, platformLabel, projectCalendarHref, publicationHref, reconnectHref, REVIEW_QUEUE_HREF, safeDescription, supervisionReviewHref, type PhotoDecisionRow,
} from "@/lib/assistant/publications-model";

export type ResolvedClient = { ok: true; id: string; name: string } | { ok: false; message: string };
export type AgentProject = { id: string; name: string };
export type OpenSlot = { occurrenceId: string; platform: string; date: string; time: string; scheduledFor: string };
export type PrepareRunResult = { ok: boolean; message: string; publications: { id: string; platform: string; label: string }[] };
export type PendingPublication = { id: string; clientId: string; clientName: string; projectName: string | null; platform: string | null; subject: string; updatedAt: string };
export type ReschedulablePublication = { id: string; clientId: string; clientName: string; platform: string; subject: string; status: string; revisionId: string; scheduledFor: string | null; targets: { id: string; scheduledFor: string }[] };
export type ReconnectAccount = { clientId: string; clientName: string; platform: string; name: string; reason: string | null };
export type PhotoShortage = { clientId: string; clientName: string; available: number; capped: boolean };

export type PublicationsDeps = {
  /** Même contrôle que l'interface (requireAdmin) : appelé avant toute lecture ou écriture. */
  requireAdmin: () => Promise<unknown>;
  today: () => string;
  resolveClient: (name: string) => Promise<ResolvedClient>;
  /** Projets du client où l'Agent Publications est activé, droits médias confirmés. */
  agentProjects: (clientId: string) => Promise<AgentProject[]>;
  /** Occurrences ouvertes (non liées, non ignorées, à venir) du projet, mêmes règles que l'Agent v2. */
  openSlots: (projectId: string, horizonDays: number) => Promise<OpenSlot[]>;
  /** UNE préparation Agent v2 (brouillons uniquement), appel IA réel autorisé par la confirmation. */
  prepareRun: (projectId: string, excludeOccurrenceIds: string[]) => Promise<PrepareRunResult>;
  pendingReview: (clientId?: string) => Promise<PendingPublication[]>;
  /** Publications de la supervision avec leurs créneaux de reprogrammation (mêmes règles que l'interface). */
  reschedulable: () => Promise<ReschedulablePublication[]>;
  /** publication_reschedule (approbation remise à zéro). */
  reschedule: (publicationId: string, revisionId: string, occurrenceId: string) => Promise<{ ok: boolean; message: string; publicationId?: string }>;
  reconnectAccounts: () => Promise<ReconnectAccount[]>;
  photoDecisions: (clientId: string) => Promise<PhotoDecisionRow[]>;
  clientsLackingPhotos: () => Promise<PhotoShortage[]>;
  /** Rafraîchit les pages Publications après une écriture confirmée. */
  revalidate: (paths: string[]) => void;
};

export const PUBLICATIONS_TOOLS = ["publications_review_list", "publications_photo_explain", "publications_reconnect_list", "publications_photo_shortage", "publications_prepare", "publications_reschedule"] as const;
export type PublicationsToolName = (typeof PUBLICATIONS_TOOLS)[number];
export const isPublicationsTool = (name: string): name is PublicationsToolName => (PUBLICATIONS_TOOLS as readonly string[]).includes(name);

const REFRESH = ["/publications", "/publications/supervision", "/publications/review", "/publications/calendar"];
const same = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" }) === 0;
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

type Failure = { ok: false; question: string; links?: ToolOutcome["links"]; view?: TableView; context?: AssistantContext };
type Preparation = { ok: true; client: { id: string; name: string }; project: AgentProject; inWindow: OpenSlot[]; exclude: string[]; range?: { start: string; end: string } } | Failure;

export function createPublicationsTools(deps: PublicationsDeps) {
  async function client(name: unknown): Promise<ResolvedClient> {
    return typeof name === "string" && name.trim() ? deps.resolveClient(name) : { ok: false, message: "Précisez le client." };
  }

  /** Client, projet de l'agent et créneaux visés ; question de précision au moindre doute (jamais deviné). */
  async function preparation(input: Record<string, unknown>): Promise<Preparation> {
    const resolved = await client(input.client);
    if (!resolved.ok) return { ok: false, question: `${resolved.message} Précisez le client.` };
    const projects = await deps.agentProjects(resolved.id);
    if (!projects.length) return { ok: false, question: `L’Agent Publications n’est activé sur aucun projet de ${resolved.name} (droits médias confirmés). Activez-le depuis l’onglet Agent du projet.`, links: [{ label: `Fiche ${resolved.name}`, href: `/clients/${resolved.id}?tab=publications` }] };
    const wanted = typeof input.project === "string" ? input.project : null;
    const containing = wanted ? projects.filter((item) => item.name.toLowerCase().includes(wanted.toLowerCase())) : [];
    const project = wanted ? projects.find((item) => same(item.name, wanted)) ?? (containing.length === 1 ? containing[0] : undefined) : projects.length === 1 ? projects[0] : undefined;
    if (!project) return { ok: false, question: `${resolved.name} a ${projects.length > 1 ? "plusieurs projets avec l’Agent Publications" : "un autre projet avec l’Agent Publications"} : ${projects.slice(0, 5).map((item) => `« ${item.name} »`).join(", ")}. Lequel ? Par exemple « … pour ${resolved.name} projet ${projects[0].name} ».` };
    const open = await deps.openSlots(project.id, 28);
    if (input.period === "next_week") {
      const range = nextWeekRange(deps.today());
      const inWindow = open.filter((slot) => slot.date >= range.start && slot.date <= range.end);
      if (!inWindow.length) return { ok: false, question: `Aucun créneau libre la semaine prochaine (${formatRange(range)}) pour ${resolved.name} : tous sont déjà préparés, ignorés ou la cadence n’en prévoit pas.`, links: [{ label: "Calendrier du projet", href: projectCalendarHref(project.id) }] };
      return { ok: true, client: resolved, project, inWindow, exclude: open.filter((slot) => !inWindow.includes(slot)).map((slot) => slot.occurrenceId), range };
    }
    if (!open.length) return { ok: false, question: `Aucun créneau libre dans les 4 prochaines semaines pour ${resolved.name} : rien à préparer.`, links: [{ label: "Calendrier du projet", href: projectCalendarHref(project.id) }] };
    return { ok: true, client: resolved, project, inWindow: open, exclude: [] };
  }

  /** Publication visée et créneau exact ; question si la publication, le créneau ou la révision posent problème. */
  async function reschedulePlan(input: Record<string, unknown>): Promise<{ ok: true; input: Record<string, unknown> } | Failure> {
    const today = deps.today();
    if (typeof input.date !== "string" || typeof input.time !== "string") return { ok: false, question: "À quel jour et quelle heure reprogrammer ? Par exemple « vendredi 18 h »." };
    if (input.date < today) return { ok: false, question: `Le ${formatDay(input.date)} est passé. Quel nouveau jour ?` };
    const all = await deps.reschedulable();
    let publication: ReschedulablePublication | undefined;
    if (typeof input.publication_id === "string") {
      publication = all.find((item) => item.id === input.publication_id);
      if (!publication) return { ok: false, question: "Cette publication ne peut pas être reprogrammée depuis l’assistant (archivée, publiée, refusée ou sans créneau). Ouvrez sa fiche pour la modifier.", links: [{ label: "Ouvrir la publication", href: publicationHref(input.publication_id) }] };
    } else {
      const resolved = await client(input.client);
      if (!resolved.ok) return { ok: false, question: `${resolved.message} Précisez le client.` };
      const candidates = all.filter((item) => item.clientId === resolved.id && item.targets.length);
      if (!candidates.length) return { ok: false, question: `Aucune publication de ${resolved.name} ne peut être reprogrammée (aucune programmée avec un créneau libre). Ouvrez la supervision pour vérifier.`, links: [{ label: "Supervision", href: "/publications/supervision" }] };
      if (candidates.length > 1) {
        const shown = candidates.slice(0, MAX_CONTEXT_ITEMS);
        return {
          ok: false, question: `${resolved.name} a ${candidates.length} publications reprogrammables. Laquelle ? Répondez par exemple « Reprogramme la 2 à ${formatDay(input.date)} ${input.time.replace(":", " h ")} ».`,
          view: { type: "table", title: `Publications de ${resolved.name}`, caption: "Numérotées pour la suite de la conversation.", columns: ["N°", "Publication", "Plateforme", "Créneau actuel"], rows: shown.map((item, index) => ({ cells: [String(index + 1), item.subject, platformLabel(item.platform), formatSlot(item.scheduledFor)], href: publicationHref(item.id) })), empty: "Aucune publication." },
          context: { clientId: resolved.id, clientName: resolved.name, view: "publications_list", items: shown.map((item) => item.id) },
        };
      }
      publication = candidates[0];
    }
    if (typeof input.revision_id === "string" && input.revision_id !== publication.revisionId) return { ok: false, question: "La publication a changé depuis la proposition : rien n’a été modifié. Vérifiez-la puis reformulez la demande.", links: [{ label: "Ouvrir la publication", href: publicationHref(publication.id) }] };
    const slot = matchSlot(publication.targets, input.date, input.time);
    if (!slot) {
      const free = publication.targets.slice(0, 5).map((target) => formatSlot(target.scheduledFor));
      return { ok: false, question: `Aucun créneau libre le ${formatDay(input.date)} à ${input.time} pour « ${publication.subject} » (${platformLabel(publication.platform)}). La reprogrammation utilise un créneau existant de la cadence du projet${free.length ? ` : ${free.join(" ; ")}` : " et aucun n’est libre dans les 4 prochaines semaines"}. Lequel ?`, links: [{ label: "Ouvrir la publication", href: publicationHref(publication.id) }] };
    }
    if (typeof input.occurrence_id === "string" && input.occurrence_id !== slot.id) return { ok: false, question: "Le créneau a changé depuis la proposition : rien n’a été modifié. Reformulez la demande." };
    return { ok: true, input: { publication_id: publication.id, date: input.date, time: input.time, revision_id: publication.revisionId, occurrence_id: slot.id, subject: publication.subject.slice(0, 300), platform: publication.platform, client_name: publication.clientName.slice(0, 120), ...(publication.scheduledFor ? { from: publication.scheduledFor.slice(0, 40) } : {}) } };
  }

  async function prepare(name: PublicationsToolName, input: Record<string, unknown>): Promise<PrepareResult> {
    await deps.requireAdmin();
    if (name === "publications_prepare") {
      const plan = await preparation(input);
      if (!plan.ok) return plan;
      return { ok: true, input: { client: plan.client.name, project: plan.project.name.slice(0, 120), ...(plan.range ? { period: "next_week", start: plan.range.start, end: plan.range.end, slots: plan.inWindow.length } : { count: Math.min(Number(input.count ?? 1), MAX_ASSISTANT_PREPARATIONS) }) } };
    }
    if (name === "publications_reschedule") return reschedulePlan(input);
    return { ok: true, input };
  }

  async function execute(name: PublicationsToolName, input: Record<string, unknown>, context: AssistantContext = {}): Promise<ToolOutcome> {
    await deps.requireAdmin();
    switch (name) {
      case "publications_review_list": {
        let scope: { id: string; name: string } | undefined;
        if (typeof input.client === "string") { const resolved = await client(input.client); if (!resolved.ok) return { ok: false, text: resolved.message }; scope = resolved; }
        const rows = await deps.pendingReview(scope?.id);
        const shown = rows.slice(0, MAX_CONTEXT_ITEMS);
        const href = supervisionReviewHref(scope?.id);
        const view: TableView & { link: { label: string; href: string } } = {
          type: "table", title: scope ? `Publications à valider — ${scope.name}` : "Publications à valider", caption: "Lecture seule : l’approbation se fait sur la carte de validation, jamais depuis l’assistant.",
          columns: ["N°", "Client", "Publication", "Plateforme", "Projet", "Mise à jour"],
          rows: shown.map((row, index) => ({ cells: [String(index + 1), row.clientName, row.subject, row.platform ? platformLabel(row.platform) : "Multi-plateforme", row.projectName ?? "—", row.updatedAt.slice(0, 10)], href: publicationHref(row.id) })),
          empty: "Aucune publication en attente de validation.", link: { label: "Valider dans la supervision", href },
        };
        const links = [{ label: "Valider dans la supervision", href }, { label: "File de validation complète", href: REVIEW_QUEUE_HREF }];
        const nextContext: AssistantContext = { ...(scope ? { clientId: scope.id, clientName: scope.name } : {}), view: "publications_list", items: shown.map((row) => row.id), ...(shown.length === 1 ? { publicationId: shown[0].id } : {}) };
        if (!rows.length) return { ok: true, text: `Aucune publication${scope ? ` de ${scope.name}` : ""} en attente de validation.`, links, view, context: nextContext };
        return { ok: true, text: `${plural(rows.length, "publication")} à valider${scope ? ` pour ${scope.name}` : ""} : ${shown.slice(0, 3).map((row) => `${row.clientName} — ${row.subject}`).join(" · ")}${rows.length > 3 ? "…" : ""}. La validation se fait dans la supervision.`, links, view, context: nextContext };
      }
      case "publications_photo_explain": {
        const resolved = await client(input.client ?? (context.clientName && typeof input.photo_id === "string" ? context.clientName : undefined));
        if (!resolved.ok) return { ok: false, text: typeof input.client === "string" ? resolved.message : "De quel client est cette photo ?" };
        const rows = await deps.photoDecisions(resolved.id);
        const excluded = rows.map((row) => ({ row, reasons: photoExclusionReasons(row) })).filter((item) => item.reasons.length)
          .sort((a, b) => (b.row.statusChangedAt ?? "").localeCompare(a.row.statusChangedAt ?? ""));
        const keepItems = context.view === "publication_photos" && context.clientId === resolved.id && context.items ? { items: context.items } : {};
        let chosen: { row: PhotoDecisionRow; reasons: string[] } | undefined;
        if (typeof input.photo_id === "string") {
          const row = rows.find((item) => item.id === input.photo_id);
          if (!row) return { ok: false, text: `Photo introuvable dans la photothèque de ${resolved.name}.`, links: [{ label: "Photothèque", href: libraryHref(resolved.id) }] };
          chosen = { row, reasons: photoExclusionReasons(row) };
        } else if (excluded.length === 1) chosen = excluded[0];
        else if (!excluded.length) return { ok: true, text: `Aucune photo de ${resolved.name} n’est actuellement écartée ou rejetée.`, links: [{ label: "Photothèque", href: libraryHref(resolved.id) }] };
        else {
          // Plusieurs photos écartées : on demande laquelle (jamais deviné), liste numérotée pour la suite.
          const shown = excluded.slice(0, MAX_CONTEXT_ITEMS);
          return {
            ok: true, text: `${plural(excluded.length, "photo")} de ${resolved.name} ${excluded.length > 1 ? "sont écartées" : "est écartée"}. Laquelle ? Répondez par exemple « la photo 2 ».`,
            links: [{ label: "Photothèque", href: libraryHref(resolved.id) }],
            view: { type: "table", title: `Photos écartées — ${resolved.name}`, caption: "Numérotées pour la suite de la conversation. Aucune légende ni nom de fichier n’est affiché.", columns: ["N°", "Reçue le", "Statut", "Description", "Raison principale"],
              rows: shown.map((item, index) => ({ cells: [String(index + 1), (item.row.receivedAt ?? "").slice(0, 10) || "—", photoStatusLabel(item.row.libraryStatus), safeDescription(item.row), item.reasons[0]], href: libraryHref(resolved.id) })), empty: "Aucune photo écartée.", link: { label: "Photothèque", href: libraryHref(resolved.id) } },
            context: { clientId: resolved.id, clientName: resolved.name, view: "publication_photos", items: shown.map((item) => item.row.id) },
          };
        }
        const received = (chosen.row.receivedAt ?? "").slice(0, 10);
        const text = chosen.reasons.length
          ? `Photo${received ? ` du ${received}` : ""} de ${resolved.name} : ${chosen.reasons.join(" ")}`
          : `Cette photo de ${resolved.name} n’est pas écartée : l’agent peut la proposer (${photoStatusLabel(chosen.row.libraryStatus).toLowerCase()}).`;
        return {
          ok: true, text, links: [{ label: "Photothèque", href: libraryHref(resolved.id) }],
          view: { type: "table", title: `Photo${received ? ` du ${received}` : ""} — ${resolved.name}`, columns: ["Élément", "Détail"], rows: [
            { cells: ["Statut", photoStatusLabel(chosen.row.libraryStatus)] }, { cells: ["Description", safeDescription(chosen.row)] },
            { cells: ["Classement IA", classificationSummary(chosen.row)] }, ...chosen.reasons.map((reason, index) => ({ cells: [index ? "" : "Raisons", reason] })),
          ], empty: "Aucune information.", link: { label: "Photothèque", href: libraryHref(resolved.id) } },
          context: { clientId: resolved.id, clientName: resolved.name, view: "publication_photos", assetId: chosen.row.id, ...keepItems },
        };
      }
      case "publications_reconnect_list": {
        let scope: { id: string; name: string } | undefined;
        if (typeof input.client === "string") { const resolved = await client(input.client); if (!resolved.ok) return { ok: false, text: resolved.message }; scope = resolved; }
        const platform = typeof input.platform === "string" ? input.platform : null;
        const rows = (await deps.reconnectAccounts()).filter((row) => (!platform || row.platform === platform) && (!scope || row.clientId === scope.id));
        const label = platform ? `comptes ${platformLabel(platform)}` : "comptes";
        const clients = [...new Map(rows.map((row) => [row.clientId, row.clientName])).entries()];
        const view: TableView & { link: { label: string; href: string } } = {
          type: "table", title: `${label[0].toUpperCase()}${label.slice(1)} à reconnecter`, caption: "La reconnexion se fait depuis l’onglet Publications de la fiche client (OAuth). Aucun jeton n’est lu ni affiché.",
          columns: ["Client", "Compte", "Plateforme", "Raison"], rows: rows.map((row) => ({ cells: [row.clientName, row.name, platformLabel(row.platform), row.reason ?? "—"], href: reconnectHref(row.clientId) })),
          empty: `Aucun ${label.replace("comptes", "compte")} à reconnecter.`, link: { label: "Supervision", href: "/publications/supervision" },
        };
        if (!rows.length) return { ok: true, text: `Aucun ${label.replace("comptes", "compte")} à reconnecter${scope ? ` pour ${scope.name}` : ""}.`, links: [{ label: "Supervision", href: "/publications/supervision" }], view };
        return { ok: true, text: `${plural(rows.length, "compte")} à reconnecter : ${rows.slice(0, 4).map((row) => `${row.clientName} — ${row.name} (${platformLabel(row.platform)}${row.reason ? `, ${row.reason.toLowerCase()}` : ""})`).join(" · ")}.`, links: clients.slice(0, 3).map(([id, nameOf]) => ({ label: `Reconnecter ${nameOf}`, href: reconnectHref(id) })), view };
      }
      case "publications_photo_shortage": {
        const rows = await deps.clientsLackingPhotos();
        const view: TableView & { link: { label: string; href: string } } = {
          type: "table", title: "Clients à court de photos", caption: "Photos réellement proposables par l’agent (mêmes règles que la sélection). Sous le seuil, l’agent risque de préparer sans photo.",
          columns: ["Client", "Photos disponibles"], rows: rows.map((row) => ({ cells: [row.clientName, `${row.available}${row.capped ? "+" : ""}`], href: libraryHref(row.clientId) })),
          empty: "Aucun client à court de photos.", link: { label: "Supervision", href: "/publications/supervision" },
        };
        if (!rows.length) return { ok: true, text: "Aucun client ne manque de photos pour les Publications.", links: [{ label: "Supervision", href: "/publications/supervision" }], view };
        return { ok: true, text: `${plural(rows.length, "client")} ${rows.length > 1 ? "manquent" : "manque"} de photos : ${rows.slice(0, 5).map((row) => `${row.clientName} (${row.available} disponible${row.available > 1 ? "s" : ""})`).join(" · ")}.`, links: rows.slice(0, 3).map((row) => ({ label: `Photothèque ${row.clientName}`, href: libraryHref(row.clientId) })), view };
      }
      case "publications_prepare": {
        // Écriture confirmée : tout est revérifié (client, projet, créneaux) avant le premier appel.
        const plan = await preparation(input);
        if (!plan.ok) return { ok: false, text: plan.question, links: plan.links };
        const target = plan.range ? MAX_ASSISTANT_PREPARATIONS : Math.min(Number(input.count ?? 1), MAX_ASSISTANT_PREPARATIONS);
        const created: PrepareRunResult["publications"] = [];
        let runs = 0, stop: string | null = null;
        while (runs < target && (plan.range || created.length < target)) {
          const result = await deps.prepareRun(plan.project.id, plan.exclude);
          runs++;
          if (!result.ok) { stop = result.message; break; }
          created.push(...result.publications);
          if (!result.publications.length) break;
        }
        if (created.length) deps.revalidate([...REFRESH, `/projects/${plan.project.id}`, `/projects/${plan.project.id}/calendar`]);
        const links = [{ label: "Calendrier du projet", href: projectCalendarHref(plan.project.id) }, { label: "Supervision", href: "/publications/supervision" }];
        if (!created.length) return { ok: false, text: stop ?? "Aucun brouillon créé.", links };
        const remaining = plan.range ? Math.max(plan.inWindow.length - created.length, 0) : 0;
        const platforms = [...new Set(created.map((item) => item.label))].join(", ");
        return {
          ok: true, links,
          text: `${plural(created.length, "brouillon")} préparé${created.length > 1 ? "s" : ""} pour ${plan.client.name} (${platforms}${plan.range ? `, semaine ${formatRange(plan.range)}` : ""}). `
            + "Brouillons uniquement : rien n’est soumis, approuvé ni publié. Relisez-les puis soumettez-les à la validation."
            + (stop && !/aucune occurrence ouverte/i.test(stop) ? ` Arrêt : ${stop}` : "")
            + (plan.range && runs >= target && remaining ? ` Il reste des créneaux libres cette semaine-là : relancez la demande pour continuer.` : ""),
        };
      }
      case "publications_reschedule": {
        const plan = await reschedulePlan(input);
        if (!plan.ok) return { ok: false, text: plan.question, links: plan.links };
        const { publication_id, revision_id, occurrence_id } = plan.input as { publication_id: string; revision_id: string; occurrence_id: string };
        const result = await deps.reschedule(publication_id, revision_id, occurrence_id);
        if (result.ok) deps.revalidate(REFRESH);
        return { ok: result.ok, text: result.message, links: [...(result.publicationId ? [{ label: "Ouvrir la publication", href: publicationHref(result.publicationId) }] : []), { label: "À valider", href: supervisionReviewHref() }] };
      }
    }
  }

  return { prepare, execute };
}
