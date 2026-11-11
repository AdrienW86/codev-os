import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const prescribers = loadTs("lib/acquisition/prescribers.ts");
const sirene = loadTs("lib/acquisition/sirene.ts", { "./prescribers": prescribers });
const naf = loadTs("lib/acquisition/naf.ts");
const zone = loadTs("lib/acquisition/zone-scan.ts", { "./naf": naf, "./sirene": sirene });
const website = loadTs("lib/acquisition/website.ts");
const osm = loadTs("lib/acquisition/osm.ts", { "./prescribers": prescribers, "./website": website });
const bodacc = loadTs("lib/acquisition/bodacc.ts");
const csv = loadTs("lib/acquisition/csv.ts", { "./prescribers": prescribers });
const json = (v) => JSON.parse(JSON.stringify(v));

test("nomenclature NAF : 732 sous-classes, toutes rattachées à une section", () => {
  assert.equal(naf.NAF_CODES.length, 732);
  const total = naf.NAF_SECTIONS.reduce((n, s) => n + naf.nafCodesOfSection(s).length, 0);
  assert.equal(total, 732);
  assert.equal(naf.sectionOfNaf("69.20Z"), "M");
  assert.equal(naf.sectionOfNaf("68.20B"), "L");
  assert.deepEqual([...naf.NON_OPERATING_NAF], ["68.20B", "64.20Z"]);
});

const company = (siren, nafCode, extra = {}) => ({
  siren, nom_complet: `Société ${siren}`, etat_administratif: "A", activite_principale: nafCode, tranche_effectif_salarie: "01",
  complements: { est_entrepreneur_individuel: false },
  matching_etablissements: [{ siret: `${siren}00011`, activite_principale: nafCode, adresse: "1 rue X 67000 STRASBOURG", code_postal: "67000", libelle_commune: "STRASBOURG", latitude: "48.57", longitude: "7.76" }],
  ...extra,
});

test("balayage de zone : découpe une section au-delà de 10 000 résultats, respecte exclusions et plafond", async () => {
  const urls = [];
  let n = 100000000;
  const fetchJson = async (url) => {
    urls.push(url);
    const p = new URL(url).searchParams;
    const section = p.get("section_activite_principale");
    if (section === "L") return { total_results: 10000, total_pages: 400, results: [] };
    if (section) return { total_results: 30, total_pages: 2, results: section === "M" ? [company(String(n++), "69.20Z"), company(String(n++), "69.20Z", { complements: { est_entrepreneur_individuel: true } })] : [] };
    const code = p.get("activite_principale");
    if (code === "68.31Z") return { total_results: 10000, total_pages: 400, results: [company(String(n++), "68.31Z")] };
    return { total_results: 0, total_pages: 0, results: [] };
  };
  const options = { excludeNonOperating: true, excludeSoleProprietors: true, maxCompanies: 1000 };
  let state = zone.initialZoneScan({ lat: 48.57, lon: 7.76, radiusKm: 80 });
  assert.equal(state.radiusKm, 50);
  const kept = [];
  for (let i = 0; i < 2000 && !zone.zoneScanDone(state, options); i++) {
    const step = await zone.zoneScanStep(state, options, fetchJson);
    state = step.state; kept.push(...step.companies);
  }
  assert.ok(zone.zoneScanDone(state, options));
  // Section L découpée en sous-classes, sans la SCI 68.20B exclue par défaut.
  assert.ok(urls.some((u) => u.includes("activite_principale=68.31Z")));
  assert.ok(!urls.some((u) => u.includes("activite_principale=68.20B")));
  assert.deepEqual(json(state.truncated), ["68.31Z"]);
  // Entrepreneur individuel exclu à la demande.
  assert.ok(kept.every((c) => !c.isSoleProprietor));
  assert.ok(urls.every((u) => u.startsWith("https://recherche-entreprises.api.gouv.fr/near_point?") && u.includes("etat_administratif=A")));

  let capped = zone.initialZoneScan({ lat: 48.57, lon: 7.76, radiusKm: 5 });
  const small = { ...options, excludeSoleProprietors: false, maxCompanies: 1 };
  while (!zone.zoneScanDone(capped, small)) capped = (await zone.zoneScanStep(capped, small, fetchJson)).state;
  assert.equal(capped.collected, 1);
});

