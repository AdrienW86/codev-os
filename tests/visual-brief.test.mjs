// Brief visuel par client : métier, ambiance régionale, style des vraies photos, accroches génériques, photo de fond,
// auto-contrôle du rendu. Logique pure, aucun réseau.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, json } from "./helpers/ts-load.mjs";

const b = load("lib/visual-brief/model.ts");
const v = load("lib/visual-agent/model.ts");

test("trade detection: roofer, pest control, painter, beauty, digital, generic", () => {
  assert.equal(b.tradeDirection("Couvreur Nettoyage démoussage").key, "roofing");
  assert.equal(b.tradeDirection("Dératisation et désinsectisation").key, "pest");
  assert.equal(b.tradeDirection("Lutte anti-nuisibles").key, "pest");
  assert.equal(b.tradeDirection("Peintre").key, "painting");
  assert.equal(b.tradeDirection("Institut de beauté").key, "beauty");
  assert.equal(b.tradeDirection("Programmation Informatique Création de site web").key, "digital");
  assert.equal(b.tradeDirection("Boulangerie").key, "generic");
  assert.equal(b.tradeDirection("Couvreur — devis via le site").key, "roofing", "first matching trade wins");
  assert.equal(b.tradeDirection("Livraison via camion").key, "generic", "« via » is not « IA »");
});

test("regional cues come only from the client's area, never a precise place", () => {
  assert.match(b.regionalCues("Perpignan, Cabestany et Pyrénées-Orientales").join(" "), /Mediterranean/);
  assert.match(b.regionalCues("Narbonne et Aude").join(" "), /canal/);
  assert.match(b.regionalCues("Lyon et périphérie").join(" "), /Lyon area/);
  assert.match(b.regionalCues("Strasbourg").join(" "), /Alsace/);
  assert.deepEqual(json(b.regionalCues(null)), ["France", "typical French houses", "natural daylight"]);
});

