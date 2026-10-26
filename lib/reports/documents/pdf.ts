// Rendu PDF d'un document de rapport complet (un par agent) : en-tête CODE-V, synthèse, tuiles de chiffres clés,
// graphiques vectoriels (courbes, barres), tableaux et notes. Mêmes garanties que le PDF client existant :
// texte en chaînes hexadécimales (jamais d'opérateur injecté), aucune ressource externe, contenu client uniquement.
import { assemblePdf, BOTTOM, clean, escapeFile, fold, hexText, LEFT, LINE_W, MAX_PAGES, PAGE_H, PAGE_W, RIGHT, textWidth, type Font } from "../pdf";
import { reportDocumentSchema, type ReportChart, type ReportDocument, type ReportKpi, type ReportTable } from "./model";

export type DocumentPdfContext = { clientName: string; kindLabel: string; periodLabel: string; version: number; finalized: boolean };

const INK = "0.14 0.18 0.24", MUTED = "0.43 0.47 0.53", ACCENT = "0.14 0.49 1", NAVY = "0.035 0.065 0.11", RULE = "0.83 0.86 0.88", SOFT = "0.95 0.97 0.99";
const GOOD = "0.09 0.55 0.33", BAD = "0.80 0.20 0.18";
const SERIES = ["0.14 0.49 1", "0.96 0.55 0.13", "0.13 0.66 0.45"];
const f2 = (value: number) => value.toFixed(2);
const compact = (value: number) => {
  const abs = Math.abs(value);
  const format = (n: number, digits: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(n).replace(/ | /g, " ");
  if (abs >= 1_000_000) return format(value / 1_000_000, 1) + " M";
  if (abs >= 10_000) return format(value / 1000, 0) + " k";
  if (abs >= 1000) return format(value / 1000, 1) + " k";
  return format(value, abs < 10 && value % 1 ? 1 : 0);
};
/** Graduation « ronde » : 4 intervalles réguliers juste au-dessus du maximum. */
function niceMax(max: number) {
  if (max <= 0) return 4;
  const raw = max / 4, power = 10 ** Math.floor(Math.log10(raw));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]) if (step * power >= raw) return step * power * 4;
  return 40 * power;
}

export function documentPdfFilename(context: Pick<DocumentPdfContext, "clientName" | "version">, document: Pick<ReportDocument, "key" | "title">, periodStart: string) {
  const client = escapeFile(context.clientName) || "client";
  const name = escapeFile(document.title) || document.key.replace("_", "-");
  const period = /^\d{4}-\d{2}-\d{2}$/.test(periodStart) ? periodStart : "periode";
  return `code-v-${client}-${name}-${period}-v${context.version}.pdf`.slice(0, 120);
}

