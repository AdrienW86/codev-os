// Registre des outils de l'assistant (pur, testable). Chaque outil déclare :
//  - son schéma d'entrée (zod, strict) — l'unique porte d'entrée des paramètres du modèle ;
//  - son type : « read » (exécuté directement) ou « write » (proposé, exécuté seulement après
//    confirmation explicite de l'administrateur dans une requête distincte) ;
//  - la capacité d'agent requise, vérifiée par le moteur de permissions.
// Aucun outil n'offre de shell, de fichier, d'URL arbitraire ni d'accès aux identifiants.
import { z } from "zod";
import type { CapabilityId, RunType } from "@/lib/agents/registry";

const clientName = z.string().trim().min(1).max(120);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const toolDefinitions = {
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
  generate_report: {
    kind: "write", description: "Génère (ou régénère) le rapport hebdomadaire ou mensuel de la période close d’un client, à relire avant tout envoi.",
    input: z.object({ client: clientName, kind: z.enum(["weekly", "monthly"]).default("weekly") }).strict(), capability: "generate_report" as CapabilityId,
  },
  run_check: {
    kind: "write", description: "Lance maintenant une analyse d’agent : contrôle des sites, analyse SEO, veille Google Ads (lecture seule) ou veille tech.",
    input: z.object({ check: z.enum(["monitoring.check_sites", "seo.analyze", "ads.monitor", "news.fetch"]), client: clientName.optional() }).strict(), capability: null,
  },
  create_task: {
    kind: "write", description: "Crée une tâche pour un client.",
    input: z.object({ client: clientName, title: z.string().trim().min(2).max(200), due_date: date.optional(), priority: z.enum(["Haute", "Moyenne", "Basse"]).default("Moyenne") }).strict(), capability: null,
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
  if (name === "generate_report") return `Générer le rapport ${input.kind === "monthly" ? "mensuel" : "hebdomadaire"} de ${input.client} (à relire avant envoi).`;
  if (name === "run_check") return `Lancer ${checkLabels[String(input.check)] ?? "l’analyse"}${input.client ? ` pour ${input.client}` : ""}.`;
  if (name === "create_task") return `Créer la tâche « ${input.title} » pour ${input.client}${input.due_date ? `, échéance ${input.due_date}` : ""}, priorité ${String(input.priority ?? "Moyenne").toLowerCase()}.`;
  return toolDefinitions[name].description;
}

export const runCheckType = (check: unknown): RunType | null => (typeof check === "string" && check in checkLabels ? (check as RunType) : null);
