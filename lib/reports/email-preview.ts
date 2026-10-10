import { createHash } from "node:crypto";
import { z } from "zod";
const line = z.string().max(10000);
const contentSchema = z.object({ summary: z.string().max(4000), highlights: z.array(line).max(100).optional(), sections: z.array(z.object({ title: line, lines: z.array(line).max(200) }).strict()).max(50), empty: z.boolean().optional() }).strict();
export { recipientSchema } from "./recipient";
/** Whitelist client content, plain text only. Never inspect internal_content. */
export function reportEmailPreview(report: { title: string; version: number; client_content: unknown }) {
  const content = contentSchema.parse(report.client_content);
  if (!report.title || report.title.length > 200 || /[\r\n\x00]/.test(report.title)) throw new Error("Invalid email subject");
  const text = [content.summary, ...content.sections.flatMap((section) => ["", section.title, ...section.lines.map((value) => `• ${value}`)])].join("\n");
  if (!text.trim() || text.length > 100000) throw new Error("Invalid email body");
  return { subject: report.title, text, version: report.version, digest: createHash("sha256").update(JSON.stringify([report.title, report.version, report.client_content])).digest("hex") };
}
