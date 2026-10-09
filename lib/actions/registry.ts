// Types d'actions préparées par les agents. Une action est un payload gelé à l'approbation
// (hash vérifié en base) ; son exécution dépend de son mode :
//  - internal : exécutée par CODE-V OS (effet interne uniquement) ;
//  - manual   : réalisée par un humain hors de CODE-V OS, puis marquée « réalisée ».
// Aucun mode « external » n'est activé en V1 : pas de mutation Ads, site, réseau social ou e-mail.
import { z } from "zod";
import type { CapabilityId } from "@/lib/agents/registry";

export type ActionExecutionMode = "internal" | "manual";

export type ActionTypeDefinition = {
  id: string;
  label: string;
  capability: CapabilityId | null;
  executionMode: ActionExecutionMode;
  parameters: z.ZodType<Record<string, unknown>>;
  /** Phrase lisible pour la validation humaine. */
  describe: (parameters: Record<string, unknown>) => string;
};

const text = (max: number) => z.string().trim().min(1).max(max);
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

export const actionTypes: Record<string, ActionTypeDefinition> = {
  "internal.test": {
    id: "internal.test", label: "Vérification interne", capability: null, executionMode: "internal",
    parameters: strict({}), describe: () => "Vérification interne sans effet externe.",
  },
  "seo.site_change": {
    id: "seo.site_change", label: "Modification du site proposée", capability: "modify_site", executionMode: "manual",
    parameters: strict({ page: text(300), change: text(2000), rationale: text(2000).optional() }),
    describe: (p) => `Modifier « ${p.page} » : ${p.change}`,
  },
  "ads.optimization": {
    id: "ads.optimization", label: "Optimisation Google Ads proposée", capability: "modify_campaign", executionMode: "manual",
    parameters: strict({ campaign: text(300), change: text(2000), expected_effect: text(500).optional() }),
    describe: (p) => `Campagne « ${p.campaign} » : ${p.change}`,
  },
  "monitoring.fix": {
    id: "monitoring.fix", label: "Correction technique proposée", capability: "apply_fix", executionMode: "manual",
    parameters: strict({ target: text(300), fix: text(2000), rollback: text(1000).optional() }),
    describe: (p) => `${p.target} : ${p.fix}`,
  },
  "report.send": {
    id: "report.send", label: "Envoi du rapport", capability: "send_report", executionMode: "manual",
    parameters: strict({ report_id: z.uuid(), recipient: z.email().max(320), version: z.number().int().min(1) }),
    describe: (p) => `Envoyer la version ${p.version} du rapport à ${p.recipient}`,
  },
};

export function getActionType(id: string) {
  return Object.hasOwn(actionTypes, id) ? actionTypes[id] : null;
}

/** Valide un payload ; `null` si le type est inconnu ou le payload invalide (rien d'autre n'est accepté). */
export function parseActionParameters(type: string, parameters: unknown): Record<string, unknown> | null {
  const definition = getActionType(type);
  if (!definition) return null;
  const parsed = definition.parameters.safeParse(parameters);
  return parsed.success ? parsed.data : null;
}

export function describeAction(type: string, parameters: unknown) {
  const definition = getActionType(type);
  const parsed = parseActionParameters(type, parameters);
  return definition && parsed ? definition.describe(parsed) : "Action non reconnue.";
}
