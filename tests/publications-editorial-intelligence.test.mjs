// Socle Publications, PR #42 — intelligence éditoriale de l'Agent v2 (règles pures, contexte, read models, panneau).
// Clients d'exemple fictifs (CODE-V, JRenov, Couverture Catalane, Protection Nuisibles). Aucun réseau, aucune IA réelle.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json, uid } from "./helpers/ts-load.mjs";

const text = load("lib/publications/editorial-text.ts");
const memory = load("lib/publications/editorial-memory.ts");
const photos = load("lib/publications/editorial-photos.ts");
const places = load("lib/publications/editorial-places.ts");
const planMod = load("lib/publications/editorial-plan.ts");
const guards = load("lib/publications/editorial-guards.ts");
const justif = load("lib/publications/editorial-justification.ts");
const pool = load("lib/publications/agent-v2/library-pool.ts");
const sel = load("lib/publications/agent-v2/selection.ts");
const prompt = load("lib/publications/agent-v2/prompt.ts");

const C = uid("1", 42), P = uid("3", 42), A = n => uid("a", n), PUB = n => uid("4", n), REV = n => uid("6", n);
const now = new Date("2026-10-13T08:00:00Z");
const occ = (n, platform) => ({ occurrenceId: uid("5", n), projectId: P, clientId: C, platform, date: "2026-10-14", time: "12:00", timezone: "Europe/Paris", scheduledFor: `2026-10-14T1${n}:00:00Z` });
const batch = [occ(1, "facebook"), occ(2, "instagram"), occ(3, "google_business_profile")];
const roofServices = ["Démoussage", "Zinguerie", "Rénovation de toiture", "Réparation de faîtage"];
const pub = (n, subject, extra = {}) => ({ id: PUB(n), subject, current_revision_id: REV(n), status: "approved", archived_at: null, platform: "facebook", created_at: `2026-10-${String(12 - n).padStart(2, "0")}T08:00:00Z`, ...extra });
const variant = (n, platform, text_content, cta = null) => ({ publication_id: PUB(n), revision_id: REV(n), platform, text_content, metadata: cta ? { cta } : {} });
const media = (id, description, categories = ["toiture"], extra = {}) => ({ id, categories, description, used: false, source: "library", ...extra });

// Historique de Couverture Catalane : deux démoussages de suite, puis d'autres idées plus anciennes.
const historyRows = [pub(1, "Démoussage avant l’hiver"), pub(2, "Le démoussage en trois étapes"), pub(3, "Zinguerie : gouttières dégagées"), pub(4, "Rénovation de toiture en tuiles"),
  pub(5, "Refusée", { status: "rejected" }), pub(6, "Brouillon abandonné", { status: "draft", archived_at: "2026-10-01T00:00:00Z" }), pub(7, "Faîtage refait à neuf")];
const historyVariants = [
  variant(1, "facebook", "Pourquoi démousser sa toiture avant l’hiver ? La mousse retient l’humidité sur les tuiles.", "Contactez-nous pour en parler."),
  variant(1, "instagram", "Toiture sans mousse, tuiles protégées. #toiture"),
  variant(2, "facebook", "Pourquoi démousser en trois étapes ? Brossage, traitement puis hydrofuge sur les tuiles.", "Contactez-nous pour en savoir plus."),
  variant(3, "facebook", "Des gouttières dégagées évacuent l’eau loin des murs de la maison et protègent la façade.", "Écrivez-nous en message privé."),
  variant(4, "facebook", "Une toiture rénovée protège la maison pour longtemps et valorise le bâti.", null),
  variant(7, "facebook", "Le faîtage maintient les tuiles du sommet de la toiture face au vent.", null)];
const history = memory.buildEditorialHistory({ publications: historyRows, variants: historyVariants, libraryUses: [{ asset_id: A(1), publication_id: PUB(1), used_at: "2026-10-11T08:00:00Z" }], catalogUses: [], services: roofServices });

test("historique éditorial : idées proposées seulement, prestations, styles, photos, dates et plateformes", () => {
  assert.deepEqual(json(history.map(h => h.subject)), ["Démoussage avant l’hiver", "Le démoussage en trois étapes", "Zinguerie : gouttières dégagées", "Rénovation de toiture en tuiles", "Faîtage refait à neuf"]);
  assert.deepEqual(json(history[0].services), ["Démoussage"]);
  assert.deepEqual(json(history[2].services), ["Zinguerie"]);
  assert.deepEqual(json(history[0].platforms), ["facebook", "instagram"]);
  assert.equal(history[0].introStyles[0], "question");
  assert.equal(history[0].ctaStyles[0], "contact");
  assert.deepEqual(json(history[0].photos), [{ source: "library", id: A(1) }]);
  assert.equal(history[0].date, "2026-10-11T08:00:00Z");
  assert.equal(memory.buildEditorialHistory({ publications: historyRows, variants: [], libraryUses: [], catalogUses: [], services: [] }, 2).length, 2, "bounded");
  assert.deepEqual(json(memory.recurringPhrases(history)), [], "no 4-word sequence shared by two ideas");
  const tics = memory.buildEditorialHistory({ publications: [pub(1, "A"), pub(2, "B")], variants: [variant(1, "facebook", "N’hésitez pas à nous contacter pour vos tuiles."), variant(2, "facebook", "Gouttières : n’hésitez pas à nous contacter.")], libraryUses: [], catalogUses: [], services: [] });
  assert.deepEqual(json(memory.recurringPhrases(tics)), ["hesitez pas a nous", "n hesitez pas a", "pas a nous contacter"]);
});