export function renderReportDocumentPdf(context: DocumentPdfContext, input: ReportDocument): Buffer {
  const document = reportDocumentSchema.parse(input);
  if (!Number.isInteger(context.version) || context.version < 1 || context.version > 1_000_000) throw new Error("PDF version invalide");
  const client = clean(context.clientName).slice(0, 200) || "Client";
  const pages: string[][] = [];
  let commands: string[] = [];
  let y = 0;
  const text = (value: string, x: number, yy: number, size: number, font: Font = "F1", rgb = INK) => {
    commands.push(`${rgb} rg BT /${font} ${size} Tf 1 0 0 1 ${f2(x)} ${f2(yy)} Tm ${hexText(value)} Tj ET`);
  };
  const centered = (value: string, cx: number, yy: number, size: number, font: Font = "F1", rgb = INK) => text(value, cx - textWidth(value, size, font) / 2, yy, size, font, rgb);
  const right = (value: string, rx: number, yy: number, size: number, font: Font = "F1", rgb = INK) => text(value, rx - textWidth(value, size, font), yy, size, font, rgb);
  const rect = (x: number, yy: number, w: number, h: number, rgb: string) => commands.push(`${rgb} rg ${f2(x)} ${f2(yy)} ${f2(w)} ${f2(h)} re f`);
  const stroke = (points: [number, number][], rgb: string, width = 0.6) => {
    if (points.length < 2) return;
    commands.push(`${rgb} RG ${width} w 1 J 1 j ${points.map(([x, yy], i) => `${f2(x)} ${f2(yy)} ${i ? "l" : "m"}`).join(" ")} S`);
  };
  const nextPage = () => {
    if (pages.length + (commands.length ? 1 : 0) >= MAX_PAGES) throw new Error("PDF trop long");
    if (commands.length) pages.push(commands);
    commands = [];
    const headerHeight = 66 + (context.finalized ? 0 : 22);
    const bottom = PAGE_H - headerHeight;
    rect(0, bottom, PAGE_W, headerHeight, NAVY);
    rect(0, bottom, PAGE_W, 3, ACCENT);
    commands.push(`q 0.085 0 0 -0.085 ${LEFT - 9} ${PAGE_H - 4} cm ${ACCENT} rg 136 160 m 208 160 l 208 208 l 184 208 l 184 304 l 208 304 l 208 352 l 136 352 l h 304 160 m 376 160 l 376 352 l 304 352 l 304 304 l 328 304 l 328 208 l 304 208 l h f ${ACCENT} RG 22 w 1 J 1 j 214 224 m 256 288 l 298 224 l S Q`);
    text(`CODE-V  /  ${clean(context.kindLabel).toUpperCase()}`, LEFT + 37, PAGE_H - 26, 12, "F2", "1 1 1");
    text(fold(client, LINE_W - 54, 9.5)[0], LEFT + 37, PAGE_H - 44, 9.5, "F1", "0.85 0.89 0.94");
    if (!context.finalized) text("BROUILLON - NON APPROUVÉ - NE PAS TRANSMETTRE", LEFT, bottom + 12, 8.2, "F2", "1 0.78 0.58");
    y = bottom - 32;
  };
  const ensure = (height: number) => { if (y - height < BOTTOM) nextPage(); };
  const paragraph = (value: string, size = 10.5, leading = 15.5, indent = 0, font: Font = "F1", rgb = INK) => {
    for (const row of fold(value, LINE_W - indent, size, font)) { ensure(leading + 2); text(row, LEFT + indent, y, size, font, rgb); y -= leading; }
  };
  const heading = (value: string, following: number) => {
    ensure(22 + following);
    text(clean(value).toUpperCase(), LEFT, y, 10.5, "F2", "0.10 0.32 0.64");
    y -= 9;
    commands.push(`${ACCENT} RG 1.2 w ${LEFT} ${f2(y)} m ${LEFT + 28} ${f2(y)} l S`);
    y -= 16;
  };

  const kpiTiles = (kpis: ReportKpi[]) => {
    const perRow = kpis.length <= 3 ? kpis.length : 4, gap = 10, w = (LINE_W - gap * (perRow - 1)) / perRow, h = 62;
    for (let i = 0; i < kpis.length; i += perRow) {
      ensure(h + 12);
      kpis.slice(i, i + perRow).forEach((item, j) => {
        const x = LEFT + j * (w + gap), top = y + 6;
        rect(x, top - h, w, h, SOFT);
        rect(x, top - h, 2.5, h, ACCENT);
        text(fold(item.label, w - 18, 7.8, "F2")[0].toUpperCase(), x + 11, top - 16, 7.8, "F2", MUTED);
        const valueSize = textWidth(item.value, 17, "F2") > w - 18 ? 13 : 17;
        text(fold(item.value, w - 18, valueSize, "F2")[0], x + 11, top - 38, valueSize, "F2", INK);
        if (item.change) {
          const color = item.trend === "flat" || item.good === undefined ? MUTED : item.good ? GOOD : BAD;
          const arrow = item.trend === "up" ? "▲ " : item.trend === "down" ? "▼ " : "";
          // Flèches hors WinAnsi : rendues par un petit triangle vectoriel, puis le texte de la variation.
          if (arrow) {
            const ax = x + 11, ay = top - 54;
            commands.push(item.trend === "up" ? `${color} rg ${f2(ax)} ${f2(ay)} m ${f2(ax + 6)} ${f2(ay)} l ${f2(ax + 3)} ${f2(ay + 5)} l h f` : `${color} rg ${f2(ax)} ${f2(ay + 5)} m ${f2(ax + 6)} ${f2(ay + 5)} l ${f2(ax + 3)} ${f2(ay)} l h f`);
          }
          text(fold(`${item.change} vs période préc.`, w - 30, 7.6)[0], x + (arrow ? 21 : 11), top - 54, 7.6, "F1", color);
        }
      });
      y -= h + 12;
    }
    y -= 6;
  };

  const chart = (spec: ReportChart) => {
    const height = 196, plotH = 122, axisW = 40;
    ensure(height + 10);
    const top = y;
    text(clean(spec.title), LEFT, top, 10, "F2", INK);
    if (spec.unit) right(`en ${clean(spec.unit)}`, PAGE_W - RIGHT, top, 8, "F1", MUTED);
    if (spec.series.length > 1) {
      let lx = LEFT + textWidth(clean(spec.title), 10, "F2") + 16;
      spec.series.forEach((serie, i) => {
        rect(lx, top - 1, 9, 6, SERIES[i % SERIES.length]);
        text(clean(serie.name), lx + 13, top, 8, "F1", MUTED);
        lx += 13 + textWidth(clean(serie.name), 8, "F1") + 14;
      });
    }
    const x0 = LEFT + axisW, w = LINE_W - axisW, base = top - 24 - plotH;
    const values = spec.series.flatMap((serie) => serie.values.filter((value): value is number => value !== null));
    const max = niceMax(Math.max(0, ...values));
    for (let step = 0; step <= 4; step++) {
      const gy = base + plotH * step / 4;
      commands.push(`${step ? "0.90 0.92 0.94" : RULE} RG ${step ? 0.4 : 0.8} w ${f2(x0)} ${f2(gy)} m ${f2(x0 + w)} ${f2(gy)} l S`);
      right(compact(max * step / 4), x0 - 6, gy - 2.5, 7, "F1", MUTED);
    }
    const n = spec.labels.length, slot = w / n;
    const yOf = (value: number) => base + plotH * Math.min(value, max) / max;
    if (spec.type === "bar") {
      const groups = spec.series.length, barW = Math.max(1.5, Math.min(26, slot * 0.7 / groups));
      spec.series.forEach((serie, s) => serie.values.forEach((value, i) => {
        if (value === null || value <= 0) return;
        const bx = x0 + slot * i + (slot - barW * groups) / 2 + s * barW;
        rect(bx, base, barW - (groups > 1 ? 0.8 : 0), yOf(value) - base, SERIES[s % SERIES.length]);
        if (n <= 12 && groups === 1) centered(compact(value), bx + barW / 2, yOf(value) + 3, 6.8, "F2", INK);
      }));
    } else {
      spec.series.forEach((serie, s) => {
        const color = SERIES[s % SERIES.length];
        // Une valeur absente interrompt la courbe (jamais reliée par une valeur inventée).
        let segment: [number, number][] = [];
        serie.values.forEach((value, i) => {
          if (value === null) { stroke(segment, color, 1.6); segment = []; return; }
          segment.push([x0 + slot * (i + 0.5), yOf(value)]);
        });
        stroke(segment, color, 1.6);
        if (n <= 31) serie.values.forEach((value, i) => { if (value !== null) rect(x0 + slot * (i + 0.5) - 1.6, yOf(value) - 1.6, 3.2, 3.2, color); });
      });
    }
    // Libellés de l'axe horizontal : un sur k pour rester lisibles ; deux lignes au plus pour les noms (campagnes).
    const every = Math.max(1, Math.ceil(n / (spec.type === "bar" && n <= 10 ? n : 10)));
    spec.labels.forEach((labelText, i) => {
      if (i % every) return;
      const cx = x0 + slot * (i + 0.5), rows = fold(labelText, Math.max(slot * every - 4, 30), 7).slice(0, 2);
      rows.forEach((row, r) => centered(row, cx, base - 11 - r * 9, 7, "F1", MUTED));
    });
    y = top - height;
  };

  const table = (spec: ReportTable) => {
    const columns = spec.columns.length;
    // Largeurs selon le contenu (bornées), puis ramenées à la largeur utile ; chiffres alignés à droite.
    const natural = spec.columns.map((column, i) => Math.min(260, Math.max(textWidth(clean(column).toUpperCase(), 7.6, "F2"), ...spec.rows.map((row) => textWidth(clean(row[i]), 9, i ? "F2" : "F1")))) + 18);
    const scale = LINE_W / natural.reduce((a, b) => a + b, 0);
    const widths = natural.map((value) => value * scale);
    const xs = widths.map((_, i) => LEFT + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const numeric = spec.columns.map((_, i) => i > 0 && spec.rows.every((row) => /^(?:[−+-]?[\d\s.,]+\s?(?:€|%|pt|k)?|—|stable)$/u.test(clean(row[i]))));
    const header = () => {
      rect(LEFT, y - 7, LINE_W, 22, "0.93 0.96 0.99");
      spec.columns.forEach((column, i) => {
        const value = fold(column, widths[i] - 14, 7.6, "F2")[0].toUpperCase();
        if (numeric[i]) right(value, xs[i] + widths[i] - 8, y, 7.6, "F2", MUTED); else text(value, xs[i] + 8, y, 7.6, "F2", MUTED);
      });
      y -= 24;
    };
    // Un petit tableau n'est jamais coupé : il passe entier à la page suivante.
    const estimate = 24 + spec.rows.reduce((sum, row) => sum + Math.max(...row.map((cell, i) => fold(cell, widths[i] - 16, 9, numeric[i] ? "F2" : "F1").length)) * 12.5 + 8, 0);
    heading(spec.title, estimate <= 320 ? estimate : 50);
    header();
    spec.rows.forEach((row, index) => {
      const cells = row.map((cell, i) => fold(cell, widths[i] - 16, 9, numeric[i] ? "F2" : "F1"));
      const height = Math.max(...cells.map((lines) => lines.length)) * 12.5 + 8;
      if (y - height < BOTTOM) { nextPage(); heading(`${spec.title} (suite)`, 50); header(); }
      const last = /^total$/i.test(clean(row[0]));
      if (index % 2) rect(LEFT, y - height + 9, LINE_W, height, "0.985 0.99 0.995");
      cells.forEach((lines, i) => lines.forEach((line, l) => {
        if (numeric[i]) right(line, xs[i] + widths[i] - 8, y - l * 12.5, 9, "F2", INK); else text(line, xs[i] + 8, y - l * 12.5, 9, last ? "F2" : "F1", INK);
      }));
      y -= height;
      commands.push(`0.90 0.92 0.94 RG 0.4 w ${LEFT} ${f2(y + 9)} m ${f2(PAGE_W - RIGHT)} ${f2(y + 9)} l S`);
    });
    y -= 14;
  };

  nextPage();
  paragraph(document.title, 21, 26, 0, "F2");
  paragraph(`${clean(context.kindLabel)}  |  ${clean(context.periodLabel)}`, 9.5, 14, 0, "F1", MUTED);
  y -= 12;
  if (clean(document.summary)) {
    const rows = fold(document.summary, LINE_W - 28, 10.5);
    const boxH = rows.length * 15.5 + 18;
    ensure(boxH + 10);
    rect(LEFT, y - boxH + 12, LINE_W, boxH, SOFT);
    rect(LEFT, y - boxH + 12, 3, boxH, ACCENT);
    let ty = y - 4;
    for (const row of rows) { text(row, LEFT + 16, ty, 10.5, "F1", INK); ty -= 15.5; }
    y -= boxH + 12;
  }
  if (document.kpis.length) { heading("Chiffres clés", 80); kpiTiles(document.kpis); }
  for (const spec of document.charts) chart(spec);
  for (const spec of document.tables) if (spec.rows.length) table(spec);
  if (document.notes.length) {
    heading("À savoir", 30);
    for (const note of document.notes) {
      if (!clean(note)) continue;
      ensure(16);
      text("•", LEFT + 2, y, 8.5, "F1", ACCENT);
      paragraph(note, 8.5, 12.5, 12, "F1", MUTED);
      y -= 3;
    }
  }
  pages.push(commands);
  pages.forEach((page, i) => {
    const footer = `CODE-V | ${clean(document.title)} | ${clean(context.periodLabel)} | Version ${context.version} | Page ${i + 1}/${pages.length}`;
    page.push(`${RULE} RG 0.6 w ${LEFT} 51 m ${f2(PAGE_W - RIGHT)} 51 l S`);
    page.push(`${MUTED} rg BT /F1 8 Tf 1 0 0 1 ${LEFT} 36 Tm ${hexText(fold(footer, LINE_W, 8)[0])} Tj ET`);
  });
  return assemblePdf(pages, `${document.title} - ${client}`);
}
