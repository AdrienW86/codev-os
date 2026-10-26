import { reportClientContentSchema } from "./email-preview";

type ReportForPdf = {
  title: string;
  kind: string;
  version: number;
  status: string;
  approved_version?: number | null;
  period_start: string;
  period_end: string;
  generated_at: string | null;
  client_content: unknown;
  client?: { name: string } | null;
};

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const LEFT = 48;
export const RIGHT = 48;
export const BOTTOM = 68;
export const LINE_W = PAGE_W - LEFT - RIGHT;
export const MAX_PAGES = 45;
const MAX_BYTES = 3_500_000;
const MAX_TEXT = 200_000;
export type Font = "F1" | "F2";

const winAnsi: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86,
  "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
// Standard Helvetica advance widths, WinAnsi codes 32..255, in 1/1000 em.
// Wrapping must measure the actual font: a row of W's is wider than a row of i's.
const widths: Record<Font, number[]> = {
  F1: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],
  F2: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556],
};

export function clean(value: string): string {
  // Normalize decomposed French accents and remove invisible formatting/bidi controls.
  return value.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/−/g, "-").replace(/→/g, "->").replace(/←/g, "<-")
    .replace(/✓|✔/g, "•").replace(/≤/g, "<=").replace(/≥/g, ">=")
    .replace(/\s+/g, " ").trim();
}

function encoded(value: string): number[] {
  return Array.from(clean(value), (char) => {
    const code = char.codePointAt(0) ?? 32;
    return code >= 32 && code <= 126 || code >= 160 && code <= 255 ? code : winAnsi[char] ?? 63;
  });
}
/** Hex strings prevent any content from becoming PDF operators, links or scripts. */
export function hexText(value: string): string {
  return "<" + encoded(value).map((byte) => byte.toString(16).padStart(2, "0")).join("") + ">";
}
export function textWidth(value: string, size: number, font: Font): number {
  return encoded(value).reduce((sum, byte) => sum + widths[font][byte - 32], 0) * size / 1000;
}
export function fold(value: string, maxWidth: number, size: number, font: Font = "F1"): string[] {
  const words = clean(value).split(" ").filter(Boolean);
  const result: string[] = [];
  let current = "";
  let currentWidth = 0;
  const spaceWidth = textWidth(" ", size, font) || widths[font][0] * size / 1000;
  for (const original of words) {
    const wordWidth = textWidth(original, size, font);
    if (current && currentWidth + spaceWidth + wordWidth <= maxWidth) {
      current += " " + original;
      currentWidth += spaceWidth + wordWidth;
      continue;
    }
    if (current) { result.push(current); current = ""; }
    // Split long unbroken URLs, labels and IDs without dropping any character.
    let part = "";
    let partWidth = 0;
    for (const char of original) {
      const charWidth = textWidth(char, size, font);
      if (part && partWidth + charWidth > maxWidth) { result.push(part); part = ""; partWidth = 0; }
      part += char;
      partWidth += charWidth;
    }
    current = part;
    currentWidth = partWidth;
  }
  if (current) result.push(current);
  return result.length ? result : [""];
}
export function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z"))
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
export const frDay = (date: string) => validDay(date)
  ? date.slice(8, 10) + "/" + date.slice(5, 7) + "/" + date.slice(0, 4) : "Date non renseignée";
export const escapeFile = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45);

export function clientReportPdfFilename(report: Pick<ReportForPdf, "client" | "kind" | "version" | "period_start">): string {
  const client = escapeFile(report.client?.name ?? "client") || "client";
  const kind = ["weekly", "monthly", "google_ads", "custom"].includes(report.kind) ? report.kind.replace("_", "-") : "rapport";
  const period = validDay(report.period_start) ? report.period_start : "periode";
  const version = Number.isInteger(report.version) && report.version >= 1 && report.version <= 1_000_000 ? report.version : "inconnue";
  return "code-v-" + client + "-" + kind + "-" + period + "-v" + version + ".pdf";
}