test("styles d'accroche et de CTA : classement déterministe et rotation par pool", () => {
  assert.equal(text.introStyleOf("Saviez-vous que la mousse abîme les tuiles ?"), "question");
  assert.equal(text.introStyleOf("Pensez à vérifier vos gouttières. Elles débordent vite."), "conseil");
  assert.equal(text.introStyleOf("Voici une toiture en tuiles canal."), "presentation");
  assert.equal(text.introStyleOf("Belle journée pour les toitures !"), "exclamation");
  assert.equal(text.introStyleOf("La mousse retient l’humidité."), "constat");
  assert.equal(text.ctaStyleOf("Appelez-nous"), "appel");
  assert.equal(text.ctaStyleOf("Écrivez-nous en message privé"), "message");
  assert.equal(text.ctaStyleOf("Demandez conseil à notre équipe"), "conseil");
  assert.equal(text.ctaStyleOf(null), "aucun");
  assert.equal(text.nextInPool(text.CTA_STYLES, ["contact", "message"]), "conseil", "never used first");
  assert.equal(text.nextInPool(["a", "b"], ["a", "b"]), "b", "least recently used");
});

test("plan : rotation des prestations illustrées, prestations écartées avec motif, saisonnalité douce", () => {
  const candidates = [media(A(2), "Gouttière en zinc le long d’un toit."), media(A(3), "Tuiles faîtières sur le sommet d’un toit."), media(A(4), "Toiture couverte de mousse.")];
  const plan = planMod.buildEditorialPlan({ history, services: roofServices, media: candidates, priorityTopics: [], zone: "Perpignan, Narbonne et alentours", now });
  assert.deepEqual(json(plan.deprioritised.map(d => d.service)), ["Démoussage"]);
  assert.match(plan.deprioritised[0].reason, /dernière publication \(2026-10-11\)/);
  assert.deepEqual(json(plan.favouredServices), ["Réparation de faîtage", "Zinguerie"], "faîtage less recent than zinguerie; démoussage excluded");
  assert.deepEqual(json(plan.servicesWithoutPhoto), ["Rénovation de toiture"]);
  assert.deepEqual(json(plan.seasonalPreference), ["Démoussage", "Zinguerie"], "October map applied to the client's services only");
  assert.deepEqual(json(planMod.seasonalPreference(["Création de site"], 10)), [], "nothing invented for a web agency");
  assert.deepEqual(json(plan.allowedPlaces), ["Perpignan", "Narbonne"]);
  assert.equal(plan.ctaStyle, "conseil", "CTA rotation: contact and message used recently");
  assert.ok(plan.avoidOpenings.includes("pourquoi demousser sa toiture avant l"));
  // Le prompt n'en fait qu'une préférence, jamais un fait.
  assert.match(prompt.AGENT_V2_INSTRUCTIONS, /seasonal_preference_soft : simple préférence de calendrier pour départager les prestations, JAMAIS un fait/);
});

const input = (extra = {}) => {
  const m = [media(A(2), "Gouttière en zinc le long d’un toit.", ["toiture"], { services: ["Zinguerie"] }), media(A(4), "Toiture couverte de mousse.", ["toiture"], { services: ["Démoussage"] })];
  const base = { client: { name: "Couverture Catalane", activity: "Couvreur", zone: "Perpignan" }, project: { name: "Réseaux" }, services: roofServices, rules: "", channelRules: [], occurrences: batch, media: m,
    previousSubjects: history.slice(0, 3).map(h => h.subject), previousPublications: history.slice(0, 3).map(h => ({ subject: h.subject, texts: [], media: null })), priorityTopics: [] };
  const i = { ...base, ...extra };
  return { ...i, editorial: { history, plan: planMod.buildEditorialPlan({ history, services: i.services, media: i.media, zone: i.client.zone, now }) } };
};
const zinc = ["Saviez-vous qu’une gouttière bouchée fait déborder l’eau contre les murs ?", "Gouttière en zinc posée au cordeau. #zinguerie #toiture", "Zinguerie : pose et entretien de gouttières en zinc."];
const variants = (texts, mediaId = A(2), ctas = [null, null, null]) => batch.map((o, i) => ({ occurrenceId: o.occurrenceId, platform: o.platform, text: texts[i], cta: ctas[i], mediaId }));
const idea = { subject: "Gouttières en zinc avant les pluies", angle: "Une zinguerie entretenue protège les murs." };
const check = (output, i = input()) => json(sel.validateGeneratorOutput(i, output));

