import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/publications/manual-export.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, Set });
const { prepareManualExport, tryCopyPublicationText } = exports;
const fixture = () => ({
  clientName: "Protection Nuisibles", subject: "Été / désinsectisation", revisionNumber: 3, approved: false,
  variants: [{ platform: "facebook", text: "Bonjour 🐝\nContactez-nous : https://exemple.fr/contact", title: "Un été serein", cta: "Prenez rendez-vous" },
    { platform: "instagram", text: "Texte Instagram avec accents : été. #prévention" }],
  source_content: "PRIVATE_SOURCE", prompt: "PRIVATE_PROMPT", storage_path: "PRIVATE_STORAGE_PATH",
  assets: [{ preview: "https://private.supabase.co/storage/v1/object/sign/photo?token=PRIVATE_TOKEN" }],
  prior_revision: { text: "OBSOLETE_TEXT" },
});

test("manual retrieval contains only current public variants and an explicit non-approved state", async () => {
  const prepared = prepareManualExport(fixture());
  const text = await new Blob([prepared.content], { type: "text/plain;charset=utf-8" }).text();
  assert.equal(prepared.variants[0].text, "Un été serein\n\nBonjour 🐝\nContactez-nous : https://exemple.fr/contact\n\nPrenez rendez-vous");
  assert.match(text, /Version 3\nNON APPROUVÉ — validation requise avant publication/);
  assert.match(text, /=== Facebook ===/); assert.match(text, /=== Instagram ===/);
  assert.match(text, /🐝/); assert.match(text, /été/);
  assert.doesNotMatch(text, /PRIVATE_|OBSOLETE_TEXT|supabase|source_content|prompt|storage_path/);
  assert.match(prepared.filename, /^publication-protection-nuisibles-ete-desinsectisation-v3\.txt$/);
  assert.ok(!prepared.variants[0].text.includes(fixture().subject), "internal subject is not added to copied public text");
});

test("approved retrieval states validation without claiming export is publication", () => {
  const prepared = prepareManualExport({ ...fixture(), approved: true });
  assert.match(prepared.content, /Version approuvée/);
  assert.match(prepared.content, /La récupération des textes ne publie rien/);
  assert.doesNotMatch(prepared.content, /NON APPROUVÉ|Publication réussie|publié avec succès/);
});

test("retrieval preserves exact text, bounds complete input and never silently truncates a variant", () => {
  const text = `  Début\n${"x".repeat(9977)}\nFin  `;
  assert.equal(prepareManualExport({ ...fixture(), variants: [{ platform: "facebook", text }] }).variants[0].text, text);
  for (const change of [
    { variants: [] }, { variants: [{ platform: "facebook", text: "x".repeat(10001) }] },
    { variants: [{ platform: "facebook", text: "" }] }, { variants: [{ platform: "unknown", text: "Texte" }] },
    { variants: [{ platform: "facebook", text: "A" }, { platform: "facebook", text: "B" }] },
    { revisionNumber: 0 }, { revisionNumber: Infinity }, { clientName: "C".repeat(301) },
  ]) assert.throws(() => prepareManualExport({ ...fixture(), ...change }));
  const safe = prepareManualExport({ ...fixture(), clientName: "../Élodie\r\nClient : intrus", subject: "../../Témoignage 😄" });
  assert.ok(!safe.filename.includes("/") && !safe.filename.includes(".."));
  assert.match(safe.content, /Client : \.\.\/Élodie Client : intrus\nSujet/);
});

test("clipboard rejection and absence require manual copy; success is reported only after the exact text is written", async () => {
  const text = prepareManualExport(fixture()).variants[0].text;
  assert.equal(await tryCopyPublicationText(text), false);
  assert.equal(await tryCopyPublicationText(text, { writeText: async () => { throw Error("Permission denied"); } }), false);
  let written;
  assert.equal(await tryCopyPublicationText(text, { writeText: async value => { written = value; } }), true);
  assert.equal(written, text);
});
