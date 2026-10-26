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
type EmailBody = { heading: string; subheading: string; paragraphs: string[]; listTitle?: string; items: string[]; sections: { title: string; lines: string[] }[]; closing: string[] };
function genericParts(kind: string | undefined, documents: { key: string }[], period: { start?: string; end?: string } = {}): EmailBody {
  const label = kind === "monthly" ? "mensuel" : kind === "weekly" ? "hebdomadaire" : "";
  const titles = documents.map((document) => documentTitles[document.key] ?? document.key);
  const when = periodText(kind, period.start, period.end);
  return {
    heading: `Votre rapport${label ? ` ${label}` : ""}`, subheading: when ? when.replace(/^(de|du) /, (m) => (m === "de " ? "" : "Du ")).replace(/^./, (c) => c.toUpperCase()) : "",
    paragraphs: ["Bonjour,", `Vous trouverez ci-joint votre rapport${label ? ` ${label}` : ""}${when ? ` ${when}` : ""}.`],
    listTitle: titles.length ? `${titles.length} document${titles.length > 1 ? "s" : ""} en pièce${titles.length > 1 ? "s" : ""} jointe${titles.length > 1 ? "s" : ""}` : undefined, items: titles, sections: [],
    closing: ["Nous restons à votre disposition pour en parler.", "Cordialement,", "L’équipe CODE-V"],
  };
}
/** Corps générique d'un rapport complet : le détail est dans les PDF joints (un par agent). */
export function genericReportEmail(kind: string | undefined, documents: { key: string }[], period: { start?: string; end?: string } = {}) {
  const parts = genericParts(kind, documents, period);
  return [parts.paragraphs[0], "", parts.paragraphs[1],
    parts.items.length ? `Il comprend ${parts.items.length} document${parts.items.length > 1 ? "s" : ""} : ${parts.items.join(", ")}.` : "",
    "", parts.closing[0], "", parts.closing[1], parts.closing[2]].filter((line, index, all) => line || all[index - 1] !== "").join("\n");
}
/** Identifiant de l'image intégrée (logo) référencée par le HTML : la pièce jointe correspondante est ajoutée à l'envoi. */
export const REPORT_EMAIL_LOGO_CID = "codev-logo";
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const font = "'Space Grotesk','DM Sans',Helvetica,Arial,sans-serif";
/** Mise en forme HTML (tableaux et styles en ligne, compatible Gmail/Outlook/Apple Mail). Tout le texte est échappé. */
export function reportEmailHtml(body: EmailBody, subject: string): string {
  const p = (text: string, extra = "") => `<p style="margin:0 0 14px;font-family:${font};font-size:15px;line-height:24px;color:#0e1c2e;${extra}">${esc(text)}</p>`;
  const item = (text: string) => `<tr><td style="padding:0 0 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;background:#f7f9fc;border:1px solid #e3eaf5;border-radius:10px"><tr>
<td width="6" style="background:#4f8cff;border-radius:10px 0 0 10px;font-size:0;line-height:0">&nbsp;</td>
<td style="padding:12px 14px;font-family:${font};font-size:15px;font-weight:600;color:#07111f">${esc(text)}</td>
<td align="right" style="padding:12px 14px;font-family:${font};font-size:12px;color:#356ee0;white-space:nowrap">PDF</td></tr></table></td></tr>`;
  const list = body.items.length ? `${body.listTitle ? `<p style="margin:8px 0 10px;font-family:${font};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#356ee0">${esc(body.listTitle)}</p>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${body.items.map(item).join("")}</table><div style="height:10px;line-height:10px">&nbsp;</div>` : "";
  const sections = body.sections.map((section) => `<p style="margin:18px 0 8px;font-family:${font};font-size:16px;font-weight:700;color:#07111f">${esc(section.title)}</p>
<ul style="margin:0 0 8px;padding-left:20px;font-family:${font};font-size:15px;line-height:24px;color:#0e1c2e">${section.lines.map((line) => `<li style="margin:0 0 4px">${esc(line)}</li>`).join("")}</ul>`).join("");
  const closing = `${p(body.closing[0] ?? "", "margin-top:8px")}${body.closing.length > 1 ? `<p style="margin:0;font-family:${font};font-size:15px;line-height:24px;color:#0e1c2e">${body.closing.slice(1).map(esc).join("<br>")}</p>` : ""}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f9fc">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(body.subheading || body.paragraphs[1] || subject)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f9fc"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3eaf5">
<tr><td align="center" style="padding:28px 24px 18px;background:#ffffff"><img src="cid:${REPORT_EMAIL_LOGO_CID}" width="96" height="96" alt="CODE-V" style="display:block;width:96px;height:96px;border:0"></td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background:#4f8cff;background-image:linear-gradient(90deg,#4f8cff,#50e3c2)">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 6px;background:#07111f">
<p style="margin:0;font-family:${font};font-size:24px;line-height:30px;font-weight:700;color:#ffffff">${esc(body.heading)}</p>
${body.subheading ? `<p style="margin:6px 0 0;font-family:${font};font-size:15px;line-height:22px;color:#50e3c2">${esc(body.subheading)}</p>` : ""}
<div style="height:22px;line-height:22px">&nbsp;</div></td></tr>
<tr><td style="padding:28px 32px 30px">${body.paragraphs.map((text) => p(text)).join("")}${list}${sections}${closing}</td></tr>
<tr><td style="padding:18px 32px;background:#07111f;font-family:${font};font-size:12px;line-height:18px;color:#9fb0c8">
<span style="color:#ffffff;font-weight:700">CODE-V</span> · Partenaire digital<br><a href="https://code-v.fr" style="color:#50e3c2;text-decoration:none">code-v.fr</a></td></tr>
</table></td></tr></table></body></html>`;
}
/** Whitelist client content, plain text only. Never inspect internal_content. */
export function reportEmailPreview(report: { title: string; version: number; client_content: unknown; kind?: string; period_start?: string; period_end?: string }) {
  const content = reportClientContentSchema.parse(report.client_content);
  if (!report.title || report.title.length > 200 || /[\r\n\x00]/.test(report.title)) throw new Error("Invalid email subject");
  const text = content.documents?.length
    ? genericReportEmail(report.kind, content.documents, { start: report.period_start, end: report.period_end })
    : [content.summary, ...content.sections.flatMap((section) => ["", section.title, ...section.lines.map((value) => `• ${value}`)])].join("\n");
  if (!text.trim() || text.length > 100000) throw new Error("Invalid email body");
  const body: EmailBody = content.documents?.length
    ? genericParts(report.kind, content.documents, { start: report.period_start, end: report.period_end })
    : { heading: report.title, subheading: "", paragraphs: content.summary ? [content.summary] : [], items: [], sections: content.sections, closing: ["Nous restons à votre disposition pour en parler.", "Cordialement,", "L’équipe CODE-V"] };
  const html = reportEmailHtml(body, report.title);
  return { subject: report.title, text, html, version: report.version, digest: createHash("sha256").update(JSON.stringify([report.title, report.version, report.client_content])).digest("hex") };
}