test("anti-répétition au-delà des 3 dernières idées : sujet, formulation, accroche, CTA, style et formulation récurrente", () => {
  assert.equal(check({ idea, publications: variants(zinc) }).ok, true);
  const old = check({ idea: { subject: "Faîtage refait à neuf", angle: "Le faîtage." }, publications: variants(zinc) });
  assert.equal(old.reason, "repetition"); assert.match(old.detail, /sujet déjà traité le 2026-10-05/, "5th idea, beyond the last 3");
  const near = check({ idea: { subject: "Rénovation de toiture en tuiles canal", angle: "x" }, publications: variants(zinc) });
  assert.equal(near.reason, "repetition", "very close subject");
  const wording = check({ idea, publications: variants([zinc[0], zinc[1], "Une toiture rénovée protège la maison pour longtemps et valorise le bâti ancien."]) });
  assert.deepEqual([wording.reason, wording.detail], ["repetition", "formulation trop proche de « Rénovation de toiture en tuiles »"]);
  const opening = check({ idea, publications: variants([zinc[0], zinc[1], "Le faîtage maintient les tuiles du sommet : ici, une gouttière en zinc."]) });
  assert.deepEqual([opening.reason, opening.detail], ["intro_repetition", "accroche déjà employée : « le faitage maintient les tuiles du »"]);
  const cta = check({ idea, publications: variants(zinc, A(2), ["Écrivez-nous en message privé.", null, null]) });
  assert.equal(cta.reason, "cta_repetition"); assert.match(cta.detail, /déjà employé/);
  // Même style de CTA une 3e fois de suite (contact, contact) : refusé ; un autre style passe.
  assert.equal(check({ idea, publications: variants(zinc, A(2), ["Contactez-nous dès maintenant.", null, null]) }).reason, "cta_repetition");
  assert.equal(check({ idea, publications: variants(zinc, A(2), ["Demandez conseil à l’équipe.", null, null]) }).ok, true);
  // Même style d'accroche (question) que les 3 dernières idées sur toutes les plateformes : refusé.
  const q = memory.buildEditorialHistory({ publications: [pub(1, "Un"), pub(2, "Deux"), pub(3, "Trois")], variants: [variant(1, "facebook", "Et la mousse ?"), variant(2, "facebook", "Et le zinc ?"), variant(3, "facebook", "Et le faîtage ?")], libraryUses: [], catalogUses: [], services: roofServices });
  const allQuestions = ["Une gouttière bouchée ?", "Zinc ou PVC ? #zinguerie", "Gouttières : entretien ou remplacement ?"];
  const qi = { ...input(), editorial: { history: q, plan: planMod.buildEditorialPlan({ history: q, services: roofServices, media: [], zone: null, now }) }, previousSubjects: [], previousPublications: [] };
  assert.equal(guards.historyRefusal({ idea, publications: variants(allQuestions) }, qi.editorial).reason, "intro_repetition");
  assert.equal(guards.historyRefusal({ idea, publications: variants([allQuestions[0], allQuestions[1], "Gouttières : entretien et remplacement."]) }, qi.editorial), null, "one platform varies");
  // Formulation récurrente signalée au modèle.
  const tics = memory.buildEditorialHistory({ publications: [pub(1, "A"), pub(2, "B")], variants: [variant(1, "facebook", "N’hésitez pas à nous contacter pour vos tuiles."), variant(2, "facebook", "Gouttières : n’hésitez pas à nous contacter.")], libraryUses: [], catalogUses: [], services: [] });
  const tp = planMod.buildEditorialPlan({ history: tics, services: [], media: [], zone: null, now });
  assert.equal(guards.historyRefusal({ idea, publications: variants([zinc[0] + " N’hésitez pas à nous contacter.", zinc[1], zinc[2]]) }, { history: tics, plan: tp }).reason, "phrase_repetition");
});

test("rotation : jamais 3 démoussages de suite quand une photo permet une autre prestation", () => {
  const again = { idea: { subject: "Démoussage des tuiles canal", angle: "Retirer la mousse." }, publications: variants(["Retirer la mousse évite les infiltrations sous les tuiles.", "Tuiles nettes, sans mousse. #toiture", "Démoussage : brossage et nettoyage des tuiles."], A(4)) };
  assert.equal(check(again).reason, "repetition", "3rd consecutive démoussage refused (zinguerie photo available)");
  const noAlternative = input({ media: [media(A(4), "Toiture couverte de mousse.", ["toiture"], { services: ["Démoussage"] })] });
  assert.equal(sel.repeatsService(again.idea.subject, noAlternative), false, "no other illustrated service: allowed");
  assert.equal(sel.repeatsService(again.idea.subject, { ...input(), previousPublications: [{ subject: "Démoussage", texts: [], media: null }, { subject: "Zinguerie", texts: [], media: null }] }), false, "not consecutive");
});

