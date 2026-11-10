import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const prescribers = loadTs("lib/acquisition/prescribers.ts");
const sirene = loadTs("lib/acquisition/sirene.ts", { "./prescribers": prescribers });

test("le métier libre du client est rattaché au bon profil prescripteurs", () => {
  assert.equal(prescribers.resolveTradeProfile("Couvreur zingueur").id, "roofer");
  assert.equal(prescribers.resolveTradeProfile("Entreprise de TOITURE").id, "roofer");
  assert.equal(prescribers.resolveTradeProfile("Plombier chauffagiste").id, "plumber");
  assert.equal(prescribers.resolveTradeProfile("Électricien").id, "electrician");
  assert.equal(prescribers.resolveTradeProfile("Fleuriste").id, "generic");
  assert.equal(prescribers.resolveTradeProfile(null).id, "generic");
  const roofer = prescribers.resolveTradeProfile("couvreur");
  for (const seg of ["architects", "property_managers", "real_estate_agencies"]) {
    assert.ok(roofer.targets.some((t) => t.segment === seg), seg);
  }
});

test("chaque segment cible un code NAF valide et unique", () => {
  const seen = new Set();
  for (const seg of Object.values(prescribers.PRESCRIBER_SEGMENTS)) {
    assert.ok(seg.nafCodes.length > 0);
    for (const code of seg.nafCodes) {
      assert.match(code, /^\d{2}\.\d{2}[A-Z]$/);
      assert.ok(!seen.has(code), `doublon ${code}`);
      seen.add(code);
    }
  }
  for (const profile of [...prescribers.TRADE_PROFILES, prescribers.GENERIC_TRADE_PROFILE]) {
    for (const t of profile.targets) assert.ok(prescribers.PRESCRIBER_SEGMENTS[t.segment], t.segment);
  }
});

test("les URL d'API sont bornées et filtrent les entreprises actives", () => {
  const url = new URL(sirene.buildNearPointUrl({ lat: 45.76, lon: 4.83, radiusKm: 500, nafCodes: ["71.11Z", "68.32A"], page: 0, perPage: 99 }));
  assert.equal(url.origin, "https://recherche-entreprises.api.gouv.fr");
  assert.equal(url.searchParams.get("radius"), "50");
  assert.equal(url.searchParams.get("etat_administratif"), "A");
  assert.equal(url.searchParams.get("activite_principale"), "71.11Z,68.32A");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("per_page"), "25");
  assert.equal(new URL(sirene.buildCommuneLookupUrl("Lyon")).origin, "https://geo.api.gouv.fr");
});

const company = (siren, naf, extra = {}) => ({
  siren, nom_complet: `Société ${siren}`, etat_administratif: "A", activite_principale: naf,
  tranche_effectif_salarie: "11", date_creation: "2010-01-01",
  dirigeants: [{ nom: "Dupont", prenoms: "Jean" }],
  complements: { est_entrepreneur_individuel: false },
  matching_etablissements: [{ siret: `${siren}00011`, activite_principale: naf, adresse: "1 rue Test 69002 LYON", code_postal: "69002", libelle_commune: "LYON", latitude: "45.75", longitude: "4.83", etat_administratif: "A" }],
  ...extra,
});

test("la réponse Sirene est convertie sans dirigeants ni entreprises fermées", () => {
  const { companies, totalPages } = sirene.parseSireneResults({
    total_pages: 3,
    results: [company("123456789", "71.11Z"), company("987654321", "68.32A", { etat_administratif: "C" }), { siren: "bad" }],
  });
  assert.equal(totalPages, 3);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].city, "LYON");
  assert.equal(companies[0].sourceUrl, "https://annuaire-entreprises.data.gouv.fr/entreprise/123456789");
  assert.ok(!("dirigeants" in companies[0]));
  assert.ok(!JSON.stringify(companies).includes("Dupont"));
});

test("classement : segment prioritaire et proximité d'abord, exclusions respectées", () => {
  const profile = prescribers.resolveTradeProfile("couvreur");
  const origin = { lat: 45.76, lon: 4.83 };
  const { companies } = sirene.parseSireneResults({ results: [
    company("111111111", "66.22Z"), company("222222222", "71.11Z"), company("333333333", "56.10A"), company("444444444", "68.32A"),
  ] });
  const ranked = sirene.rankProspects(companies, profile, origin, new Set(["444444444"]));
  assert.deepEqual([...ranked.map((p) => p.siren)], ["222222222", "111111111"]);
  assert.equal(ranked[0].segment, "architects");
  assert.ok(ranked[0].score > ranked[1].score && ranked[0].score <= 100);
  assert.ok(ranked[0].distanceKm < 2);
});

test("découverte de bout en bout avec API simulée, sans réseau réel", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.startsWith("https://geo.api.gouv.fr")) return { ok: true, status: 200, json: async () => [{ nom: "Lyon", code: "69123", codeDepartement: "69", centre: { type: "Point", coordinates: [4.835, 45.758] } }] };
    const naf = new URL(url).searchParams.get("activite_principale").split(",")[0];
    return { ok: true, status: 200, json: async () => ({ total_pages: 1, results: [company(String(100000000 + calls.length), naf)] }) };
  };
  const profile = prescribers.resolveTradeProfile("couvreur");
  const result = await sirene.discoverPrescribers({ profile, place: "Lyon", radiusKm: 15, maxPerSegment: 10, segments: ["architects", "property_managers"], fetchImpl, delayMs: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.location.codeInsee, "69123");
  assert.equal(result.prospects.length, 2);
  assert.equal(result.requests, 3);
  assert.ok(calls.every((u) => u.startsWith("https://geo.api.gouv.fr/") || u.startsWith("https://recherche-entreprises.api.gouv.fr/")));

  const failing = await sirene.discoverPrescribers({ profile, place: "Lyon", radiusKm: 15, maxPerSegment: 10, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }), delayMs: 0 });
  assert.deepEqual([failing.ok, failing.kind], [false, "temporary"]);
  const unknown = await sirene.discoverPrescribers({ profile, place: "Nulle-part", radiusKm: 15, maxPerSegment: 10, fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }), delayMs: 0 });
  assert.equal(unknown.kind, "location_not_found");
});
