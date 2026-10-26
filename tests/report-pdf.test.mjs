import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadTs } from "./helpers/load-ts.mjs";

const preview = loadTs("lib/reports/email-preview.ts", { "./recipient": loadTs("lib/reports/recipient.ts"), "./documents/model": loadTs("lib/reports/documents/model.ts") });
const pdfModule = loadTs("lib/reports/pdf.ts", { "./email-preview": preview });
const report = {
  id: "11111111-1111-4111-8111-111111111111", title: "Rapport mensuel — Électricité & Toiture",
  version: 3, kind: "monthly", period_start: "2026-09-01", period_end: "2026-09-30",
  generated_at: "2026-10-15T09:10:00Z", status: "approved", approved_version: 3, client: { name: "Établissements Catalans" },
  client_content: { summary: "Synthèse des résultats et de l’activité.", highlights: [], sections: [
    { title: "Résultats", lines: ["Campagne Google Ads : 10 clics, 12,50 € de dépenses.", "Référencement : 7 impressions."] },
    { title: "Suite des actions", lines: ["Faire valider le prochain contenu."] },
  ], empty: false },
  internal_content: { summary: "SECRET_TO_NEVER_EXPOSE_IN_PDF", sections: [] },
};
function pdfText(r = report) { return pdfModule.renderClientReportPdf(r); }
function decodedText(pdf) {
  return [...pdf.toString("latin1").matchAll(/<([a-f0-9]+)>/gi)].map((match) => new TextDecoder("windows-1252").decode(Buffer.from(match[1], "hex"))).join("\n");
}
function pageCount(pdf) { return (pdf.toString("latin1").match(/\/Type \/Page \/Parent/g) ?? []).length; }

test("standalone A4 PDF has a valid cross-reference, version, French accents and only client content", () => {
  const pdf = pdfText();
  assert.equal(pdf.subarray(0, 8).toString("latin1"), "%PDF-1.4");
  const data = pdf.toString("latin1");
  assert.match(data, /\/Type \/Catalog/);
  assert.match(data, /\/MediaBox \[ 0 0 595.28 841.89 \]/);
  assert.match(data, /\/Encoding \/WinAnsiEncoding/);
  const cross = data.match(/startxref\n(\d+)\n%%EOF/);
  assert.ok(cross);
  assert.equal(data.slice(Number(cross[1]), Number(cross[1]) + 4), "xref");
  assert.ok(data.toLowerCase().includes(Buffer.from("CODE-V", "latin1").toString("hex").toLowerCase()));
  assert.ok(data.toLowerCase().includes(Buffer.from("Électricité", "latin1").toString("hex").toLowerCase()));
  assert.ok(!data.includes(Buffer.from("SECRET_TO_NEVER_EXPOSE_IN_PDF", "latin1").toString("hex").toUpperCase()));
  assert.match(pdfModule.clientReportPdfFilename(report), /^code-v-etablissements-catalans-monthly-2026-09-01-v3\.pdf$/);
});

test("unapproved report is visibly stamped and client-only regardless of view", () => {
  const data = pdfText({ ...report, status: "ready_for_review" }).toString("latin1");
  assert.ok(data.toLowerCase().includes(Buffer.from("BROUILLON", "latin1").toString("hex").toLowerCase()));
  assert.ok(!data.includes("SECRET_TO_NEVER_EXPOSE_IN_PDF"));
});

test("many client lines paginate without dropping records or exposing internal content", () => {
  const lines = Array.from({ length: 110 }, (_, i) => "Intervention client #" + i + " : " + "Vérification technique et contrôles en atelier. ".repeat(2));
  const doc = pdfText({ ...report, client_content: { summary: "Résumé", sections: [{ title: "Observations", lines }] } });
  const data = doc.toString("latin1");
  assert.ok((data.match(/\/Type \/Page \/Parent/g) ?? []).length > 1);
  assert.ok(data.toLowerCase().includes(Buffer.from("Intervention client #109", "latin1").toString("hex").toLowerCase()));
  assert.ok(doc.byteLength < 3_500_000);
});

test("strict client schema rejects internal data and invalid versions", () => {
  assert.throws(() => pdfText({ ...report, client_content: { ...report.client_content, internal: report.internal_content } }));
  assert.throws(() => pdfText({ ...report, version: 0 }));
});