test("lieux : seuls ceux des données du client, refus déterministe d'un lieu inventé", () => {
  assert.deepEqual(json(places.allowedPlaces("Perpignan, Narbonne et alentours")), ["Perpignan", "Narbonne"]);
  assert.deepEqual(json(places.allowedPlaces(null)), []);
  const facts = sel.factsOf(input());
  assert.deepEqual(json(places.unsupportedPlaces("Intervention possible à Perpignan et sur Béziers.", facts)), ["Béziers"]);
  assert.deepEqual(json(places.unsupportedPlaces("Toulouse : gouttières en zinc.", facts)), ["Toulouse"], "known city without preposition");
  assert.deepEqual(json(places.unsupportedPlaces("Dans les Pyrénées-Orientales, la tramontane souffle.", facts)), ["Pyrénées-Orientales"]);
  assert.deepEqual(json(places.unsupportedPlaces("Isolation en PVC, à Noël comme en Mai, sur Facebook.", facts)), [], "acronyms, holidays, months and platforms are not places");
  assert.deepEqual(json(places.unsupportedPlaces("Partout en France.", facts)), ["France"]);
  const bad = check({ idea, publications: variants([zinc[0], zinc[1], "Zinguerie à Narbonne : pose et entretien de gouttières en zinc."]) });
  assert.deepEqual([bad.reason, bad.detail], ["place_not_allowed", "lieu absent des données du client : Narbonne"]);
  assert.equal(check({ idea, publications: variants([zinc[0], zinc[1], "Zinguerie à Perpignan : pose et entretien de gouttières en zinc."]) }).ok, true, "the client's zone may be named");
  const noZone = input({ client: { name: "Couverture Catalane", activity: "Couvreur", zone: null } });
  assert.equal(check({ idea, publications: variants([zinc[0], zinc[1], "Zinguerie à Perpignan : pose et entretien de gouttières en zinc."]) }, noZone).reason, "place_not_allowed", "no zone: no place");
});

test("photos : jamais un document pour une intervention (Protection Nuisibles), prestation de la photo = prestation du sujet", () => {
  const row = (n, extra = {}) => ({ id: A(n), library_status: "validated", media_kind: "image", mime_type: "image/jpeg", size: 200000, width: 1600, height: 1200, purged_at: null, imported_at: `2026-10-0${n}T08:00:00Z`, claimed_agent_v2_run_id: null, sha256: String(n).repeat(64).slice(0, 64), ...extra });
  const a = (n, description, topics = [], extra = {}) => ({ asset_id: A(n), verdict: "relevant", confidential: false, sensitive: [], manual_verdict: "relevant", description, topics, quality: "good", quality_issues: [], business_relevance: 0.9, publishability: 0.9, ...extra });
  const rows = [row(1), row(2), row(3), row(4), row(5)];
  const assessed = [a(1, "Attestation de traitement posée sur un bureau."), a(2, "Piège à rats le long d’un mur de cave.", ["dératisation"]), a(3, "Nid de guêpes sous une toiture.", ["désinsectisation"]),
    a(4, "Facture d’intervention."), a(5, "Photo d’un écran affichant un planning.", [], { quality_issues: ["screenshot"] })];
  const ids = pool.libraryCandidates(rows, assessed, [], { allowed: false, afterDays: 180 }, new Set(), now).map(c => c.id).sort();
  assert.deepEqual(json(ids), [A(2), A(3)], "certificate, invoice and screen never proposed, even when validated by a human");
  assert.equal(photos.isDocumentPhoto({ description: "Certificat de traitement", topics: [] }), true);
  assert.equal(photos.isDocumentPhoto({ description: "Rat dans une cave", sensitive: [] }), false);
  const services = ["Dératisation", "Désinsectisation"];
  const rat = media(A(2), "Piège à rats le long d’un mur de cave.", ["dératisation"]), wasp = media(A(3), "Nid de guêpes sous une toiture.", ["désinsectisation"]);
  assert.equal(photos.photoMatchesSubject("Dératisation d’une cave", rat, services), true);
  assert.equal(photos.photoMatchesSubject("Dératisation d’une cave", wasp, services), false);
  assert.equal(photos.photoMatchesSubject("Conseils d’hygiène", wasp, services), true, "no service in the subject: no refusal");
  const pn = { client: { name: "Protection Nuisibles", activity: "Dératisation et désinsectisation", zone: null }, project: { name: "Réseaux" }, services, rules: "", channelRules: [], occurrences: batch, media: [rat, wasp, media(A(9), "Attestation de traitement.", ["document"])], previousSubjects: [], previousPublications: [], priorityTopics: [] };
  const texts = ["Les rats laissent des traces le long des murs : un piège bien placé les arrête.", "Cave protégée des rongeurs. #deratisation", "Dératisation : pose de pièges dans les caves."];
  const subject = { subject: "Dératisation d’une cave", angle: "Les pièges se posent le long des murs." };
  assert.equal(check({ idea: subject, publications: variants(texts, A(2)) }, pn).ok, true);
  assert.deepEqual(json(sel.validateGeneratorOutput(pn, { idea: subject, publications: variants(texts, A(3)) })).reason, "photo_mismatch");
  assert.deepEqual(json(sel.validateGeneratorOutput(pn, { idea: subject, publications: variants(texts, A(9)) })).reason, "document_photo");
});

