import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const m = loadTs("lib/client-memory/model.ts");
const plain = (v) => JSON.parse(JSON.stringify(v));
const fact = (over) => ({ id: over.id ?? "f", kind: "service", statement: "Démoussage de toiture", source: "admin", sourceRef: null, status: "confirmed", validUntil: null, confirmedBy: "user_a", createdAt: "2026-11-01", ...over });

test("empreinte : même fait malgré accents, casse et ponctuation", () => {
  assert.equal(m.factFingerprint("Démoussage, de TOITURE !"), m.factFingerprint("demoussage de toiture"));
});

test("fiche client → faits repris tels quels, avec leur champ d'origine, sans doublon", () => {
  const facts = plain(m.factsFromRecord({ name: "Jrenov", activity: "Couvreur", zone: "Lyon", services: ["Démoussage", "démoussage", " "], activitySummary: null,
    communicationGuidelines: "Tutoiement interdit", editorialBrief: "", editorialRules: ["Pas d'emoji"] }));
  assert.deepEqual(facts.map((f) => [f.kind, f.statement, f.sourceRef]), [
    ["company", "Jrenov : Couvreur", "clients.activity"], ["zone", "Lyon", "clients.geographic_area"], ["service", "Démoussage", "services"],
    ["tone", "Tutoiement interdit", "client_media_profiles.communication_guidelines"], ["tone", "Pas d'emoji", "publication_agent_projects.editorial_rules"],
  ]);
});

test("distribution : seuls les faits confirmés et valides, dans les catégories de l'agent ; les exclusions à part", () => {
  const facts = [
    fact({ id: "1" }), fact({ id: "2", status: "proposed", statement: "Garantie 10 ans" }), fact({ id: "3", kind: "pricing", statement: "Devis gratuit" }),
    fact({ id: "4", kind: "exclusion", statement: "Ne jamais parler d'amiante" }), fact({ id: "5", kind: "guarantee", statement: "Assurance décennale", validUntil: "2026-01-01" }),
  ];
  const brief = plain(m.clientBrief(facts, "publications", "2026-11-13"));
  assert.deepEqual(brief.facts, ["Démoussage de toiture"], "proposé, expiré et prix exclus pour Publications");
  assert.deepEqual(brief.exclusions, ["Ne jamais parler d'amiante"]);
  assert.doesNotMatch(brief.text, /amiante/, "une exclusion n'entre jamais dans les faits autorisés (contrôle anti-invention)");
  assert.deepEqual(plain(m.clientBrief(facts, "google-ads", "2026-11-13")).facts, ["Démoussage de toiture", "Devis gratuit"], "Google Ads reçoit les prix");
});

test("saisie : catégorie connue, longueur bornée, date future", () => {
  assert.equal(m.parseFactInput({ kind: "service", statement: "  Ramonage   annuel " }, "2026-11-13").statement, "Ramonage annuel");
  assert.equal(m.parseFactInput({ kind: "inconnu", statement: "x y" }, "2026-11-13").ok, false);
  assert.equal(m.parseFactInput({ kind: "service", statement: "a" }, "2026-11-13").ok, false);
  assert.equal(m.parseFactInput({ kind: "service", statement: "ok fait", validUntil: "2026-01-01" }, "2026-11-13").ok, false);
});

test("synchronisation : crée les nouveaux faits de la fiche, archive ceux qui ont disparu, restaure ceux qui reviennent, ne touche jamais un fait de l'administrateur", () => {
  const existing = [
    fact({ id: "keep", source: "client_record", statement: "Lyon", kind: "zone" }),
    fact({ id: "gone", source: "client_record", statement: "Villeurbanne", kind: "zone" }),
    fact({ id: "back", source: "client_record", statement: "Ramonage", status: "archived" }),
    fact({ id: "admin", source: "admin", statement: "Hors fiche" }),
    fact({ id: "rejected", source: "client_record", statement: "Rejeté", status: "rejected" }),
  ];
  const derived = [{ kind: "zone", statement: "lyon", sourceRef: "x" }, { kind: "service", statement: "Ramonage", sourceRef: "x" }, { kind: "service", statement: "Rejeté", sourceRef: "x" }, { kind: "service", statement: "Nouveau", sourceRef: "x" }];
  const plan = plain(m.recordSyncPlan(derived, existing));
  assert.deepEqual(plan.create.map((f) => f.statement), ["Nouveau"]);
  assert.deepEqual(plan.archive, ["gone"]);
  assert.deepEqual(plan.restore, ["back"], "un rejet de l'administrateur n'est jamais annulé");
});

test("migration : faits avec source et statut, confirmation humaine obligatoire hors fiche client, accès serveur seulement", () => {
  const sql = readFileSync("supabase/migrations/20261209000000_client_memory.sql", "utf8");
  assert.match(sql, /unique\(client_id, kind, fingerprint\)/);
  assert.match(sql, /check\(status <> 'confirmed' or \(confirmed_by is not null and confirmed_at is not null\)\)/);
  assert.match(sql, /check\(confirmed_by is distinct from 'system:client_record' or source = 'client_record'\)/);
  assert.match(sql, /revoke all on public\.client_facts from public, anon, authenticated/);
});

test("agents : Publications v2, Blog, Visuels, Vidéo et Newsletter lisent la mémoire ; faits confirmés citables, exclusions transmises", () => {
  const ctx = readFileSync("lib/publications/agent-v2/context.ts", "utf8");
  assert.match(ctx, /clientMemoryFor\(clientId,'publications'\)/);
  assert.match(readFileSync("lib/publications/agent-v2/selection.ts", "utf8"), /\.\.\.\(input\.confirmedFacts\?\?\[\]\)\]\.join/);
  assert.match(readFileSync("lib/publications/agent-v2/prompt.ts", "utf8"), /client_exclusions_never_write:input\.clientExclusions/);
  const brand = readFileSync("lib/visual-agent/service.ts", "utf8");
  assert.match(brand, /clientMemoryFor\(clientId,agent\)/);
  assert.match(readFileSync("lib/blog-agent/service.ts", "utf8"), /clientBrandContext\(clientId,'blog'\)/);
  assert.match(readFileSync("lib/video-agent/service.ts", "utf8"), /clientBrandContext\(clientId,'video'\)/);
  assert.match(readFileSync("lib/emailing/newsletter-service.ts", "utf8"), /clientBrandContext\(clientId, "newsletter"\)/);
  assert.match(readFileSync("lib/harness/charter.ts", "utf8"), /client_exclusions_never_write/);
});
