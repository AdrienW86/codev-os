// Mémoire client partagée (socle éditorial, lot 1) : règles pures. Aucune lecture, aucun appel.
// Un fait a une source et un statut ; seuls les faits confirmés et en cours de validité sont distribués aux agents,
// et chaque agent ne reçoit que les catégories utiles à sa mission.

export const FACT_KINDS = ["company", "service", "zone", "guarantee", "certification", "pricing", "process", "team", "tone", "exclusion", "other"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const FACT_SOURCES = ["client_record", "admin", "client_message", "client_website", "agent_proposal"] as const;
export type FactSource = (typeof FACT_SOURCES)[number];
export type FactStatus = "proposed" | "confirmed" | "rejected" | "archived";

export type ClientFact = {
  id: string; kind: FactKind; statement: string; source: FactSource; sourceRef: string | null;
  status: FactStatus; validUntil: string | null; confirmedBy: string | null; createdAt: string;
};

export const factKindLabels: Readonly<Record<FactKind, string>> = {
  company: "Entreprise", service: "Prestation", zone: "Zone d’intervention", guarantee: "Garantie", certification: "Certification",
  pricing: "Prix", process: "Méthode de travail", team: "Équipe", tone: "Ton et style", exclusion: "À ne jamais dire", other: "Autre",
};
export const factSourceLabels: Readonly<Record<FactSource, string>> = {
  client_record: "Fiche client", admin: "Administrateur", client_message: "Message du client", client_website: "Site du client", agent_proposal: "Proposition d’agent",
};

const ALL: readonly FactKind[] = FACT_KINDS;
/**
 * Distribution : catégories reçues par chaque agent. Les prix ne vont qu'aux agents qui en ont l'usage
 * (Google Ads, prospection, rapport) ; un agent absent de la liste reçoit tout sauf les prix.
 */
const WITHOUT_PRICING = ALL.filter((k) => k !== "pricing");
export const agentFactKinds: Readonly<Record<string, readonly FactKind[]>> = {
  publications: WITHOUT_PRICING, blog: WITHOUT_PRICING, visual: WITHOUT_PRICING, video: WITHOUT_PRICING, newsletter: WITHOUT_PRICING,
  copywriter: WITHOUT_PRICING, "fact-check": ALL, "editorial-review": ALL, "editorial-planning": WITHOUT_PRICING,
  "media-library": ["company", "service", "zone", "exclusion"], seo: WITHOUT_PRICING,
  "google-ads": ALL, prospection: ALL, report: ALL, director: ALL,
};

/** Empreinte de dédoublonnage : minuscules, sans accents ni ponctuation, espaces réduits. */
export function factFingerprint(statement: string): string {
  return statement.toLocaleLowerCase("fr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 600);
}

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/** Saisie d'un fait par l'administrateur : catégorie connue, énoncé de 2 à 600 caractères, échéance facultative. */
export function parseFactInput(input: { kind: unknown; statement: unknown; validUntil?: unknown }, today: string):
  { ok: true; kind: FactKind; statement: string; validUntil: string | null } | { ok: false; message: string } {
  const kind = FACT_KINDS.find((k) => k === input.kind);
  if (!kind) return { ok: false, message: "Catégorie inconnue." };
  const statement = clean(input.statement);
  if (statement.length < 2 || statement.length > 600) return { ok: false, message: "Le fait doit faire entre 2 et 600 caractères." };
  if (!factFingerprint(statement)) return { ok: false, message: "Le fait est vide." };
  const until = clean(input.validUntil);
  if (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < today)) return { ok: false, message: "Date de fin invalide ou passée." };
  return { ok: true, kind, statement, validUntil: until || null };
}

export type RecordFields = {
  name: string; activity: string | null; zone: string | null;
  services: readonly string[]; activitySummary: string | null; communicationGuidelines: string | null;
  editorialBrief: string | null; editorialRules: readonly string[];
};
export type DerivedFact = { kind: FactKind; statement: string; sourceRef: string };

/**
 * Faits déjà saisis par l'administrateur dans la fiche client et les réglages des agents : repris tels quels
 * (aucune reformulation), chacun avec le champ d'où il vient.
 */
export function factsFromRecord(record: RecordFields): DerivedFact[] {
  const out: DerivedFact[] = [];
  const push = (kind: FactKind, value: unknown, sourceRef: string) => {
    const statement = clean(value).slice(0, 600);
    if (statement.length >= 2 && factFingerprint(statement)) out.push({ kind, statement, sourceRef });
  };
  push("company", record.activity && `${record.name} : ${record.activity}`, "clients.activity");
  push("zone", record.zone, "clients.geographic_area");
  for (const service of record.services) push("service", service, "services");
  push("company", record.activitySummary, "client_media_profiles.activity_summary");
  push("tone", record.communicationGuidelines, "client_media_profiles.communication_guidelines");
  push("tone", record.editorialBrief, "publication_client_settings.editorial_brief");
  for (const rule of record.editorialRules) push("tone", rule, "publication_agent_projects.editorial_rules");
  const seen = new Set<string>();
  return out.filter((fact) => {
    const key = `${fact.kind}:${factFingerprint(fact.statement)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Faits distribuables : confirmés, non expirés, dans les catégories de l'agent. */
export function factsForAgent(facts: readonly ClientFact[], agent: string, today: string): ClientFact[] {
  const kinds = agentFactKinds[agent] ?? WITHOUT_PRICING;
  return facts.filter((f) => f.status === "confirmed" && (!f.validUntil || f.validUntil >= today) && kinds.includes(f.kind));
}

export type ClientBrief = {
  /** Faits autorisés (texte cité par l'agent et référence du contrôle anti-invention). */
  facts: string[];
  /** Ce que le client ne veut jamais voir écrit. */
  exclusions: string[];
  /**
   * Faits autorisés prêts à joindre au contexte d'un agent, une ligne par fait. Les exclusions n'y figurent jamais :
   * ce texte sert aussi de référence au contrôle anti-invention, un terme interdit n'y deviendrait pas « autorisé ».
   */
  text: string;
};

export function clientBrief(facts: readonly ClientFact[], agent: string, today: string): ClientBrief {
  const usable = factsForAgent(facts, agent, today);
  const exclusions = usable.filter((f) => f.kind === "exclusion").map((f) => f.statement);
  const allowed = usable.filter((f) => f.kind !== "exclusion");
  const order = new Map(FACT_KINDS.map((k, i) => [k, i]));
  allowed.sort((a, b) => (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0));
  const text = allowed.map((f) => `${factKindLabels[f.kind]} : ${f.statement}`).join("\n").slice(0, 8000);
  return { facts: allowed.map((f) => f.statement), exclusions, text };
}

/** Synchronisation fiche client → mémoire : faits à créer et faits issus d'un champ qui ont disparu (à archiver). */
export function recordSyncPlan(derived: readonly DerivedFact[], existing: readonly ClientFact[]) {
  const key = (kind: string, statement: string) => `${kind}:${factFingerprint(statement)}`;
  const present = new Set(existing.map((f) => key(f.kind, f.statement)));
  const wanted = new Set(derived.map((f) => key(f.kind, f.statement)));
  return {
    create: derived.filter((f) => !present.has(key(f.kind, f.statement))),
    archive: existing.filter((f) => f.source === "client_record" && f.status === "confirmed" && !wanted.has(key(f.kind, f.statement))).map((f) => f.id),
    // Champ de nouveau renseigné : le fait archivé par une synchronisation revient (un rejet de l'administrateur reste).
    restore: existing.filter((f) => f.source === "client_record" && f.status === "archived" && wanted.has(key(f.kind, f.statement))).map((f) => f.id),
  };
}
