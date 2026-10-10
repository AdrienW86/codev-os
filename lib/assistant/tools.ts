// Registre des outils de l'assistant (pur, testable). Chaque outil déclare :
//  - son schéma d'entrée (zod, strict) — l'unique porte d'entrée des paramètres du modèle ;
//  - son type : « read » (exécuté directement) ou « write » (proposé, exécuté seulement après
//    confirmation explicite de l'administrateur dans une requête distincte) ;
//  - la capacité d'agent requise, vérifiée par le moteur de permissions.
// Aucun outil n'offre de shell, de fichier, d'URL arbitraire ni d'accès aux identifiants.
import { z } from "zod";
import type { CapabilityId, RunType } from "@/lib/agents/registry";
import { PERIOD_PRESETS, describeDates } from "@/lib/integrations/google-ads/periods";

const clientName = z.string().trim().min(1).max(120);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const adsType = z.string().regex(/^[A-Z_]{2,40}$/);
const adsStatus = z.enum(["enabled", "paused", "all"]);
/** Périmètre exact d'une écriture Google Ads côté CODE-V (rapport, analyse) — revalidé par parseScope. */
const adsScopeInput = z.object({
  client_id: z.string().uuid(), client_name: clientName.optional(), start: date, end: date, status: adsStatus,
  types: z.array(adsType).max(20), campaignIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(50),
}).strict();

export const toolDefinitions = {
  ads_campaigns: {
    kind: "read",
    description: "Campagnes Google Ads d’un client (lecture seule) : dépenses, clics, conversions par campagne, total du périmètre et total du compte. "
      + "Paramètres facultatifs : seuls ceux fournis modifient la vue courante, les autres sont conservés (suite de conversation). "
      + "period : today, yesterday, last_7, last_14, last_30, last_90, this_week, last_week, this_month, last_month, day (avec date), custom (avec start et end). "
      + "status : enabled (actives), paused (en pause), all. types : types API (SEARCH, LOCAL_SERVICES, PERFORMANCE_MAX, DISPLAY…), [] pour tous. "
      + "campaigns : noms ou identifiants de campagnes ([] pour toutes). compare : comparer à la période précédente.",
    input: z.object({
      client: clientName.optional(), period: z.enum(PERIOD_PRESETS).optional(), date: date.optional(), start: date.optional(), end: date.optional(),
      compare: z.boolean().optional(), status: adsStatus.optional(), types: z.array(adsType).max(20).optional(), campaigns: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    }).strict(), capability: null,
  },
  get_priorities: {
    kind: "read", description: "Résumé des urgences : actions à valider, incidents ouverts, tâches en retard ou du jour, rapports à relire.",
    input: z.object({}).strict(), capability: null,
  },
  client_overview: {
    kind: "read", description: "Vue d’ensemble d’un client (services, tâches ouvertes, incidents, dernier rapport) à partir de son nom.",
    input: z.object({ client: clientName }).strict(), capability: null,
  },
  agenda_today: {
    kind: "read", description: "Programme du jour : tâches à échéance et éléments d’agenda.",
    input: z.object({ date: date.optional() }).strict(), capability: null,
  },
  list_reports: {
    kind: "read", description: "Rapports récents et leur statut (à relire, approuvé, envoyé).",
    input: z.object({ client: clientName.optional() }).strict(), capability: "aggregate_activity" as CapabilityId,
  },
  list_news: {
    kind: "read", description: "Les 3 actualités tech & IA les plus pertinentes de la veille.",
    input: z.object({}).strict(), capability: "fetch_news" as CapabilityId,
  },
  list_pending_actions: {
    kind: "read", description: "Actions préparées par les agents qui attendent votre validation.",
    input: z.object({}).strict(), capability: null,
  },
  clients_attention: {
    kind: "read", description: "Clients qui nécessitent votre attention (incidents ouverts, tâches en retard, actions à valider).",
    input: z.object({}).strict(), capability: null,
  },
  schedule_check: {
    kind: "write", description: "Planifie une analyse d’agent à une date et une heure précises (heure de Paris).",
    input: z.object({ check: z.enum(["monitoring.check_sites", "seo.analyze", "ads.monitor", "news.fetch"]), client: clientName.optional(), date, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict(), capability: null,
  },
  generate_report: {
    kind: "write", description: "Génère (ou régénère) le rapport hebdomadaire ou mensuel de la période close d’un client, à relire avant tout envoi.",
    input: z.object({ client: clientName, kind: z.enum(["weekly", "monthly"]).default("weekly") }).strict(), capability: "generate_report" as CapabilityId,
  },
  run_check: {
    kind: "write", description: "Lance maintenant une analyse d’agent : contrôle des sites, analyse SEO, veille Google Ads (lecture seule) ou veille tech.",
    input: z.object({ check: z.enum(["monitoring.check_sites", "seo.analyze", "ads.monitor", "news.fetch"]), client: clientName.optional() }).strict(), capability: null,
  },
  ads_prepare_report: {
    kind: "write", description: "Prépare un rapport Google Ads enregistré pour un périmètre exact (dates + campagnes), à relire avant tout envoi.",
    input: adsScopeInput, capability: null,
  },
  ads_run_analysis: {
    kind: "write", description: "Lance l’analyse réelle de l’Agent Ads (règles déterministes, sans IA, lecture seule) sur un périmètre exact.",
    input: adsScopeInput, capability: null,
  },
  create_task: {
    kind: "write", description: "Crée une tâche pour un client.",
    input: z.object({ client: clientName, title: z.string().trim().min(2).max(200), due_date: date.optional(), due_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), priority: z.enum(["Haute", "Moyenne", "Basse"]).default("Moyenne") }).strict(), capability: null,
  },
} as const satisfies Record<string, { kind: "read" | "write"; description: string; input: z.ZodType; capability: CapabilityId | null }>;

export type ToolName = keyof typeof toolDefinitions;
export type ToolInput<T extends ToolName> = z.output<(typeof toolDefinitions)[T]["input"]>;

export const isToolName = (value: unknown): value is ToolName => typeof value === "string" && Object.hasOwn(toolDefinitions, value);

export function parseToolInput(name: string, input: unknown): { ok: true; name: ToolName; input: Record<string, unknown> } | { ok: false; message: string } {
  if (!isToolName(name)) return { ok: false, message: "Outil inconnu." };
  const parsed = toolDefinitions[name].input.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, message: "Paramètres invalides pour cet outil." };
  return { ok: true, name, input: parsed.data as Record<string, unknown> };
}