test("brief: client facts and real photo descriptions, bounded and deduplicated; style suffix for the image generator", () => {
  const brief = b.buildVisualBrief({ name: "France Toiture", activity: "Couvreur", zone: "Perpignan", services: ["Zinguerie", "Zinguerie", "Démoussage"], activitySummary: "",
    guidelines: "Vouvoiement.", acceptedPhotoTypes: ["toitures"], excludedPhotoTypes: ["intérieurs"], exclusions: ["prix"], palette: { primary: "#3166b1", secondary: "#595858" }, hasLogo: true,
    realPhotos: [{ description: "Toiture en tuiles canal vue d'un échafaudage.", topics: ["toiture"] }, { description: "Toiture en tuiles canal vue d'un échafaudage.", topics: [] }] });
  assert.equal(brief.trade.key, "roofing");
  assert.deepEqual(json(brief.services), ["Zinguerie", "Démoussage"]);
  assert.equal(brief.realPhotoStyle.length, 1);
  const forPrompt = b.briefForPrompt(brief);
  assert.equal(forPrompt.metier, "Couverture et toiture");
  assert.match(forPrompt.charte.couleur_principale, /#3166b1 \(blue\)/);
  const suffix = b.imageStyleSuffix(brief);
  assert.match(suffix, /Mediterranean/); assert.match(suffix, /Must not show/); assert.match(suffix, /Vertical 2:3/); assert.match(suffix, /blue and grey/);
});

test("colour names for grading hints", () => {
  assert.equal(b.colorName("#07111f"), "dark blue");
  assert.equal(b.colorName("#111111"), "near-black");
  assert.equal(b.colorName("#4f8cff"), "blue");
  assert.equal(b.colorName("#ffffff"), "white");
  assert.equal(b.colorName("#c4683f"), "orange");
  assert.equal(b.colorName("nope"), "neutral");
});

test("angles rotate through the trade's list", () => {
  const trade = b.tradeDirection("Couvreur");
  assert.equal(b.nextAngle(trade, 0), trade.angles[0]);
  assert.equal(b.nextAngle(trade, trade.angles.length + 1), trade.angles[1]);
});

const facts = "France Toiture\nCouvreur\nPerpignan\nDémoussage";
test("headlines: generic openers and repeated openings are refused, with a reason the writer can use", () => {
  const r = v.checkCopy({ headline: "Attirez plus de clients avec un toit propre", subline: "" }, facts, []);
  assert.equal(r.ok, false); assert.match(r.reason, /générique/);
  assert.equal(v.checkCopy({ headline: "Boostez votre toiture", subline: "" }, facts, []).ok, false);
  assert.equal(v.checkCopy({ headline: "De la mousse sur vos tuiles ?", subline: "" }, facts, ["De la mousse partout sur le toit"]).ok, false, "same opening as a recent headline");
  assert.equal(v.checkCopy({ headline: "De la mousse sur vos tuiles ?", subline: "" }, facts, ["a", "b", "c", "d", "e", "De la mousse partout"]).ok, true, "only the last five count");
  assert.equal(v.checkCopy({ headline: "Une tuile cassée laisse passer l’eau", subline: "" }, facts, []).ok, true);
});

const photo = (over = {}) => ({ id: "p1", description: "Toiture en tuiles avec de la mousse verte.", topics: ["démoussage", "toiture"], quality: "good", qualityIssues: [], sensitive: [], width: 1600, height: 1200, importedAt: "2026-11-20T10:00:00Z", ...over });
test("background photo: real, good, no sensitive content, relevant to the service, rotated among the best three", () => {
  assert.equal(v.pickBackgroundPhoto("Nettoyage démoussage", [photo()], 0).id, "p1");
  assert.equal(v.pickBackgroundPhoto("Zinguerie et gouttières", [photo()], 0), null, "no shared word: graphic visual instead");
  assert.equal(v.pickBackgroundPhoto("Démoussage", [photo({ sensitive: ["face"] })], 0), null);
  assert.equal(v.pickBackgroundPhoto("Démoussage", [photo({ quality: "acceptable" })], 0), null);
  assert.equal(v.pickBackgroundPhoto("Démoussage", [photo({ qualityIssues: ["blurry"] })], 0), null);
  assert.equal(v.pickBackgroundPhoto("Démoussage", [photo({ width: 640, height: 480 })], 0), null, "too small for 1080 px");
  const list = [photo({ id: "a" }), photo({ id: "b" }), photo({ id: "c" }), photo({ id: "d", topics: [] })];
  assert.deepEqual([0, 1, 2, 3].map(i => v.pickBackgroundPhoto("Démoussage toiture", list, i).id), ["a", "b", "c", "a"]);
});

test("render self-check: score 70+, legible and matching photo; unreadable output is null", () => {
  assert.equal(v.readVisualReview({ score: 82, legible: true, photo_matches_service: true, issues: [] }).pass, true);
  assert.equal(v.readVisualReview({ score: 82, legible: true, photo_matches_service: null, issues: [] }).pass, true, "graphic visual");
  assert.equal(v.readVisualReview({ score: 82, legible: false, photo_matches_service: true, issues: ["texte coupé"] }).pass, false);
  assert.equal(v.readVisualReview({ score: 82, legible: true, photo_matches_service: false, issues: [] }).pass, false);
  assert.equal(v.readVisualReview({ score: 55, legible: true, photo_matches_service: true, issues: [] }).pass, false);
  assert.equal(v.readVisualReview({ legible: true, issues: [] }), null);
});

test("visual agent wiring: brief, real photo, self-check before the Drive deposit", () => {
  const service = readFileSync("lib/visual-agent/service.ts", "utf8");
  assert.match(service, /pickBackgroundPhoto\(service,photos,items\.length\)/);
  assert.match(service, /reviewVisual\(png,brief,service,copy\.headline/);
  assert.ok(service.indexOf("reviewVisual(png") < service.indexOf("uploadDrive("), "checked before deposit");
  assert.match(service, /Visuel écarté par le contrôle qualité/);
});
