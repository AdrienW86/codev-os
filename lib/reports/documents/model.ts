// Rapports complets : un document par agent (Google Ads, référencement, site web, réseaux sociaux), chacun rendu
// en un PDF avec chiffres clés, graphiques et tableaux. Contenu client uniquement, texte brut, bornes strictes :
// le PDF et l'e-mail ne rendent que ce schéma (jamais internal_content).
import { z } from "zod";

export const reportDocumentKeys = ["google_ads", "search", "site", "social"] as const;
export type ReportDocumentKey = (typeof reportDocumentKeys)[number];
export const reportDocumentLabels: Record<ReportDocumentKey, string> = {
  google_ads: "Google Ads", search: "Référencement Google", site: "Site web", social: "Réseaux sociaux",
};

const short = (max: number) => z.string().max(max);
const kpiSchema = z.object({
  label: short(60), value: short(40),
  /** Variation affichée telle quelle (« +12 % », « −3 pt »), jamais recalculée par le rendu. */
  change: short(40).optional(),
  /** Sens de la variation et appréciation : une baisse du coût par conversion est une bonne nouvelle. */
  trend: z.enum(["up", "down", "flat"]).optional(), good: z.boolean().optional(),
}).strict();
const chartSchema = z.object({
  type: z.enum(["line", "bar"]), title: short(120), unit: short(12).optional(),
  labels: z.array(short(24)).min(1).max(62),
  series: z.array(z.object({ name: short(40), values: z.array(z.number().finite().nullable()).max(62) }).strict()).min(1).max(3),
}).strict().refine((chart) => chart.series.every((serie) => serie.values.length === chart.labels.length), "Série et libellés de longueurs différentes");
const tableSchema = z.object({
  title: short(120), columns: z.array(short(40)).min(1).max(5),
  rows: z.array(z.array(short(160)).min(1).max(5)).max(60),
}).strict().refine((table) => table.rows.every((row) => row.length === table.columns.length), "Ligne et colonnes de longueurs différentes");

export const reportDocumentSchema = z.object({
  key: z.enum(reportDocumentKeys), title: short(120), summary: short(1500),
  kpis: z.array(kpiSchema).max(8), charts: z.array(chartSchema).max(4), tables: z.array(tableSchema).max(6), notes: z.array(short(400)).max(10),
}).strict();
export type ReportDocument = z.infer<typeof reportDocumentSchema>;
export type ReportKpi = z.infer<typeof kpiSchema>;
export type ReportChart = z.infer<typeof chartSchema>;
export type ReportTable = z.infer<typeof tableSchema>;
export const reportDocumentsSchema = z.array(reportDocumentSchema).max(reportDocumentKeys.length)
  .refine((documents) => new Set(documents.map((document) => document.key)).size === documents.length, "Document en double");

/** Documents d'un contenu client (absents des rapports antérieurs : tableau vide). */
export function clientDocuments(content: unknown): ReportDocument[] {
  const raw = content && typeof content === "object" && !Array.isArray(content) ? (content as { documents?: unknown }).documents : undefined;
  if (raw === undefined) return [];
  return reportDocumentsSchema.parse(raw);
}
