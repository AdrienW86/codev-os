import { createHash } from "node:crypto";
import { z } from "zod";
import { reportDocumentsSchema } from "./documents/model";
const line = z.string().max(10000);
export const reportClientContentSchema = z.object({ summary: z.string().max(4000), highlights: z.array(line).max(100).optional(), sections: z.array(z.object({ title: line, lines: z.array(line).max(200) }).strict()).max(50), empty: z.boolean().optional(), documents: reportDocumentsSchema.optional() }).strict();
export { recipientSchema } from "./recipient";
const documentTitles: Record<string, string> = { google_ads: "Google Ads", search: "Référencement Google", site: "Site web", social: "Réseaux sociaux" };
const day = /^\d{4}-\d{2}-\d{2}$/;
function periodText(kind: string | undefined, start: string | undefined, end: string | undefined) {
  if (!start || !end || !day.test(start) || !day.test(end)) return "";
  const date = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
  return kind === "monthly" ? `de ${date(start, { month: "long", year: "numeric" })}` : `du ${date(start, { day: "numeric", month: "long" })} au ${date(end, { day: "numeric", month: "long", year: "numeric" })}`;
}
/** Corps générique d'un rapport complet : le détail est dans les PDF joints (un par agent). */
export function genericReportEmail(kind: string | undefined, documents: { key: string }[], period: { start?: string; end?: string } = {}) {
  const label = kind === "monthly" ? "mensuel" : kind === "weekly" ? "hebdomadaire" : "";
  const titles = documents.map((document) => documentTitles[document.key] ?? document.key);
  const when = periodText(kind, period.start, period.end);
  return ["Bonjour,", "", `Vous trouverez ci-joint votre rapport${label ? ` ${label}` : ""}${when ? ` ${when}` : ""}.`,
    titles.length ? `Il comprend ${titles.length} document${titles.length > 1 ? "s" : ""} : ${titles.join(", ")}.` : "",
    "", "Nous restons à votre disposition pour en parler.", "", "Cordialement,", "L’équipe CODE-V"].filter((line, index, all) => line || all[index - 1] !== "").join("\n");
}
/** Whitelist client content, plain text only. Never inspect internal_content. */
export function reportEmailPreview(report: { title: string; version: number; client_content: unknown; kind?: string; period_start?: string; period_end?: string }) {
  const content = reportClientContentSchema.parse(report.client_content);
  if (!report.title || report.title.length > 200 || /[\r\n\x00]/.test(report.title)) throw new Error("Invalid email subject");
  const text = content.documents?.length
    ? genericReportEmail(report.kind, content.documents, { start: report.period_start, end: report.period_end })
    : [content.summary, ...content.sections.flatMap((section) => ["", section.title, ...section.lines.map((value) => `• ${value}`)])].join("\n");
  if (!text.trim() || text.length > 100000) throw new Error("Invalid email body");
  return { subject: report.title, text, version: report.version, digest: createHash("sha256").update(JSON.stringify([report.title, report.version, report.client_content])).digest("hex") };
}
