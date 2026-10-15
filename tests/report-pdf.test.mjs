import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const preview = loadTs("lib/reports/email-preview.ts", { "./recipient": loadTs("lib/reports/recipient.ts") });
const pdfModule = loadTs("lib/reports/pdf.ts", { "./email-preview": preview });
const report = {
  id: "11111111-1111-4111-8111-111111111111", title: "Rapport mensuel — Électricité & Toiture",
  version: 3, kind: "monthly", period_start: "2026-09-01", period_end: "2026-09-30",
  generated_at: "2026-10-15T09:10:00Z", status: "approved", client: { name: "Établissements Catalans" },
  client_content: { summary: "Synthèse des résultats et de l’activité.", highlights: [], sections: [
    { title: "Résultats", lines: ["Campagne Google Ads : 10 clics, 12,50 € de dépenses.", "Référencement : 7 impressions."] },
    { title: "Suite des actions", lines: ["Faire valider le prochain contenu."] },
  ], empty: false },
  internal_content: { summary: "SECRET_TO_NEVER_EXPOSE_IN_PDF", sections: [] },
};
function pdfText(r = report) { return pdfModule.renderClientReportPdf(r); }

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

test("PDF route checks admin before reading and serves an uncached private attachment", async () => {
  let reads = 0;
  const route = loadTs("app/api/reports/[id]/pdf/route.ts", {
    "@/lib/require-admin": { requireAdmin: async () => { throw Error("no admin"); } },
    "@/lib/reports/service": { getReport: async () => { reads++; return report; } },
    "@/lib/reports/pdf": pdfModule,
  }, { Response });
  await assert.rejects(() => route.GET({}, { params: Promise.resolve({ id: report.id }) }), /no admin/);
  assert.equal(reads, 0);
  const authorized = loadTs("app/api/reports/[id]/pdf/route.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "admin" }) },
    "@/lib/reports/service": { getReport: async () => report },
    "@/lib/reports/pdf": pdfModule,
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
    "@/lib/reports/pdf": pdfModule,
  }, { Response });
  assert.equal((await missing.GET({}, { params: Promise.resolve({ id: "missing" }) })).status, 404);
});