test("every PDF object and stream has byte-correct offsets and lengths", () => {
  const doc = pdfText();
  const data = doc.toString("latin1");
  const entries = data.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/);
  assert.ok(entries);
  const offsets = entries[2].trim().split("\n");
  assert.equal(offsets.length, Number(entries[1]));
  offsets.slice(1).forEach((entry, i) => {
    assert.equal(data.slice(Number(entry.slice(0, 10))).startsWith(`${i + 1} 0 obj\n`), true);
  });
  for (const stream of data.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g)) {
    assert.equal(Buffer.byteLength(stream[2], "latin1"), Number(stream[1]));
  }
});

test("accents, typographic values and long metric labels are rendered as actual facts", () => {
  const text = decodedText(pdfText({ ...report, client_content: { summary: "E\u0301volution : −12,5 % → à vérifier, œuvre, 1\u202f234,56 €.", sections: [
    { title: "Indicateurs réels", lines: ["Impressions : 12 345", "Coût par conversion : indisponible", "Conversions : 0"] },
  ] } }));
  assert.match(text, /Évolution : -12,5 % -> à vérifier, œuvre, 1 234,56 €\./);
  assert.match(text, /INDICATEUR/);
  assert.match(text, /RÉSULTAT/);
  assert.match(text, /Coût par conversion/);
  assert.match(text, /indisponible/);
  assert.doesNotMatch(text, /NaN|Infinity|SECRET_TO_NEVER_EXPOSE/);
});

test("unapproved, stale-approved and archived stale versions remain visibly draft on every page", () => {
  for (const state of [
    { status: "ready_for_review", approved_version: 3 },
    { status: "approved", approved_version: 2 },
    { status: "sent", approved_version: null },
    { status: "archived", approved_version: 2 },
  ]) {
    const doc = pdfText({ ...report, ...state, client_content: { summary: "Résumé", sections: [{ title: "Travaux", lines: Array(100).fill("Tâche réalisée pour le client.") }] } });
    assert.equal((decodedText(doc).match(/BROUILLON - NON APPROUVÉ - NE PAS TRANSMETTRE/g) ?? []).length, pageCount(doc));
  }
  assert.doesNotMatch(decodedText(pdfText()), /BROUILLON/);
});

test("invisible controls and PDF operator-looking text cannot create active content", () => {
  const doc = pdfText({ ...report, title: "Titre\r\n\0\u202e client", client_content: { summary: "<script>alert(1)</script> ) Tj ET /OpenAction /JavaScript /URI https://example.invalid/?a=1&b=2", sections: [] } });
  const data = doc.toString("latin1");
  const text = decodedText(doc);
  assert.match(text, /Titre client/);
  assert.match(text, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(data, /\/OpenAction|\/JavaScript|\/URI|\/EmbeddedFile/);
  assert.doesNotMatch(text, /\u202e|\u0000|SECRET_TO_NEVER_EXPOSE/);
});

test("empty sections are honest, dates cannot roll over and filenames cannot inject headers", () => {
  const text = decodedText(pdfText({ ...report, period_start: "2026-02-31", generated_at: "not-a-date", client_content: { summary: " \n", highlights: ["\t"], sections: [{ title: "Vide", lines: [" \n "] }] } }));
  assert.match(text, /Aucune donnée client disponible sur la période\./);
  assert.match(text, /Date non renseignée/);
  assert.doesNotMatch(text, /Généré le|NaN|Vide/);
  const name = pdfModule.clientReportPdfFilename({ ...report, kind: "custom", client: { name: "../../\r\nÉlectricité; \"X\"" }, version: "1\r\nX-Injected: true", period_start: "2026-02-31" });
  assert.equal(name, "code-v-electricite-x-custom-periode-vinconnue.pdf");
});

test("oversized reports fail explicitly and the 45-page bound is exact", () => {
  assert.throws(() => pdfText({ ...report, client_content: { summary: "Résumé", sections: [{ title: "Données", lines: Array(25).fill("X".repeat(10_000)) }] } }), /PDF trop volumineux/);
  const document = (count) => pdfText({ ...report, client_content: { summary: "Résumé", sections: Array.from({ length: Math.ceil(count / 200) }, (_, section) => ({ title: "Activités", lines: Array(Math.min(200, count - section * 200)).fill("Intervention réalisée et contrôlée.") })) } });
  let low = 1, high = 2000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    try { document(middle); low = middle; } catch (error) { assert.match(error.message, /PDF trop long/); high = middle - 1; }
  }
  assert.equal(pageCount(document(low)), 45);
  assert.throws(() => document(low + 1), /PDF trop long/);
});

