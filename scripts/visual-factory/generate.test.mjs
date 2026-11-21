import test from "node:test";
import assert from "node:assert/strict";
import {
  safeFolder, slug, chooseDomain, detectCategory, sceneAt,
  promptFor, imageFilename, estimateBatchCost, datedParis
} from "./generate.mjs";

test("priorise le domaine personnalisé et ignore previews", () => {
  const domains = [
    "nuisibles-provence-git-main-adrienw86s-projects.vercel.app",
    "nuisibles-provence.vercel.app",
    "www.nuisibles-provence.fr",
    "nuisibles-provence.fr"
  ];
  assert.equal(chooseDomain(domains), "www.nuisibles-provence.fr");
  assert.equal(chooseDomain(["test.vercel.app"]), "test.vercel.app");
  assert.equal(chooseDomain(["test-git-main-example.vercel.app"]), null);
});
test("classification des métiers", () => {
  assert.equal(detectCategory("Dératisation de nuisibles"), "nuisibles");
  assert.equal(detectCategory("Couvreur zinguerie toiture"), "couverture");
  assert.equal(detectCategory("Restaurant du port"), "restauration");
  assert.equal(detectCategory("Institut de beauté"), "beaute");
  assert.equal(detectCategory("Agence de développement web"), "numerique");
});
test("30 images à noms distincts, prompts non-collage", () => {
  for (const category of ["nuisibles", "couverture", "restauration", "beaute", "numerique", "general"]) {
    const site = { projectName: "test-project", category, description: "Description du métier" };
    const names = Array.from({ length: 30 }, (_, i) => imageFilename(site, i));
    assert.equal(new Set(names).size, 30);
    for (let i = 0; i < 30; i++) {
      assert(sceneAt(category, i));
      assert.match(promptFor(site, i, 9), /UNE SEULE photographie/);
      assert.match(names[i], /^([0-2][0-9]|30)-test-project-.+\.webp$/);
    }
  }
});
test("sanitisation et limites tarifaires", () => {
  assert.equal(safeFolder("Toiture / Marseille"), "Toiture Marseille");
  assert.equal(slug("Éco-Toît Charpente"), "eco-toit-charpente");
  assert.equal(estimateBatchCost(480), 19.68);
  assert.equal(datedParis(new Date("2026-11-21T08:00:00Z")), "2026-11-21");
});
