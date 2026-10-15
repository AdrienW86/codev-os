import { reportClientContentSchema } from "./email-preview";

type ReportForPdf = {
  title: string;
  kind: string;
  version: number;
  status: string;
  period_start: string;
  period_end: string;
  generated_at: string | null;
  client_content: unknown;
  client?: { name: string } | null;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const LEFT = 48;
const RIGHT = 48;
const BOTTOM = 68;
const LINE_W = PAGE_W - LEFT - RIGHT;
const MAX_PAGES = 45;
const MAX_BYTES = 3_500_000;

const winAnsi: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86,
  "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
  "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
function clean(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
/** PDF built-in Helvetica font with explicit WinAnsiEncoding for French accents. */
function hexText(value: string): string {
  const out: string[] = [];
  for (const char of clean(value)) {
    const code = char.codePointAt(0) ?? 32;
    const byte = code >= 32 && code <= 126 || code >= 160 && code <= 255
      ? code : winAnsi[char] ?? 63;
    out.push(byte.toString(16).padStart(2, "0"));
  }
  return "<" + out.join("") + ">";
}
function fold(value: string, max = 95): string[] {
  const words = clean(value).split(" ");
  const result: string[] = [];
  let current = "";
  for (const original of words) {
    if (!original) continue;
    let word = original;
    while (word.length > max) {
      if (current) { result.push(current); current = ""; }
      result.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!word) continue;
    if ((current ? current.length + 1 : 0) + word.length > max) {
      result.push(current);
      current = word;
    } else current += (current ? " " : "") + word;
  }
  if (current) result.push(current);
  return result.length ? result : [""];
}
const n2 = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ?
  date.slice(8, 10) + "/" + date.slice(5, 7) + "/" + date.slice(0, 4) : "Date non renseignée";
const escapeFile = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 45);

export function clientReportPdfFilename(report: Pick<ReportForPdf, "client" | "kind" | "version" | "period_start">): string {
  const client = escapeFile(report.client?.name ?? "client") || "client";
  const kind = ["weekly", "monthly", "google_ads"].includes(report.kind) ? report.kind.replace("_", "-") : "rapport";
  const period = /^\d{4}-\d{2}-\d{2}$/.test(report.period_start) ? report.period_start : "periode";
  return "code-v-" + client + "-" + kind + "-" + period + "-v" + report.version + ".pdf";
}

/** A4, multi-page, server-rendered. Only allowlisted client_content is ever rendered. */
export function renderClientReportPdf(report: ReportForPdf): Buffer {
  if (!Number.isInteger(report.version) || report.version < 1 || report.version > 1_000_000) throw new Error("PDF version invalide");
  const content = reportClientContentSchema.parse(report.client_content);
  const title = clean(report.title);
  const client = clean(report.client?.name ?? "Client");
  if (!title || title.length > 200 || client.length > 200) throw new Error("PDF titre invalide");
  const period = n2(report.period_start) + " au " + n2(report.period_end);
  const finalized = ["approved", "sent", "archived"].includes(report.status);
  const pages: string[][] = [];
  let commands: string[] = [];
  let y = 0;
  const text = (value: string, x: number, yy: number, size: number, font = "F1", rgb = "0.14 0.18 0.24") => {
    commands.push(rgb + " rg BT /" + font + " " + size + " Tf 1 0 0 1 " + x.toFixed(2) + " " + yy.toFixed(2) + " Tm " + hexText(value) + " Tj ET");
  };
  const line = (yy: number) => commands.push("0.83 0.86 0.88 RG 0.6 w " + LEFT + " " + yy.toFixed(2) + " m " + (PAGE_W - RIGHT) + " " + yy.toFixed(2) + " l S");
  const nextPage = () => {
    if (pages.length >= MAX_PAGES) throw new Error("PDF trop long");
    if (commands.length) pages.push(commands);
    commands = [];
    commands.push("0.10 0.16 0.23 rg 0 756 " + PAGE_W.toFixed(2) + " " + (PAGE_H - 756).toFixed(2) + " re f");
    text("CODE-V  /  RAPPORT CLIENT", LEFT, 804, 13, "F2", "1 1 1");
    text(client.slice(0, 75), LEFT, 783, 10, "F1", "0.85 0.89 0.94");
    if (!finalized) text("BROUILLON - NON APPROUVÉ - NE PAS TRANSMETTRE", LEFT, 760, 8.2, "F2", "1 0.74 0.54");
    y = 723;
  };
  const ensure = (height: number) => { if (y - height < BOTTOM) nextPage(); };
  const paragraph = (value: string, size = 10.5, leading = 16, indent = 0, font = "F1") => {
    // Conservative Helvetica wrapping: protects the right margin for capitals and accents.
    const approxChars = Math.max(20, Math.floor((LINE_W - indent) / (size * 0.62)));
    for (const row of fold(value, approxChars)) {
      ensure(leading + 2);
      text(row, LEFT + indent, y, size, font);
      y -= leading;
    }
  };

  nextPage();
  for (const row of fold(title, 57)) { ensure(25); text(row, LEFT, y, 17, "F2"); y -= 24; }
  y -= 3;
  paragraph("Période : " + period + "  |  Version " + report.version, 9, 14, 0, "F1");
  if (report.generated_at && !Number.isNaN(Date.parse(report.generated_at))) {
    paragraph("Généré le " + new Date(report.generated_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }), 9, 14);
  }
  y -= 13;
  line(y); y -= 24;

  if (content.summary) {
    ensure(25); text("SYNTHÈSE", LEFT, y, 11.5, "F2", "0.52 0.36 0.15"); y -= 21;
    paragraph(content.summary);
    y -= 20;
  }
  if (content.highlights?.length) {
    ensure(40); text("POINTS CLÉS", LEFT, y, 11.5, "F2", "0.52 0.36 0.15"); y -= 20;
    for (const highlight of content.highlights) {
      ensure(20); text("•", LEFT + 2, y, 10);
      paragraph(highlight, 10.5, 16, 15);
      y -= 4;
    }
    y -= 16;
  }
  for (const section of content.sections) {
    if (section.lines.length === 0) continue;
    ensure(55);
    text(clean(section.title).toLocaleUpperCase("fr-FR"), LEFT, y, 11, "F2", "0.52 0.36 0.15");
    y -= 20;
    for (const item of section.lines) {
      ensure(20);
      text("•", LEFT + 2, y, 10);
      paragraph(item, 10, 15, 15);
      y -= 5;
    }
    y -= 16;
  }
  if (!content.summary && content.sections.length === 0) paragraph("Aucune donnée client disponible sur la période.");

  pages.push(commands);
  for (let i = 0; i < pages.length; i++) {
    const cmds = pages[i];
    const footer = "CODE-V | Document client | Version " + report.version + " | Page " + (i + 1) + "/" + pages.length;
    cmds.push("0.83 0.86 0.88 RG 0.6 w " + LEFT + " 51 m " + (PAGE_W - RIGHT) + " 51 l S");
    cmds.push("0.43 0.47 0.53 rg BT /F1 8 Tf 1 0 0 1 " + LEFT + " 36 Tm " + hexText(footer) + " Tj ET");
  }

  // Construct a real, standalone PDF with byte-correct cross-reference offsets.
  const total = 4 + pages.length * 2;
  const objects = new Map<number, Buffer>();
  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"));
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
  const buffers = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets = [0];
  for (let id = 1; id <= total; id++) {
    offsets[id] = buffers.reduce((sum, b) => sum + b.length, 0);
    buffers.push(Buffer.from(id + " 0 obj\n", "ascii"), objects.get(id)!, Buffer.from("\nendobj\n", "ascii"));
  }
  const xrefPos = buffers.reduce((sum, b) => sum + b.length, 0);
  const xref = ["xref", "0 " + (total + 1), "0000000000 65535 f "];
  for (let id = 1; id <= total; id++) xref.push(String(offsets[id]).padStart(10, "0") + " 00000 n ");
  buffers.push(Buffer.from(xref.join("\n") + "\ntrailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF\n", "ascii"));
  const output = Buffer.concat(buffers);
  if (output.length > MAX_BYTES) throw new Error("PDF trop volumineux");
  return output;
}