const poppler = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });
test("real Poppler parser confirms French, all long data and printable A4 margins", { skip: poppler.error ? "pdftotext unavailable" : false }, () => {
  const directory = mkdtempSync(join(tmpdir(), "codev-pdf-"));
  try {
    const filename = join(directory, "client.pdf");
    const longTitle = "W".repeat(190);
    const longName = "W".repeat(200);
    const longHeading = "ÉVALUATION ".repeat(55);
    const finalRecord = "DERNIERE_DONNEE_CLIENT_109";
    const rows = Array.from({ length: 110 }, (_, i) => i === 109 ? finalRecord : `Intervention ${i} : ${"W".repeat(120)} — œuvre vérifiée à Céret, 12,50 €.`);
    writeFileSync(filename, pdfText({ ...report, title: longTitle, client: { name: longName }, client_content: { summary: "Électricité, rénovation et activité du client.", sections: [
      { title: longHeading, lines: rows },
      { title: "Métriques", lines: Array.from({ length: 70 }, (_, i) => `Mesure ${i} : ${i},50 €`) },
    ] } }));
    const parsed = spawnSync("pdftotext", ["-bbox", filename, "-"], { encoding: "utf8", maxBuffer: 4_000_000 });
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.match(parsed.stdout, /Électricité/);
    assert.match(parsed.stdout, /œuvre/);
    assert.match(parsed.stdout, /DERNIERE_DONNEE_CLIENT_109/);
    assert.match(parsed.stdout, /69,50/);
    const words = [...parsed.stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)];
    assert.ok(words.length > 1500);
    for (const word of words) {
      assert.ok(Number(word[1]) >= 47.5, `left overflow: ${word[5]}`);
      assert.ok(Number(word[3]) <= 547.8, `right overflow: ${word[5]} ${word[3]}`);
      assert.ok(Number(word[2]) >= 0 && Number(word[4]) <= 812, `vertical overflow: ${word[5]}`);
    }
    assert.equal((parsed.stdout.match(/INDICATEUR/g) ?? []).length > 1, true, "table header repeats across page breaks");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("PDF route checks admin before reading and serves an uncached private attachment", async () => {
  let reads = 0;
  const route = loadTs("app/api/reports/[id]/pdf/route.ts", {
    "@/lib/require-admin": { requireAdmin: async () => { throw Error("no admin"); } },
    "@/lib/reports/service": { getReport: async () => { reads++; return report; } },
    "@/lib/reports/pdf": pdfModule, "@/lib/reports/documents/model": {}, "@/lib/reports/documents/pdf": {},
  }, { Response });
  await assert.rejects(() => route.GET({}, { params: Promise.resolve({ id: report.id }) }), /no admin/);
  assert.equal(reads, 0);
  const authorized = loadTs("app/api/reports/[id]/pdf/route.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "admin" }) },
    "@/lib/reports/service": { getReport: async () => report, documentPdfContext: () => ({}) },
    "@/lib/reports/pdf": pdfModule, "@/lib/reports/documents/model": { clientDocuments: () => [] }, "@/lib/reports/documents/pdf": {},
  }, { Response });
  const response = await authorized.GET({}, { params: Promise.resolve({ id: report.id }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/pdf");
  assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  assert.match(response.headers.get("Content-Disposition"), /attachment; filename="code-v-/);
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 8).toString("latin1"), "%PDF-1.4");
  const missing = loadTs("app/api/reports/[id]/pdf/route.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "admin" }) },
    "@/lib/reports/service": { getReport: async () => null },
    "@/lib/reports/pdf": pdfModule, "@/lib/reports/documents/model": {}, "@/lib/reports/documents/pdf": {},
  }, { Response });
  assert.equal((await missing.GET({}, { params: Promise.resolve({ id: "missing" }) })).status, 404);
});
