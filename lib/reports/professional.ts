// Périmètre explicite et construction déterministe des rapports personnalisés.
// Module pur partagé avec le formulaire : aucun accès réseau, stockage ou secret.
import { z } from "zod";
import type { ReportContent, ReportSection } from "./build";

export const professionalFamilyLabels = {
  global: "Rapport global", ads: "Rapport Google Ads", seo: "Rapport SEO",
  website: "Rapport du site web", activity: "Rapport d’activité",
} as const;
export const professionalSourceLabels = {
  google_ads: "Google Ads", search_console: "Google Search Console",
  website: "Site web et Vercel Analytics", activity: "Activité CODE-V OS",
} as const;
export type ProfessionalReportFamily = keyof typeof professionalFamilyLabels;
export type ProfessionalReportSource = keyof typeof professionalSourceLabels;
export type ProfessionalSourceState = "available" | "partial" | "unavailable" | "not_connected";
export type ProfessionalSourceResult = {
  source: ProfessionalReportSource;
  state: ProfessionalSourceState;
  /** Résultats partageables ; une donnée manquante est décrite, jamais remplacée par zéro. */
  lines: string[];
  /** Preuves non sensibles : période, propriété/projet/compte et fraîcheur. */
  evidence: string[];
  internalLines?: string[];
  internalSections?: ReportSection[];
  clientSections?: ReportSection[];
};

const validDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const date = z.string().refine(validDay, "Date réelle au format AAAA-MM-JJ requise.");
const dedicatedSource: Record<Exclude<ProfessionalReportFamily, "global">, ProfessionalReportSource> = {
  ads: "google_ads", seo: "search_console", website: "website", activity: "activity",
};

export const professionalReportSchema = z.object({
  clientId: z.uuid(), requestId: z.uuid(),
  family: z.enum(["global", "ads", "seo", "website", "activity"]),
  sources: z.array(z.enum(["google_ads", "search_console", "website", "activity"])).min(1).max(4),
  start: date, end: date,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.sources).size !== value.sources.length) ctx.addIssue({ code: "custom", path: ["sources"], message: "Chaque source ne peut être sélectionnée qu’une fois." });
  if (value.family !== "global" && (value.sources.length !== 1 || value.sources[0] !== dedicatedSource[value.family])) {
    ctx.addIssue({ code: "custom", path: ["sources"], message: "La source doit correspondre à la famille du rapport." });
  }
  if (validDay(value.start) && validDay(value.end)) {
    const days = (Date.parse(`${value.end}T00:00:00Z`) - Date.parse(`${value.start}T00:00:00Z`)) / 86_400_000 + 1;
    if (days < 1 || days > 366) ctx.addIssue({ code: "custom", path: ["end"], message: "Choisissez une période de 1 à 366 jours, dans l’ordre chronologique." });
  }
});
export type ProfessionalReportRequest = z.infer<typeof professionalReportSchema>;

export const professionalSourceStateLabels: Record<ProfessionalSourceState, string> = {
  available: "Disponible", partial: "Partiel", unavailable: "Indisponible", not_connected: "Non connecté",
};

/** Les seules sources affichées sont celles du périmètre validé, dans l’ordre choisi. */
export function buildProfessionalReport(input: ProfessionalReportRequest, clientName: string, sources: ProfessionalSourceResult[]): {
  title: string; internal: ReportContent; client: ReportContent;
} {
  const request = professionalReportSchema.parse(input);
  const selected = request.sources.map(source => sources.find(row => row.source === source) ?? {
    source, state: "unavailable" as const, lines: ["Cette source n’a pas pu être collectée ; aucun chiffre n’a été extrapolé."], evidence: [],
  });
  const available = selected.filter(row => row.state === "available" || row.state === "partial");
  const period = request.start === request.end ? `le ${request.start}` : `du ${request.start} au ${request.end}`;
  const summary = `${clientName} — ${professionalFamilyLabels[request.family]} ${period}. ${available.length} source${available.length > 1 ? "s" : ""} exploitable${available.length > 1 ? "s" : ""} sur ${selected.length}.${selected.some(row => row.state !== "available") ? " Les limites de collecte sont précisées dans chaque section." : ""}`;
  const provenance: ReportSection = { title: "Périmètre et sources", lines: [
    `Client : ${clientName}. Période demandée : ${request.start} → ${request.end}.`,
    ...selected.map(row => `${professionalSourceLabels[row.source]} : ${professionalSourceStateLabels[row.state]}.`),
  ] };
  const sections = (internal: boolean): ReportSection[] => [provenance, ...selected.flatMap(row => [
    { title: `${professionalSourceLabels[row.source]} · ${professionalSourceStateLabels[row.state]}`, lines: [...row.lines, ...row.evidence, ...(internal ? row.internalLines ?? [] : [])] },
    ...(internal ? row.internalSections ?? row.clientSections ?? [] : row.clientSections ?? []),
  ]).filter(section => section.lines.length > 0)];
  // Reconstruit volontairement les quatre champs du contrat ReportContent : le PDF client et
  // l’aperçu e-mail n’obtiennent jamais les champs techniques ou le contenu interne du collecteur.
  const content = (internal: boolean): ReportContent => ({
    summary, highlights: selected.map(row => `${professionalSourceLabels[row.source]} : ${professionalSourceStateLabels[row.state]}`),
    sections: sections(internal), empty: available.length === 0,
  });
  return { title: `${professionalFamilyLabels[request.family]} — ${clientName} — ${period}`.slice(0, 200), internal: content(true), client: content(false) };
}