test("OpenStreetMap : requête bornée, URL et e-mails filtrés, rapprochement SIRET puis nom + code postal", () => {
  const q = osm.buildOverpassQuery({ lat: 48.57, lon: 7.76, radiusKm: 99 });
  assert.match(q, /around:50000,48.57,7.76/);
  assert.match(q, /\[out:json\]/);
  const places = osm.parseOverpass({ elements: [
    { type: "node", id: 1, tags: { name: "Cabinet Martin", office: "accountant", "ref:FR:SIRET": "123 456 789 00011", website: "cabinet-martin.fr", email: "jean.martin@cabinet-martin.fr" } },
    { type: "way", id: 2, tags: { name: "Boulangerie Dupont SARL", shop: "bakery", "addr:postcode": "67000", phone: "03 88 00 00 00", website: "javascript:alert(1)", email: "contact@boulangerie-dupont.fr" } },
    { type: "node", id: 3, tags: { name: "Sans contact", shop: "florist" } },
  ] });
  assert.equal(places[0].siret, "12345678900011");
  assert.equal(places[0].website, "https://cabinet-martin.fr/");
  assert.equal(places[0].email, null, "adresse nominative refusée");
  assert.equal(places[1].website, null);
  assert.equal(places[1].email, "contact@boulangerie-dupont.fr");
  const matches = osm.matchOsm([
    { id: "a", siren: "123456789", siret: null, name: "CABINET MARTIN", postalCode: "67100" },
    { id: "b", siren: "987654321", siret: null, name: "BOULANGERIE DUPONT", postalCode: "67000" },
    { id: "c", siren: "111111111", siret: null, name: "Homonyme", postalCode: "67000" },
    { id: "d", siren: "222222222", siret: null, name: "Homonyme", postalCode: "67000" },
  ], [...places, { ref: "node/9", name: "Homonyme", siret: null, postcode: "67000", city: null, website: null, phone: "1", email: null }]);
  assert.equal(matches.get("a").ref, "node/1");
  assert.equal(matches.get("b").ref, "way/2");
  assert.ok(!matches.has("c") && !matches.has("d"), "homonymes ambigus non rapprochés");
});

test("BODACC : requête de créations par département, SIREN extrait", () => {
  const url = new URL(bodacc.buildBodaccUrl({ departement: "67", since: "2025-11-10", offset: 200 }));
  assert.equal(url.origin, "https://bodacc-datadila.opendatasoft.com");
  assert.match(url.searchParams.get("where"), /familleavis="creation" AND numerodepartement="67" AND dateparution>=date'2025-11-10'/);
  assert.equal(url.searchParams.get("offset"), "200");
  assert.match(new URL(bodacc.buildBodaccUrl({ departement: "67\" OR 1=1", since: "x", offset: 0 })).searchParams.get("where"), /numerodepartement="671"/);
  const parsed = bodacc.parseBodacc({ total_count: 2, results: [
    { registre: ["123 456 789", "123456789"], dateparution: "2026-10-01", url_complete: "https://www.bodacc.fr/annonce/1", commercant: "ACME" },
    { registre: "pas de numéro", dateparution: "2026-10-02" },
  ] });
  assert.equal(parsed.total, 2);
  assert.deepEqual(json(parsed.creations), [{ siren: "123456789", publishedOn: "2026-10-01", url: "https://www.bodacc.fr/annonce/1", name: "ACME" }]);
});

test("sites web : e-mails génériques du domaine uniquement, robots.txt, SIREN et mentions légales", async () => {
  assert.equal(website.genericBusinessEmail("Contact@Acme.fr", "https://www.acme.fr"), "contact@acme.fr");
  assert.equal(website.genericBusinessEmail("jean.dupont@acme.fr", "https://acme.fr"), null);
  assert.equal(website.genericBusinessEmail("contact@agence-web.fr", "https://acme.fr"), null, "adresse d'un prestataire refusée");
  assert.equal(website.genericBusinessEmail("info-strasbourg@acme.fr", null), "info-strasbourg@acme.fr");
  assert.equal(website.robotsAllows("User-agent: *\nDisallow: /", "/"), false);
  assert.equal(website.robotsAllows("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin", "/"), true);
  assert.equal(website.robotsAllows("User-agent: *\nDisallow: /mentions", "/mentions-legales"), false);
  assert.equal(website.robotsAllows(null, "/"), true);
  assert.deepEqual([...website.extractSirens("<p>SIRET : 123 456 789 00011</p><p>RCS Strasbourg 987654321</p>")].sort(), ["123456789", "987654321"]);
  assert.equal(website.legalPageUrl('<a href="/mentions-legales">Mentions légales</a>', "https://acme.fr/"), "https://acme.fr/mentions-legales");
  assert.equal(website.legalPageUrl('<a href="https://autre.fr/legal">Legal</a>', "https://acme.fr/"), null);
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "169.254.169.254", "172.20.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.ok(website.isPrivateAddress(ip), ip);
  assert.ok(!website.isPrivateAddress("93.184.216.34"));

  const pages = {
    "https://acme.fr/robots.txt": { ok: true, status: 200, text: "User-agent: *\nDisallow: /private" },
    "https://acme.fr/": { ok: true, status: 200, text: '<a href="mailto:jean@acme.fr">Jean</a><a href="/mentions-legales">Mentions légales</a>' },
    "https://acme.fr/mentions-legales": { ok: true, status: 200, text: "Éditeur : ACME SAS, SIREN 123 456 789. Écrire à contact&#64;acme.fr" },
  };
  const seen = [];
  const fetchPage = async (url) => { seen.push(url); const p = pages[url]; return p ? { ...p, finalUrl: url } : { ok: false, status: 404, text: "", finalUrl: url }; };
  const result = await website.checkWebsite("https://acme.fr/", fetchPage);
  assert.equal(result.status, "ok");
  assert.equal(result.email, "contact@acme.fr");
  assert.equal(result.emailSourceUrl, "https://acme.fr/mentions-legales");
  assert.deepEqual([...result.sirens], ["123456789"]);
  assert.ok(seen.length <= 3, "au plus 3 requêtes par site");
  const blocked = await website.checkWebsite("https://acme.fr/", async (url) => url.endsWith("robots.txt") ? { ok: true, status: 200, text: "User-agent: *\nDisallow: /", finalUrl: url } : assert.fail("ne doit pas lire la page"));
  assert.equal(blocked.status, "robots_disallowed");
});