test("mémoire visuelle : photo utilisée et ses doublons exacts jamais reproposés, sauf réemploi autorisé ; un seul doublon proposé", () => {
  const row = (n, sha, extra = {}) => ({ id: A(n), library_status: "validated", media_kind: "image", mime_type: "image/jpeg", size: 200000, width: 1600, height: 1200, purged_at: null, imported_at: `2026-10-0${n}T08:00:00Z`, claimed_agent_v2_run_id: null, sha256: sha, ...extra });
  const rows = [row(1, "a".repeat(64)), row(2, "a".repeat(64)), row(3, "b".repeat(64)), row(4, "b".repeat(64)), row(5, "c".repeat(64))];
  const uses = [{ asset_id: A(1), publication_id: PUB(1), used_at: "2026-08-01T00:00:00Z" }];
  const expanded = photos.usesWithDuplicates(rows, uses);
  assert.deepEqual(json(expanded.map(u => u.asset_id)), [A(1), A(2)], "the copy inherits the use");
  const ids = pool.libraryCandidates(rows, [], expanded, { allowed: false, afterDays: 30 }, new Set(), now).map(c => c.id);
  assert.deepEqual(json(ids), [A(5), A(4)], "used photo and its copy excluded; one of two unused copies (most recent first)");
  const reuse = pool.libraryCandidates(rows, [], expanded, { allowed: true, afterDays: 30 }, new Set(), now).map(c => c.id);
  assert.ok(reuse.includes(A(2)) && !reuse.includes(A(1)), "reuse rules apply to the pair, one copy proposed");
  // Copie d'une photo publiée via le catalogue Drive (empreinte connue) : jamais reproposée, même si le réemploi est permis.
  const viaCatalog = photos.usesWithDuplicates(rows, [], new Set(["c".repeat(64)]), id => ({ asset_id: id, publication_id: "", used_at: now.toISOString() }));
  assert.equal(pool.libraryCandidates(rows, [], viaCatalog, { allowed: true, afterDays: 1 }, new Set(), now).some(c => c.id === A(5)), false);
});

test("affirmations : un chantier présenté comme réalisé exige un fait confirmé", () => {
  const facts = sel.factsOf(input());
  for (const claim of ["Nous sommes intervenus sur ce toit.", "Nous avons réparé ces gouttières.", "Chantier terminé la semaine dernière.", "Intervention réalisée chez un client.", "Hier, nouvelle toiture."])
    assert.ok(sel.unsupportedClaims(claim, facts).some(c => c.startsWith("worksite:")), claim);
  assert.deepEqual(json(sel.unsupportedClaims("Une gouttière entretenue évacue l’eau loin des murs.", facts)), []);
  assert.equal(check({ idea, publications: variants([zinc[0], zinc[1], "Nous avons posé ces gouttières en zinc hier."]) }).reason, "unsupported_claim");
  assert.match(prompt.AGENT_V2_INSTRUCTIONS, /Ne présente jamais un chantier ou une intervention comme réalisé/);
});