/** A4, multi-page, server-rendered. Only allowlisted client_content is ever rendered. */
export function renderClientReportPdf(report: ReportForPdf): Buffer {
  if (!Number.isInteger(report.version) || report.version < 1 || report.version > 1_000_000) throw new Error("PDF version invalide");
  const content = reportClientContentSchema.parse(report.client_content);
  if (report.title.length > 200 || (report.client?.name.length ?? 0) > 200) throw new Error("PDF titre invalide");
  const title = clean(report.title);
  const client = clean(report.client?.name ?? "Client");
  if (!title || title.length > 200 || !client || client.length > 200) throw new Error("PDF titre invalide");
  const charCount = content.summary.length + (content.highlights ?? []).reduce((sum, s) => sum + s.length, 0)
    + content.sections.reduce((sum, s) => sum + s.title.length + s.lines.reduce((total, l) => total + l.length, 0), 0);
  if (charCount > MAX_TEXT) throw new Error("PDF trop volumineux");
  const period = frDay(report.period_start) + " au " + frDay(report.period_end);
  const finalized = report.approved_version === report.version && ["approved", "sent", "archived"].includes(report.status);
  const pages: string[][] = [];
  let commands: string[] = [];
  let y = 0;
  const text = (value: string, x: number, yy: number, size: number, font: Font = "F1", rgb = "0.14 0.18 0.24") => {
    commands.push(rgb + " rg BT /" + font + " " + size + " Tf 1 0 0 1 " + x.toFixed(2) + " " + yy.toFixed(2) + " Tm " + hexText(value) + " Tj ET");
  };
  const line = (yy: number) => commands.push("0.83 0.86 0.88 RG 0.6 w " + LEFT + " " + yy.toFixed(2) + " m " + (PAGE_W - RIGHT) + " " + yy.toFixed(2) + " l S");
  const rect = (x: number, yy: number, w: number, h: number, rgb: string) => commands.push(rgb + " rg " + x.toFixed(2) + " " + yy.toFixed(2) + " " + w.toFixed(2) + " " + h.toFixed(2) + " re f");
  const nextPage = () => {
    // Count the current page too; never emit a 46th page or silently truncate.
    if (pages.length + (commands.length ? 1 : 0) >= MAX_PAGES) throw new Error("PDF trop long");
    if (commands.length) pages.push(commands);
    commands = [];
    const clientLines = fold(client, LINE_W - 54, 9.5);
    const headerHeight = 53 + clientLines.length * 13 + (finalized ? 0 : 22);
    const bottom = PAGE_H - headerHeight;
    rect(0, bottom, PAGE_W, headerHeight, "0.035 0.065 0.11");
    rect(0, bottom, PAGE_W, 3, "0.14 0.49 1");
    // Existing CODE-V bracket/V mark from scripts/pwa-icons.mjs, as print-safe vectors.
    commands.push("q 0.085 0 0 -0.085 " + (LEFT - 9) + " " + (PAGE_H - 4) + " cm 0.14 0.49 1 rg 136 160 m 208 160 l 208 208 l 184 208 l 184 304 l 208 304 l 208 352 l 136 352 l h 304 160 m 376 160 l 376 352 l 304 352 l 304 304 l 328 304 l 328 208 l 304 208 l h f 0.14 0.49 1 RG 22 w 1 J 1 j 214 224 m 256 288 l 298 224 l S Q");
    text("CODE-V  /  RAPPORT CLIENT", LEFT + 37, PAGE_H - 26, 12, "F2", "1 1 1");
    clientLines.forEach((row, i) => text(row, LEFT + 37, PAGE_H - 46 - i * 13, 9.5, "F1", "0.85 0.89 0.94"));
    if (!finalized) text("BROUILLON - NON APPROUVÉ - NE PAS TRANSMETTRE", LEFT, bottom + 12, 8.2, "F2", "1 0.78 0.58");
    y = bottom - 30;
  };
  const ensure = (height: number) => { if (y - height < BOTTOM) nextPage(); };
  const paragraph = (value: string, size = 10.5, leading = 16, indent = 0, font: Font = "F1") => {
    for (const row of fold(value, LINE_W - indent, size, font)) {
      ensure(leading + 2);
      text(row, LEFT + indent, y, size, font);
      y -= leading;
    }
  };
  const heading = (value: string, following = 25) => {
    const rows = fold(value, LINE_W, 11, "F2");
    ensure(Math.min(rows.length * 16 + 8 + following, 180));
    for (const row of rows) {
      ensure(32);
      text(row, LEFT, y, 11, "F2", "0.10 0.32 0.64");
      y -= 16;
    }
    y -= 8;
  };
  const bullet = (value: string, size = 10.5) => {
    if (!clean(value)) return;
    ensure(20);
    text("•", LEFT + 2, y, size, "F1", "0.14 0.49 1");
    paragraph(value, size, 16, 15);
    y -= 5;
  };
  const table = (rows: { label: string; value: string }[], sectionTitle: string) => {
    const valueX = LEFT + 264;
    const header = () => {
      rect(LEFT, y - 8, LINE_W, 25, "0.93 0.96 0.99");
      text("INDICATEUR", LEFT + 10, y, 8, "F2", "0.30 0.39 0.51");
      text("RÉSULTAT", valueX + 10, y, 8, "F2", "0.30 0.39 0.51");
      y -= 29;
    };
    header();
    for (const row of rows) {
      const labels = fold(row.label, 244, 10);
      const values = fold(row.value, LINE_W - 284, 10, "F2");
      const height = Math.max(labels.length, values.length) * 15 + 12;
      if (y - height < BOTTOM) { nextPage(); heading(sectionTitle + " (suite)", height + 29); header(); }
      labels.forEach((part, i) => text(part, LEFT + 10, y - i * 15, 10));
      values.forEach((part, i) => text(part, valueX + 10, y - i * 15, 10, "F2"));
      y -= height;
      line(y + 10);
    }
  };

  nextPage();
  paragraph(title, 19, 25, 0, "F2");
  y -= 6;
  paragraph("Période : " + period + "  |  Version " + report.version, 9, 14);
  if (report.generated_at && !Number.isNaN(Date.parse(report.generated_at))) {
    paragraph("Généré le " + new Date(report.generated_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }), 9, 14);
  }
  y -= 13;
  line(y); y -= 25;

  let hasContent = false;
  if (clean(content.summary)) {
    hasContent = true;
    heading("SYNTHÈSE");
    paragraph(content.summary);
    y -= 20;
  }
  const highlights = (content.highlights ?? []).filter((item) => clean(item));
  if (highlights.length) {
    hasContent = true;
    heading("POINTS CLÉS");
    highlights.forEach((item) => bullet(item));
    y -= 12;
  }
  for (const section of content.sections) {
    const lines = section.lines.filter((item) => clean(item));
    if (!lines.length) continue;
    hasContent = true;
    const sectionTitle = clean(section.title) || "RÉSULTATS";
    // Only existing, short label/value facts become a table. No metric is inferred.
    const facts = lines.map((item) => clean(item).match(/^([^:]{1,90})\s*:\s*(.{1,90})$/u));
    if (facts.length >= 2 && facts.every(Boolean)) {
      const rows = facts.map((fact) => ({ label: fact![1].trim(), value: fact![2].trim() }));
      const firstHeight = Math.max(fold(rows[0].label, 244, 10).length, fold(rows[0].value, LINE_W - 284, 10, "F2").length) * 15 + 12;
      heading(sectionTitle, firstHeight + 29);
      table(rows, sectionTitle);
    } else {
      heading(sectionTitle);
      lines.forEach((item) => bullet(item, 10));
    }
    y -= 16;
  }
  if (!hasContent) paragraph("Aucune donnée client disponible sur la période.");

  pages.push(commands);
  for (let i = 0; i < pages.length; i++) {
    const cmds = pages[i];
    const footer = "CODE-V | Document client | Version " + report.version + " | Page " + (i + 1) + "/" + pages.length;
    cmds.push("0.83 0.86 0.88 RG 0.6 w " + LEFT + " 51 m " + (PAGE_W - RIGHT) + " 51 l S");
    cmds.push("0.43 0.47 0.53 rg BT /F1 8 Tf 1 0 0 1 " + LEFT + " 36 Tm " + hexText(footer) + " Tj ET");
  }

  return assemblePdf(pages, title);
}