/** Spécifications envoyées au modèle (JSON Schema dérivé des schémas zod). */
export function toolSpecs() {
  return (Object.keys(toolDefinitions) as ToolName[]).map((name) => {
    const parameters = { ...(z.toJSONSchema(toolDefinitions[name].input, { io: "input" }) as Record<string, unknown>) };
    delete parameters.$schema;
    return { name, description: toolDefinitions[name].description, parameters };
  });
}

const checkLabels: Record<string, string> = { "monitoring.check_sites": "le contrôle des sites", "seo.analyze": "l’analyse SEO", "ads.monitor": "la veille Google Ads (lecture seule)", "news.fetch": "la veille tech & IA" };

/** Phrase de confirmation présentée à l'administrateur avant toute écriture. */
export function describeProposal(name: ToolName, input: Record<string, unknown>) {
  if (name === "ads_prepare_report" || name === "ads_run_analysis") {
    const ids = Array.isArray(input.campaignIds) ? input.campaignIds.length : 0;
    const scope = `${ids} campagne${ids > 1 ? "s" : ""}, ${describeDates({ start: String(input.start), end: String(input.end), days: 0 })}`;
    return name === "ads_prepare_report"
      ? `Préparer un rapport Google Ads pour ${input.client_name ?? "ce client"} (${scope}). Il sera à relire avant tout envoi ; aucune modification Google Ads.`
      : `Lancer l’analyse réelle de l’Agent Ads pour ${input.client_name ?? "ce client"} (${scope}) : règles déterministes, sans IA, lecture seule.`;
  }
  if (name === "generate_report") return `Générer le rapport ${input.kind === "monthly" ? "mensuel" : "hebdomadaire"} de ${input.client} (à relire avant envoi).`;
  if (name === "run_check") return `Lancer ${checkLabels[String(input.check)] ?? "l’analyse"}${input.client ? ` pour ${input.client}` : ""}.`;
  if (name === "schedule_check") return `Planifier ${checkLabels[String(input.check)] ?? "l’analyse"}${input.client ? ` pour ${input.client}` : ""} le ${input.date} à ${input.time} (heure de Paris).`;
  if (name === "create_task") return `Créer la tâche « ${input.title} » pour ${input.client}${input.due_date ? `, échéance ${input.due_date}${input.due_time ? ` à ${input.due_time}` : ""}` : ""}, priorité ${String(input.priority ?? "Moyenne").toLowerCase()}.`;
  return toolDefinitions[name].description;
}

export const runCheckType = (check: unknown): RunType | null => (typeof check === "string" && check in checkLabels ? (check as RunType) : null);