test("prompt : contexte éditorial compact et plafonné, aucune légende ni nom de fichier, schéma inchangé", () => {
  const long = Array.from({ length: 40 }, (_, i) => pub(i + 1, `Sujet numéro ${i} ` + "très long ".repeat(40), { created_at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T08:00:00Z` }));
  const big = memory.buildEditorialHistory({ publications: long, variants: long.map((p, i) => variant(i + 1, "facebook", "Texte ".repeat(200) + i, "Contactez-nous " + i)), libraryUses: [], catalogUses: [], services: roofServices });
  assert.equal(big.length, memory.HISTORY_MAX_IDEAS);
  const i = { ...input(), editorial: { history: big, plan: planMod.buildEditorialPlan({ history: big, services: roofServices, media: input().media, zone: "Perpignan", now }) } };
  const payload = prompt.buildGeneratorPayload(i);
  const editorial = JSON.stringify({ h: payload.editorial_history, p: payload.editorial_plan, a: payload.allowed_places });
  assert.ok(editorial.length < 6000, `compact editorial context (${editorial.length} chars)`);
  assert.equal(payload.editorial_history.length, planMod.PROMPT_HISTORY_ITEMS);
  assert.ok(payload.editorial_history.every(h => h.subject.length <= 120 && !("texts" in h) && !("photos" in h)));
  assert.deepEqual(json(payload.media_untrusted[0]), { id: A(2), categories: ["toiture"], description: "Gouttière en zinc le long d’un toit.", services: ["Zinguerie"] });
  assert.deepEqual(json(prompt.generatorSchema(i).required), ["idea", "media_id", "publications"], "no extra model output");
  for (const k of ["caption", "file_name", "drive_file_id", "sha256"]) assert.ok(!JSON.stringify(payload).includes(`"${k}"`), k);
  assert.ok(JSON.stringify(payload).length < 40000, "within the generator's hard limit");
});

test("justification : construite sans IA, bornée, relue de façon sûre pour le panneau", () => {
  const i = input();
  const value = { idea, publications: variants(zinc, A(2), ["Demandez conseil à l’équipe.", null, null]) };
  const j = justif.buildEditorialJustification(i, { value }, now);
  assert.equal(j.outcome, "prepared"); assert.deepEqual(json(j.services), ["Zinguerie"]);
  assert.ok(j.subjectReasons.some(r => /privilégiée/.test(r)) && j.subjectReasons.some(r => /saisonnière douce/.test(r)));
  assert.deepEqual(json(j.photo), { source: "library", services: ["Zinguerie"], reason: "illustre la prestation du sujet (Zinguerie)" });
  assert.deepEqual(json(j.deprioritised.map(d => d.service)), ["Démoussage"]);
  assert.equal(j.history.length, 5); assert.equal(j.ctaStyle, "conseil");
  assert.ok(JSON.stringify(j).length < justif.MAX_JUSTIFICATION_BYTES);
  assert.doesNotMatch(JSON.stringify(j), /Gouttière en zinc le long/, "photo descriptions (untrusted) are not copied");
  const refused = justif.buildEditorialJustification(i, { refusal: { reason: "place_not_allowed", detail: "lieu absent des données du client : Narbonne" } }, now);
  assert.deepEqual(json(refused.refusal), { reason: "place_not_allowed", detail: "lieu absent des données du client : Narbonne" });
  const view = justif.justificationView(json(j));
  assert.equal(view.subject, idea.subject); assert.match(view.photo, /^Photothèque — illustre/); assert.match(view.styles, /CTA : Demande de conseil/);
  assert.equal(justif.justificationView({ ...json(j), version: 99 }), null);
  assert.equal(justif.justificationView("<script>"), null);
  const hostile = justif.justificationView({ ...json(j), subject: "<img src=x onerror=alert(1)>", history: [{ subject: "x".repeat(500), date: "2026-10-01", services: [] }] });
  assert.equal(hostile.history[0].length < 200, true);
});

test("panneau : justification en lecture seule, rendue en texte (aucune action, aucun HTML interprété)", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const React = await import("react");
  const panel = load("components/publications/agent-v2-justification.tsx");
  const view = justif.justificationView({ version: 1, outcome: "refused", refusal: { reason: "place_not_allowed", detail: "<b>Narbonne</b>" }, subject: "<script>alert(1)</script>", services: [], subjectReasons: [], photo: null, history: [], deprioritised: [{ service: "Démoussage", reason: "mise en avant par la dernière publication" }], servicesWithoutPhoto: [], introStyles: [], ctaStyle: null, checks: [] });
  const html = renderToStaticMarkup(React.createElement(panel.AgentV2Justification, { justification: view }));
  assert.match(html, /Justification éditoriale de l’agent/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|<b>/);
  assert.match(html, /Démoussage : mise en avant par la dernière publication/);
  assert.doesNotMatch(html, /<form|<button/, "read only");
  const drawer = src("components/publications/publication-drawer.tsx");
  assert.match(drawer, /\{detail\.justification&&<AgentV2Justification justification=\{detail\.justification\}\/>\}/);
  assert.match(src("lib/publications/editorial-justification-read.ts"), /contains\('publication_ids',\[publicationId\]\)/);
});

// --- Contexte réel de l'Agent v2 (faux client, chaque table lue une fois) ---
function contextWith(tables) {
  const log = [];
  const db = { from(table) { log.push(table); const filters = []; const rows = () => ({ data: json((tables[table] ?? []).filter(r => filters.every(f => f(r)))), error: null });
    const q = { select: () => q, order: () => q, limit: () => q, eq(k, v) { filters.push(r => r[k] === v); return q; }, in(k, vs) { filters.push(r => vs.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: rows().data[0] ?? null, error: null }), then(ok, ko) { return Promise.resolve(rows()).then(ok, ko); } }; return q; } };
  return { log, m: load("lib/publications/agent-v2/context.ts", { "@/lib/require-admin": { requireAdmin: async () => {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => db } }) };
}
test("contexte : historique, plan, doublons SHA-256 et catalogue déjà publié, sans lecture supplémentaire", async () => {
  const asset = (n, sha, extra = {}) => ({ id: A(n), client_id: C, library_status: "validated", media_kind: "image", mime_type: "image/jpeg", size: 200000, width: 1600, height: 1200, purged_at: null, imported_at: `2026-10-0${n}T08:00:00Z`, claimed_agent_v2_run_id: null, sha256: sha, caption: "Facture de M. Martin", drive_file_id: "secret_drive_file", ...extra });
  const assess = (n, description) => ({ asset_id: A(n), client_id: C, verdict: "relevant", confidential: false, sensitive: [], manual_verdict: null, description, topics: ["toiture"], quality: "good", quality_issues: [], business_relevance: 0.9, publishability: 0.9 });
  const c = contextWith({
    projects: [{ id: P, client_id: C, name: "Réseaux" }], clients: [{ id: C, name: "Couverture Catalane", activity: "Couvreur", geographic_area: "Perpignan" }],
    publication_agent_projects: [{ project_id: P, client_id: C, enabled: true, rights_confirmed: true, verified_services: roofServices, editorial_rules: "", drive_folder_id: "folder00000042" }],
    publication_project_channels: [], publication_client_settings: [{ client_id: C, editorial_brief: "", media_reuse_allowed: false, media_reuse_after_days: 180 }], client_media_profiles: [],
    publications: historyRows.map(p => ({ ...p, client_id: C, project_id: P })), publication_variants: historyVariants.map(v => ({ ...v, client_id: C })),
    whatsapp_assets: [asset(1, "a".repeat(64)), asset(2, "a".repeat(64)), asset(3, "b".repeat(64)), asset(4, "d".repeat(64)), asset(5, "e".repeat(64))],
    whatsapp_asset_assessments: [assess(1, "Toiture couverte de mousse."), assess(2, "Toiture couverte de mousse."), assess(3, "Gouttière en zinc le long d’un toit."), assess(4, "Tuiles faîtières sur le sommet d’un toit."), assess(5, "Facture du chantier.")],
    whatsapp_asset_uses: [{ client_id: C, asset_id: A(1), publication_id: PUB(1), used_at: "2026-10-11T08:00:00Z" }],
    publication_drive_media: [{ id: uid("d", 1), client_id: C, drive_folder_id: "folder00000042", analysis: { scene: "roof", usable: true }, claimed_run_id: null, claimed_agent_v2_run_id: null, file_hash: "d".repeat(64) }],
    publication_media_uses: [{ client_id: C, media_id: uid("d", 1), publication_id: PUB(4) }] });
  const { input: i } = await c.m.buildAgentV2Context(P, batch, now);
  assert.equal(new Set(c.log).size, c.log.length, "every table read once");
  assert.deepEqual(json(i.media.filter(m => !m.used).map(m => m.id)), [A(3)], "copy of a used photo, photo already published via the catalogue, used catalogue photo and invoice excluded");
  assert.deepEqual(json(i.media.find(m => m.id === A(3)).services), ["Zinguerie"]);
  assert.equal(i.editorial.history.length, 5);
  assert.deepEqual(json(i.editorial.plan.deprioritised.map(d => d.service)), ["Démoussage"]);
  assert.deepEqual(json(i.editorial.plan.favouredServices), ["Zinguerie"]);
  assert.deepEqual(json(i.editorial.plan.allowedPlaces), ["Perpignan"]);
  const all = JSON.stringify(i);
  for (const secret of ["Facture de M. Martin", "secret_drive_file", "folder00000042"]) assert.ok(!all.includes(secret), secret);
});

// --- Read models serveur ---
function fakeDb(tables) {
  return { from(table) { const filters = []; const rows = () => ({ data: json((tables[table] ?? []).filter(r => filters.every(f => f(r)))), error: null });
    const q = { select: () => q, order: () => q, limit: () => q, eq(k, v) { filters.push(r => r[k] === v); return q; }, in(k, vs) { filters.push(r => vs.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: rows().data[0] ?? null, error: null }), then(ok, ko) { return Promise.resolve(rows()).then(ok, ko); } }; return q; } };
}
const CLIENTS = { codev: uid("1", 1), jrenov: uid("1", 2), catalane: uid("1", 3), nuisibles: uid("1", 4) };
const healthTables = () => {
  const asset = (n, client, extra = {}) => ({ id: A(n), client_id: client, library_status: "validated", media_kind: "image", mime_type: "image/jpeg", size: 200000, width: 1600, height: 1200, purged_at: null, imported_at: "2026-10-01T08:00:00Z", claimed_agent_v2_run_id: null, sha256: String(n % 10).repeat(64), ...extra });
  const assess = (n, client, description, extra = {}) => ({ asset_id: A(n), client_id: client, verdict: "relevant", confidential: false, sensitive: [], manual_verdict: null, description, topics: [], quality: "good", quality_issues: [], business_relevance: 0.9, publishability: 0.9, ...extra });
  return {
    publication_agent_projects: Object.entries({ codev: ["Création de site"], jrenov: ["Rénovation de salle de bain", "Carrelage"], catalane: ["Démoussage", "Zinguerie"], nuisibles: ["Dératisation", "Désinsectisation"] })
      .map(([k, s]) => ({ client_id: CLIENTS[k], verified_services: s, enabled: true })),
    clients: [{ id: CLIENTS.codev, name: "CODE-V" }, { id: CLIENTS.jrenov, name: "JRenov" }, { id: CLIENTS.catalane, name: "Couverture Catalane" }, { id: CLIENTS.nuisibles, name: "Protection Nuisibles" }],
    client_media_profiles: [], publication_client_settings: [],
    whatsapp_assets: [asset(1, CLIENTS.codev), asset(11, CLIENTS.jrenov), asset(12, CLIENTS.jrenov), asset(13, CLIENTS.jrenov), asset(21, CLIENTS.catalane), asset(22, CLIENTS.catalane), asset(23, CLIENTS.catalane), asset(24, CLIENTS.catalane),
      asset(31, CLIENTS.nuisibles), asset(32, CLIENTS.nuisibles)],
    whatsapp_asset_assessments: [assess(1, CLIENTS.codev, "Capture d’écran d’un site web.", { quality_issues: ["screenshot"] }),
      assess(11, CLIENTS.jrenov, "Salle de bain rénovée avec douche à l’italienne."), assess(12, CLIENTS.jrenov, "Carrelage posé au sol."), assess(13, CLIENTS.jrenov, "Carreaux de faïence muraux."),
      assess(21, CLIENTS.catalane, "Toiture couverte de mousse."), assess(22, CLIENTS.catalane, "Gouttière en zinc."), assess(23, CLIENTS.catalane, "Toiture en tuiles."), assess(24, CLIENTS.catalane, "Toiture en tuiles vue de loin."),
      assess(31, CLIENTS.nuisibles, "Attestation de traitement."), assess(32, CLIENTS.nuisibles, "Piège à rats dans une cave.")],
    whatsapp_asset_uses: [{ client_id: CLIENTS.catalane, asset_id: A(21), publication_id: PUB(1), used_at: "2026-10-01T00:00:00Z" }], publication_drive_media: [], publication_media_uses: [] };
};
test("santé de la photothèque : clients sans photo utilisable, au total et par prestation, avec les comptes", async () => {
  const tables = healthTables();
  const m = load("lib/publications/editorial-health.ts", { "@/lib/require-admin": { requireAdmin: async () => {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => fakeDb(tables) } });
  const all = await m.loadEditorialPhotoHealth({ now });
  const by = Object.fromEntries(all.map(h => [h.clientName, h]));
  assert.deepEqual(json([by["CODE-V"].usable, by["CODE-V"].totalImages, by["CODE-V"].documents, by["CODE-V"].lacking]), [0, 1, 1, true], "a screenshot is not a usable photo");
  assert.deepEqual(json(by.JRenov.services), [{ service: "Rénovation de salle de bain", usable: 1 }, { service: "Carrelage", usable: 2 }], "faïence tiles count for carrelage (associated vocabulary)");
  assert.equal(by.JRenov.lacking, false);
  assert.deepEqual(json([by["Couverture Catalane"].usable, by["Couverture Catalane"].servicesLacking]), [3, ["Démoussage"]], "the only démoussage photo is already used");
  assert.deepEqual(json([by["Protection Nuisibles"].usable, by["Protection Nuisibles"].documents, by["Protection Nuisibles"].servicesLacking]), [1, 1, ["Désinsectisation"]]);
  const lacking = await m.listClientsLackingPhotos({ now });
  assert.deepEqual(json(lacking.map(h => h.clientName)), ["CODE-V", "Protection Nuisibles", "Couverture Catalane"]);
  assert.deepEqual(json((await m.listClientsLackingPhotos({ now, clientIds: [CLIENTS.jrenov], thresholds: { minUsable: 1, minPerService: 0 } })).length), 0);
  await assert.rejects(() => m.loadEditorialPhotoHealth({ clientIds: ["x"] }), /Invalid client/);
  const down = load("lib/publications/editorial-health.ts", { "@/lib/require-admin": { requireAdmin: async () => {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => ({ from: () => { const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: null, error: { message: "down" } }), then: (ok) => Promise.resolve({ data: null, error: { message: "down" } }).then(ok) }; return q; } }) } });
  await assert.rejects(() => down.loadEditorialPhotoHealth(), /unavailable/, "fail closed");
});

test("historique éditorial (read model serveur) : sujets, prestations, styles, photos décrites, jamais de légende", async () => {
  const tables = { publications: historyRows.map(p => ({ ...p, client_id: C })), publication_agent_projects: [{ client_id: C, verified_services: roofServices }], client_media_profiles: [],
    whatsapp_asset_uses: [{ client_id: C, asset_id: A(1), publication_id: PUB(1), used_at: "2026-10-11T08:00:00Z" }], publication_media_uses: [],
    publication_variants: historyVariants.map(v => ({ ...v, client_id: C })), whatsapp_asset_assessments: [{ client_id: C, asset_id: A(1), description: "Toiture couverte de mousse." }], publication_drive_media: [] };
  const m = load("lib/publications/editorial-history.ts", { "@/lib/require-admin": { requireAdmin: async () => {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => fakeDb(tables) } });
  const h = await m.getClientEditorialHistory(C);
  assert.equal(h.entries.length, 5);
  assert.deepEqual(json(h.entries[0]), { subject: "Démoussage avant l’hiver", date: "2026-10-11T08:00:00Z", platforms: ["facebook", "instagram"], services: ["Démoussage"], introStyle: "Question", ctaStyle: "Invitation au contact",
    photos: [{ source: "library", id: A(1), description: "Toiture couverte de mousse." }], publicationIds: [PUB(1)] });
  await assert.rejects(() => m.loadClientEditorialHistory("x"), /Invalid client/);
});

test("garde-fous : aucun process.env, fetch ou URL dans les nouveaux modules ; migration additive, rien d'activé", () => {
  for (const f of ["editorial-text", "editorial-memory", "editorial-photos", "editorial-places", "editorial-plan", "editorial-guards", "editorial-justification", "editorial-justification-read", "editorial-health", "editorial-history"]) {
    const code = src(`lib/publications/${f}.ts`);
    assert.doesNotMatch(code, /process\.env|fetch\(|https:\/\//, f);
  }
  const sql = src("supabase/migrations/20261102000000_publications_editorial_intelligence.sql").replace(/--[^\n]*/g, "");
  assert.doesNotMatch(sql, /security definer|publication_settings|auto_prepare|insert into public\.publication_deliveries|update public\.publications\b|delete from/i);
  assert.match(sql, /revoke all on function public\.publication_editorial_justification_record\(uuid,jsonb,text\) from public,anon,authenticated/);
  assert.match(src("lib/publications/agent-v2/service.ts"), /publication_editorial_justification_record/);
});

test("photo de document : les mots ambigus (maquette papier, logo) ne suffisent pas, les écrans restent écartés par leur signal", () => {
  assert.equal(photos.isDocumentPhoto({ description: "Maquettes papier d’un site web sur une table", topics: ["maquette"] }), false);
  assert.equal(photos.isDocumentPhoto({ description: "Nouveau logo peint sur la vitrine" }), false);
  assert.equal(photos.isDocumentPhoto({ description: "Photo d'une facture posée sur le bureau" }), true);
  assert.equal(photos.isDocumentPhoto({ description: "Écran de statistiques", sensitive: ["screen"] }), true);
  assert.equal(photos.isDocumentPhoto({ description: "Page web", quality_issues: ["screenshot"] }), true);
});