test("export CSV : e-mail, création BODACC et attribution OpenStreetMap", () => {
  const out = csv.prospectsToCsv([{ company_name: "ACME", segment: null, score: 40, distance_km: 1, address: "", postal_code: "67000", city: "STRASBOURG", siren: "123456789", naf_code: "62.01Z", website: null, osm_website: "https://acme.fr/", osm_phone: "03 88", contact_email: "contact@acme.fr", bodacc_created_on: "2026-10-01", explanation: "x", source_url: "https://annuaire-entreprises.data.gouv.fr/entreprise/123456789" }]);
  assert.match(out.split("\r\n")[0], /E-mail générique;Création \(BODACC\);.*Sources des données/);
  const line = out.split("\r\n")[1];
  assert.match(line, /https:\/\/acme\.fr\/;03 88;contact@acme\.fr;2026-10-01;/);
  assert.match(line, /© contributeurs OpenStreetMap \(ODbL\)/);
});

test("migration additive, une seule recherche active par client, garde-fous serveur", () => {
  const sql = readFileSync("supabase/migrations/20261204000000_acquisition_multisource.sql", "utf8");
  assert.doesNotMatch(sql, /drop table|drop column|truncate|delete from/i);
  assert.match(sql, /'zone_company'/);
  assert.match(sql, /acquisition_discovery_runs_one_active_idx[\s\S]*where status in \('queued','running','enriching'\)/);
  assert.match(sql, /contact_email text\s+check/);
  for (const f of ["lib/acquisition/background.ts", "lib/acquisition/safe-fetch.ts"]) assert.match(readFileSync(f, "utf8"), /^import "server-only";/);
  const safe = readFileSync("lib/acquisition/safe-fetch.ts", "utf8");
  assert.match(safe, /lookup: guardedLookup/);
  assert.match(safe, /isPrivateAddress/);
  const actions = readFileSync("app/(cockpit)/acquisition/actions.ts", "utf8");
  for (const name of ["queueZoneScanAction", "cancelDiscoveryRunAction"]) {
    assert.match(actions, new RegExp(`export async function ${name}\\(data: FormData\\) \\{\\n  await requireAdmin\\(\\);`), name);
  }
  const tick = readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8");
  assert.match(tick, /step\("acquisition_discovery", \(\) => runAcquisitionDiscoveryTick\(\{ deadline \}\)/);
  assert.ok(tick.indexOf('step("acquisition_discovery"') < tick.indexOf('step("video_agent"'));
  // Aucune source dont les CGU interdisent l'extraction.
  for (const f of ["lib/acquisition/background.ts", "lib/acquisition/osm.ts", "lib/acquisition/bodacc.ts", "lib/acquisition/website.ts", "lib/acquisition/zone-scan.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /pagesjaunes|linkedin|societe\.com|infogreffe|google\.[a-z]+\/maps/i, f);
  }
});

test("enchaînement des phases selon les sources choisies", () => {
  const background = loadTs("lib/acquisition/background.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => ({}) }, "./prescribers": prescribers, "./sirene": sirene, "./zone-scan": zone,
    "./osm": osm, "./bodacc": bodacc, "./website": website, "./safe-fetch": { safeFetchPage: async () => null },
  });
  assert.equal(background.nextPhase("sirene_zone"), "osm");
  assert.equal(background.nextPhase("sirene_zone", ["websites"]), "websites");
  assert.equal(background.nextPhase("osm", ["osm", "bodacc"]), "bodacc");
  assert.equal(background.nextPhase("bodacc", ["osm", "bodacc"]), "done");
  assert.equal(background.nextPhase("sirene_zone", []), "done");
});
