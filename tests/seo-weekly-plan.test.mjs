import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const grounded = loadTs("lib/ai/grounded.ts");
const opportunities = loadTs("lib/seo/opportunities.ts");
const plan = loadTs("lib/seo/weekly-plan.ts", { "@/lib/ai/grounded": grounded, "@/lib/seo/opportunities": opportunities });
const opp = (keyword, extra = {}) => ({ fingerprint: `query:${keyword}`, category: "striking_distance", keyword, keywords: [keyword], targetUrl: "https://exemple.fr/deratisation", targetStatus: "existing",
  intent: "local", intentBasis: "", priority: "high", confidence: "high", source: "search_console", verified: true,
  metrics: { clicks: 12, impressions: 480, ctr: 0.025, position: 11.4 }, previous: null, potentialClicks: 30, factors: [], rationale: "Page proche de la première page.", recommendedAction: "Renforcer la page.", actionKind: "optimize_page", evidence: {}, ...extra });
const detected = [opp("deratisation perpignan"), opp("desinsectisation 66")];
const why = "Requête locale liée au cœur de métier, déjà en position 11,4.";

test("plan SEO : seules des opportunités détectées, sans doublon, 3 au plus", () => {
  const out = plan.validateSeoPlan({ summary: "Deux leviers rapides cette semaine.", items: [
    { fingerprint: "query:deratisation perpignan", why, action: "Ajouter la ville dans le titre." },
    { fingerprint: "query:deratisation perpignan", why, action: "Doublon." },
    { fingerprint: "query:inventee", why, action: "Inventée." },
    { fingerprint: "query:desinsectisation 66", why: "Intention locale.", action: "Créer une section dédiée." },
  ] }, "Client", detected);
  assert.equal(out.ok, true);
  assert.deepEqual(out.plan.items.map((item) => item.keyword), ["deratisation perpignan", "desinsectisation 66"]);
  assert.match(plan.seoPlanReason(out.plan), /1\. « deratisation perpignan »/);
});

test("plan SEO : chiffre inventé ou calculé refusé ; aucun choix valide → refus", () => {
  const bad = plan.validateSeoPlan({ summary: "Gagnez 45 % de clics.", items: [{ fingerprint: "query:deratisation perpignan", why, action: "Titre." }] }, "Client", detected);
  assert.equal(bad.ok, false); assert.equal(bad.reason, "ungrounded");
  assert.equal(plan.validateSeoPlan({ summary: "Rien.", items: [{ fingerprint: "query:x", why, action: "y" }] }, "Client", detected).ok, false);
  assert.ok(plan.seoPlanSchema(["a"]).properties.items.items.properties.fingerprint.enum.includes("a"));
});