/** Standalone PDF, byte-correct xref, no external resource or active content (Helvetica F1 / Helvetica-Bold F2). */
export function assemblePdf(pages: string[][], title: string): Buffer {
  const total = 5 + pages.length * 2;
  const objects = new Map<number, Buffer>();
  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R /Lang (fr-FR) >>", "ascii"));
  const kids = pages.map((_, i) => String(5 + i * 2) + " 0 R").join(" ");
  objects.set(2, Buffer.from("<< /Type /Pages /Count " + pages.length + " /Kids [ " + kids + " ] >>", "ascii"));
  objects.set(3, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii"));
  objects.set(4, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>", "ascii"));
  pages.forEach((page, i) => {
    const pageId = 5 + i * 2, streamId = pageId + 1;
    const stream = Buffer.from(page.join("\n") + "\n", "ascii");
    objects.set(pageId, Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 " + PAGE_W + " " + PAGE_H + " ] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + streamId + " 0 R >>", "ascii"));
    objects.set(streamId, Buffer.concat([Buffer.from("<< /Length " + stream.length + " >>\nstream\n", "ascii"), stream, Buffer.from("endstream", "ascii")]));
  });
  objects.set(total, Buffer.from("<< /Title " + hexText(title) + " /Author (CODE-V) /Creator (CODE-V OS) >>", "ascii"));
  const buffers: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let length = buffers[0].length;
  const offsets = [0];
  for (let id = 1; id <= total; id++) {
    offsets[id] = length;
    const parts = [Buffer.from(id + " 0 obj\n", "ascii"), objects.get(id)!, Buffer.from("\nendobj\n", "ascii")];
    buffers.push(...parts);
    length += parts.reduce((sum, part) => sum + part.length, 0);
  }
  const xrefPos = length;
  const xref = ["xref", "0 " + (total + 1), "0000000000 65535 f "];
  for (let id = 1; id <= total; id++) xref.push(String(offsets[id]).padStart(10, "0") + " 00000 n ");
  buffers.push(Buffer.from(xref.join("\n") + "\ntrailer\n<< /Size " + (total + 1) + " /Root 1 0 R /Info " + total + " 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF\n", "ascii"));
  const output = Buffer.concat(buffers);
  if (output.length > MAX_BYTES) throw new Error("PDF trop volumineux");
  return output;
}
