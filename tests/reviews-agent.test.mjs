import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const style = loadTs("lib/copywriter/style.ts");
const model = loadTs("lib/reviews/model.ts", { "@/lib/copywriter/style": style });
const j = (v) => JSON.parse(JSON.stringify(v));
const policy = loadTs("lib/emailing/policy.ts");
const C = "11111111-1111-4111-8111-111111111111";
const LOC = "accounts/123/locations/456";
const NOW = new Date("2026-11-28T10:00:00Z");
const review = (id, stars, { days = 1, comment = "Très bon travail sur la toiture, équipe ponctuelle.", reply = null, first = "Marie Dupont" } = {}) => ({
  name: `${LOC}/reviews/${id}`, reviewer: { displayName: first }, starRating: stars, comment,
  createTime: new Date(NOW.getTime() - days * 86_400_000).toISOString(), updateTime: new Date(NOW.getTime() - days * 86_400_000).toISOString(),
  ...(reply ? { reviewReply: { comment: reply } } : {}),
});
const ctx = (over = {}) => ({ business: { name: "Toitures Martin", activity: "Couvreur", zone: "Perpignan", facts: "Prestation : réfection de toiture\nTéléphone : 04 68 00 00 00", tone: "", signature: "Julien, Toitures Martin" }, review: { reviewer: "Marie", rating: 5, comment: "Super travail sur la toiture." }, exclusions: ["pas cher"], address: "vous", ...over });

test("lecture des avis Google : prénom seul, anonyme sans nom, traduction retirée, nom d'avis validé", () => {
  const parsed = model.readGbpReviews({ reviews: [
    review("a1", "FIVE"),
    { ...review("a2", "TWO", { comment: "Nul (Translated by Google) Bad" }), reviewer: { displayName: "Jean Martin", isAnonymous: true } },
    { ...review("a3", "FOUR"), name: "accounts/1/locations/2/reviews/../x" },
  ], nextPageToken: "tok" });
  assert.equal(parsed.reviews.length, 2);
  assert.equal(parsed.reviews[0].reviewer, "Marie");
  assert.equal(parsed.reviews[0].rating, 5);
  assert.equal(parsed.reviews[1].reviewer, null);
  assert.equal(parsed.reviews[1].comment, "Nul");
  assert.equal(parsed.nextPageToken, "tok");
  assert.equal(model.readGbpReviews({ reviews: "x" }), null);
  assert.equal(model.readNewReviewUri({ metadata: { newReviewUri: "https://search.google.com/local/writereview?placeid=abc" } }), "https://search.google.com/local/writereview?placeid=abc");
  assert.equal(model.readNewReviewUri({ metadata: { newReviewUri: "javascript:alert(1)" } }), null);
});

test("plan de synchronisation : premier relevé sans brouillon pour les vieux avis, négatif signalé, réponse donnée ailleurs, avis modifié refait", () => {
  const fetched = model.readGbpReviews({ reviews: [review("n1", "FIVE"), review("n2", "TWO"), review("old", "FOUR", { days: 60 }), review("r", "FIVE", { reply: "Merci !" })] }).reviews;
  const first = model.planSync(fetched, [], NOW, true);
  assert.deepEqual(j(first.inserts.map((i) => [i.review.name.split("/").pop(), i.status])), [["n1", "to_draft"], ["n2", "to_draft"], ["old", "skipped"], ["r", "replied_elsewhere"]]);
  assert.deepEqual(j(first.negatives.map((r) => r.name.split("/").pop())), ["n2"]);
  // Relevé suivant : un avis ancien n'est plus « premier relevé » → brouillon ; réponse donnée sur Google → clôturé.
  assert.equal(model.planSync([review("old2", "FOUR", { days: 60 })].map((r) => model.readGbpReviews({ reviews: [r] }).reviews[0]), [], NOW, false).inserts[0].status, "to_draft");
  const stored = [{ id: "x1", review_name: `${LOC}/reviews/n1`, status: "draft", review_updated_at: fetched[0].updatedAt, rating: 5, comment: fetched[0].comment }];
  const answered = model.planSync([{ ...fetched[0], reply: "Merci Marie" }], stored, NOW, false);
  assert.equal(answered.updates[0].patch.status, "replied_elsewhere");
  assert.deepEqual(j(answered.answered), [`${LOC}/reviews/n1`]);
  const edited = model.planSync([{ ...fetched[0], rating: 2, comment: "Finalement déçue.", updatedAt: NOW.toISOString() }], stored, NOW, false);
  assert.equal(edited.updates[0].patch.status, "to_draft");
  assert.equal(edited.updates[0].patch.draft, null);
  assert.equal(edited.negatives.length, 1, "un avis devenu négatif est signalé");
});

test("contrôle des réponses : rien d'inventé (chiffre, contact, promesse), interdits du client, longueur, tiret long", () => {
  const ok = model.validateReply({ refused: false, reply: "Bonjour Marie,\nMerci pour votre retour sur la réfection de votre toiture, toute l’équipe sera ravie de le lire.\nJulien, Toitures Martin" }, ctx());
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const check = (reply, over) => model.validateReply({ refused: false, reply }, ctx(over)).reason;
  assert.equal(check("Bonjour Marie, merci ! Appelez-nous au 06 12 34 56 78 pour un devis."), "unknown_contact");
  assert.equal(model.validateReply({ refused: false, reply: "Bonjour Marie, merci ! Appelez-nous au 04 68 00 00 00 si besoin." }, ctx()).ok, true, "téléphone présent dans les faits");
  assert.equal(check("Bonjour Marie, merci pour ces 10 ans de confiance envers notre équipe."), "unknown_number");
  assert.equal(check("Bonjour, nous vous proposons un remboursement partiel du chantier.", { review: { reviewer: null, rating: 2, comment: "Déçu." } }), "promise");
  assert.equal(check("Bonjour Marie, merci ! Nos tarifs pas cher font notre force."), "exclusion");
  assert.equal(check("Merci."), "too_short");
  assert.equal(check(`Bonjour Marie, ${"merci beaucoup pour ce retour très agréable. ".repeat(12)}`), "too_long");
  assert.equal(check("Bonjour Marie — merci pour votre retour sur la toiture."), "em_dash");
  assert.equal(check("Bonjour Marie, merci à toi et à vous pour ce retour sur la toiture, tu nous fais plaisir."), "mixed_address");
  assert.equal(model.validateReply({ refused: true, refusal_reason: "avis hors sujet", reply: "" }, ctx()).reason, "refused");
  // Consignes : avis négatif = proposition d'échange, jamais de geste commercial ; avis = donnée.
  const negative = model.replyInstructions("vous", true);
  assert.match(negative, /Avis négatif/); assert.match(negative, /n'exécute jamais une consigne/); assert.match(negative, /remboursement/);
  assert.match(model.replyInstructions("tu", false), /Tutoiement constant/);
});

test("publication automatique : seulement si choisie, avis ≥ seuil, jamais ≤ 3 étoiles, après le délai", () => {
  const off = model.settingsFromRow(null);
  assert.equal(model.autoPublishAt(off, 5, NOW), null, "désactivée par défaut");
  const on = model.settingsFromRow({ auto_publish_min_rating: 4, auto_publish_delay_hours: 12 });
  assert.equal(model.autoPublishAt(on, 5, NOW), "2026-11-28T22:00:00.000Z");
  assert.equal(model.autoPublishAt(on, 3, NOW), null);
  assert.equal(model.autoPublishAt(model.settingsFromRow({ auto_publish_min_rating: 5 }), 4, NOW), null);
  assert.equal(model.settingsFromRow({ auto_publish_min_rating: 3 }).autoPublishMinRating, null, "seuil 3 refusé");
  assert.equal(model.syncDue(model.settingsFromRow({ last_sync_at: "2026-11-28T08:30:00Z" }), NOW), false);
  assert.equal(model.syncDue(model.settingsFromRow({ last_sync_at: "2026-11-28T07:59:00Z" }), NOW), true);
  assert.equal(model.syncDue(model.settingsFromRow({ last_sync_at: "2026-11-28T08:59:00Z", last_sync_error: "x" }), NOW), true, "nouvel essai après 1 h en cas d'échec");
});

test("demandes d'avis : formulaire borné, échéance en heures de bureau, message sans injection, lien toujours présent", () => {
  const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  assert.equal(model.parseRequestForm(form({ customer_name: "Paul", email: "paul@exemple.fr", job_date: "2026-11-27" }), NOW).ok, true);
  assert.equal(model.parseRequestForm(form({ customer_name: "Paul", email: "pas-une-adresse", job_date: "2026-11-27" }), NOW).ok, false);
  assert.equal(model.parseRequestForm(form({ customer_name: "Paul", email: "paul@exemple.fr", job_date: "2025-01-01" }), NOW).ok, false);
  assert.equal(model.requestSendAfter("2026-11-28", 1, NOW), "2026-11-29T09:00:00.000Z");
  assert.equal(model.requestSendAfter("2026-11-20", 1, NOW), NOW.toISOString(), "échéance passée : tout de suite");
  const settings = model.settingsFromRow(null);
  const msg = model.renderRequest(settings, { prenom: "Paul\nBcc: x@y.z", prestation: null, entreprise: "Toitures Martin", lien: "https://g.page/r/abc/review" });
  assert.match(msg.text, /^Bonjour Paul Bcc: x@y\.z,/);
  assert.match(msg.text, /votre projet/);
  assert.match(msg.text, /https:\/\/g\.page\/r\/abc\/review/);
  assert.equal(msg.subject, model.DEFAULT_REQUEST_SUBJECT);
  const custom = model.renderRequest(model.settingsFromRow({ request_template: "Merci {prenom} !" }), { prenom: "Léa", prestation: "x", entreprise: "E", lien: "https://l.ink/r" });
  assert.equal(custom.text, "Merci Léa !\n\nhttps://l.ink/r", "lien ajouté s'il manque");
  assert.equal(model.parseSettingsForm(form({ request_template: "Sans lien" })).ok, false);
  assert.equal(model.parseSettingsForm(form({ review_url: "http://insecure" })).ok, false);
  const saved = model.parseSettingsForm(form({ enabled: "on", auto_publish_min_rating: "5", signature: "Julien\nMartin" }));
  assert.equal(saved.payload.auto_publish_min_rating, 5); assert.equal(saved.payload.signature, "Julien Martin");
});

test("transport Google : liste fermée (lecture des avis, lien d'avis, réponse à un avis), rien d'autre", async () => {
  const calls = [];
  const transport = loadTs("lib/integrations/gbp-reviews.ts").gbpReviewsTransport(async (url, init) => { calls.push([url, init.method, init.body]); return { status: 200, text: async () => "{}" }; });
  await transport.request({ kind: "list", location: LOC, token: "t" });
  await transport.request({ kind: "metadata", location: LOC, token: "t" });
  await transport.request({ kind: "reply", review: `${LOC}/reviews/abc`, comment: "Merci", token: "t" });
  assert.deepEqual(calls.map((c) => [c[0].split("?")[0], c[1]]), [
    [`https://mybusiness.googleapis.com/v4/${LOC}/reviews`, "GET"], ["https://mybusinessbusinessinformation.googleapis.com/v1/locations/456", "GET"], [`https://mybusiness.googleapis.com/v4/${LOC}/reviews/abc/reply`, "PUT"]]);
  assert.equal(calls[2][2], JSON.stringify({ comment: "Merci" }));
  await assert.rejects(transport.request({ kind: "reply", review: `${LOC}/localPosts/1`, comment: "x", token: "t" }));
  await assert.rejects(transport.request({ kind: "list", location: "accounts/1/locations/2/../../x", token: "t" }));
  await assert.rejects(transport.request({ kind: "reply", review: `${LOC}/reviews/abc`, comment: "", token: "t" }));
});

function loadService(fake, { ai, sent, emailEnabled = true }) {
  const incidents = [], resolved = [];
  const service = loadTs("lib/reviews/service.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "@/lib/core/audit": { writeAudit: async () => undefined },
    "@/lib/agents/outputs": { openIncident: async (_a, input) => { incidents.push(input); return { id: "i", created: true }; }, resolveIncident: async (_a, fp) => { resolved.push(fp); return 1; } },
    "@/lib/ai/metered": { structuredResponse: async (instructions, input) => ({ value: ai(instructions, input) }), withAiScope: (_s, fn) => fn(), isBudgetExceeded: () => false },
    "@/lib/ai/models": { agentsAiConfigured: () => true },
    "@/lib/copywriter/style": style,
    "@/lib/visual-agent/service": { clientBrandContext: async () => ({ client: { name: "Toitures Martin", activity: "Couvreur", zone: "Perpignan" }, services: [], facts: "Prestation : réfection de toiture", exclusions: [], guidelines: "" }) },
    "@/lib/integrations/publications-oauth/config": { googleOAuthConfig: () => null },
    "@/lib/integrations/publications-oauth/http": { googleTransport: () => null },
    "@/lib/integrations/gbp-reviews": { gbpReviewsTransport: () => null },
    "@/lib/publications/connections/google-business-profile": { createGoogleBusinessProfileConnectionProvider: () => null },
    "@/lib/publications/oauth/service": { productionOAuthDeps: () => ({ vault: null }) },
    "@/lib/publications/connections/vault": { isCredentialReference: (v) => typeof v === "string" },
    "@/lib/providers/email": { emailSendingStatus: () => (emailEnabled ? { enabled: true } : { enabled: false, reason: "off" }), sendEmail: async (m) => { sent.push(m); return { id: "msg_1" }; } },
    "@/lib/emailing/sender": loadTs("lib/emailing/sender.ts", { "./policy": policy }),
    "@/lib/emailing/policy": policy,
    "./model": model,
  });
  return { service, incidents, resolved };
}

function world(settings = {}) {
  return createFakeSupabase({
    google_review_settings: [{ client_id: C, enabled: true, auto_publish_min_rating: 5, auto_publish_delay_hours: 12, signature: "Julien, Toitures Martin", review_url: "https://g.page/r/abc/review", ...settings }],
    publication_accounts: [{ client_id: C, external_account_id: LOC, connection_id: "conn-1", display_name: "Toitures Martin", platform: "google_business_profile", status: "active" }],
    client_connections: [{ id: "conn-1", credential_reference: "ref", status: "active" }],
    google_reviews: [], google_review_requests: [], admin_notifications: [], email_suppressions: [], clients: [{ id: C, name: "Toitures Martin", company_name: null }], client_email_settings: [],
  }, { unique: { google_reviews: [["review_name"]], admin_notifications: [["event_key"]] } });
}
const vault = { readCredential: async () => ({ accessToken: "tok", refreshToken: "r", expiresAt: "2099-01-01T00:00:00Z" }) };

test("passage de l'agent : relevé, alerte négative, brouillons (négatif d'abord), publication auto des seuls 5 étoiles après le délai", async () => {
  const fake = world();
  const sent = [], replies = [];
  const transport = { request: async (r) => {
    if (r.kind === "list") return { status: 200, body: { reviews: [review("p5", "FIVE"), review("n2", "TWO", { comment: "Chantier pas terminé, déçu." }), review("old", "FOUR", { days: 60 })] } };
    if (r.kind === "metadata") return { status: 200, body: { metadata: { newReviewUri: "https://search.google.com/local/writereview?placeid=xyz" } } };
    replies.push(r); return { status: 200, body: { comment: r.comment } };
  } };
  const ai = (_i, input) => { const data = JSON.parse(input.split("\n\nPREMIER")[0]); return { refused: false, refusal_reason: "", reply: data.review.rating <= 3 ? "Bonjour Marie,\nMerci d’avoir pris le temps d’écrire. Nous sommes désolés que le chantier vous ait laissé ce sentiment. Contactez-nous pour en parler directement, nous voulons comprendre ce qui s’est passé.\nJulien, Toitures Martin" : "Bonjour Marie,\nMerci pour ce retour sur votre toiture, l’équipe sera contente de le lire.\nJulien, Toitures Martin" }; };
  const { service, incidents } = loadService(fake, { ai, sent });
  const deps = { db: fake.client, vault, transport, refresh: null };
  const first = await service.runGoogleReviewsTick(NOW, deps, { deadline: Date.now() + 600_000 });
  assert.equal(first.synced, 1); assert.equal(first.newReviews, 3); assert.equal(first.negatives, 1); assert.equal(first.drafted, 2);
  const rows = Object.fromEntries(fake.tables.google_reviews.map((r) => [r.review_name.split("/").pop(), r]));
  assert.equal(rows.old.status, "skipped", "ancien avis au premier relevé : pas de brouillon automatique");
  assert.equal(rows.n2.status, "draft"); assert.equal(rows.n2.auto_publish_at, null, "négatif jamais publié automatiquement");
  assert.equal(rows.p5.status, "draft"); assert.equal(rows.p5.auto_publish_at, "2026-11-28T22:00:00.000Z");
  assert.equal(incidents.length, 1); assert.equal(incidents[0].severity, "high"); assert.match(incidents[0].fingerprint, /^reviews:/);
  assert.deepEqual(fake.tables.admin_notifications.map((n) => [n.category, n.href]), [["negative_review", `/avis?client=${C}`]]);
  assert.equal(fake.tables.google_review_settings[0].detected_review_url, "https://search.google.com/local/writereview?placeid=xyz");
  assert.equal(replies.length, 0, "rien publié pendant le délai de relecture");
  // 13 h plus tard : seule la réponse 5 étoiles part, au nom de la règle.
  const later = new Date(NOW.getTime() + 13 * 3_600_000);
  const second = await service.runGoogleReviewsTick(later, deps, { deadline: Date.now() + 600_000 });
  assert.equal(second.published, 1);
  assert.deepEqual(replies.map((r) => r.review.split("/").pop()), ["p5"]);
  assert.equal(fake.tables.google_reviews.find((r) => r.review_name.endsWith("p5")).published_by, "auto");
  assert.equal(fake.tables.google_reviews.find((r) => r.review_name.endsWith("n2")).status, "draft");
});

test("passage de l'agent : règle retirée = aucune publication automatique ; brouillon refusé deux fois → nouvel essai au passage suivant", async () => {
  const fake = world({ auto_publish_min_rating: null });
  const transport = { request: async (r) => (r.kind === "list" ? { status: 200, body: { reviews: [review("p5", "FIVE")] } } : { status: 200, body: {} }) };
  const { service } = loadService(fake, { ai: () => ({ refused: false, refusal_reason: "", reply: "Bonjour Marie, merci ! Appelez le 06 11 22 33 44." }), sent: [] });
  const summary = await service.runGoogleReviewsTick(NOW, { db: fake.client, vault, transport, refresh: null }, { deadline: Date.now() + 600_000 });
  assert.equal(summary.drafted, 0); assert.equal(summary.draftFailed, 1);
  const row = fake.tables.google_reviews[0];
  assert.equal(row.status, "to_draft"); assert.equal(row.draft_attempts, 1); assert.match(row.last_error, /téléphone/);
});

test("demandes d'avis : envoi à l'échéance en heures de bureau avec le lien, adresse exclue jamais sollicitée, coordonnées purgées après 90 jours", async () => {
  const fake = world();
  fake.tables.google_review_requests.push(
    { id: "22222222-2222-4222-8222-222222222222", client_id: C, customer_name: "Paul", email: "paul@exemple.fr", service: "la réfection de votre toiture", job_date: "2026-11-27", send_after: "2026-11-28T09:00:00Z", status: "scheduled", created_at: "2026-11-27T09:00:00Z" },
    { id: "33333333-3333-4333-8333-333333333333", client_id: C, customer_name: "Zoé", email: "zoe@exemple.fr", service: null, job_date: "2026-11-27", send_after: "2026-11-28T09:00:00Z", status: "scheduled", created_at: "2026-11-27T09:00:00Z" },
    { id: "44444444-4444-4444-8444-444444444444", client_id: C, customer_name: "Ancien", email: "old@exemple.fr", service: null, job_date: "2026-07-01", send_after: "2026-07-02T09:00:00Z", status: "sent", created_at: "2026-07-01T09:00:00Z" });
  fake.tables.email_suppressions.push({ email_normalized: "zoe@exemple.fr", scope: "client", client_id: C });
  const sent = [];
  const { service } = loadService(fake, { ai: () => ({}), sent });
  const summary = await service.runGoogleReviewsTick(NOW, { db: fake.client, vault: null, transport: null, refresh: null }, { deadline: Date.now() + 600_000 });
  assert.equal(summary.requestsSent, 1); assert.equal(summary.requestsFailed, 1);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, "paul@exemple.fr");
  assert.match(sent[0].text, /Bonjour Paul,/); assert.match(sent[0].text, /la réfection de votre toiture/); assert.match(sent[0].text, /https:\/\/g\.page\/r\/abc\/review/);
  assert.equal(sent[0].idempotencyKey, "review-request:22222222-2222-4222-8222-222222222222");
  const byName = Object.fromEntries(fake.tables.google_review_requests.map((r) => [r.customer_name, r]));
  assert.equal(byName.Zoé.status, "suppressed");
  assert.equal(byName.Client.email, null, "demande de juillet purgée");
  // Hors heures de bureau (22 h à Paris) : rien ne part.
  const night = world(); night.tables.google_review_requests.push({ ...fake.tables.google_review_requests[0], status: "scheduled", email: "paul@exemple.fr", customer_name: "Paul" });
  const nightSent = [];
  await loadService(night, { ai: () => ({}), sent: nightSent }).service.runGoogleReviewsTick(new Date("2026-11-28T21:00:00Z"), { db: night.client, vault: null, transport: null, refresh: null });
  assert.equal(nightSent.length, 0);
});

test("harness : charte, étape du planificateur, lancement manuel, boîte « À valider », notification et migration", () => {
  const charter = loadTs("lib/harness/charter.ts");
  const c = charter.getCharter("reviews");
  assert.equal(c.team, "reputation");
  assert.ok(c.never.some((n) => /3 étoiles ou moins/.test(n)));
  assert.match(readFileSync("lib/reviews/service.ts", "utf8"), /withCharter\('reviews'/);
  assert.match(readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8"), /step\("google_reviews"/);
  assert.match(readFileSync("lib/ai/models.ts", "utf8"), /reviews: "writing"/);
  const inbox = loadTs("lib/review/inbox.ts", { "./crucial": loadTs("lib/review/crucial.ts") });
  const built = inbox.buildInbox({ clients: [{ id: C, name: "Toitures Martin" }], reports: [], recommendations: [], actions: [], ads: [], publications: [], autoApproveClients: null, prospection: [], seo: [], seoAgentId: null, photos: [], alerts: [],
    googleReviews: [{ id: "r1", client_id: C, rating: 2, created_at: "2026-11-28T08:00:00Z" }, { id: "r2", client_id: C, rating: 5, created_at: "2026-11-28T08:00:00Z" }] });
  const section = built.sections.find((s) => s.id === "google-reviews");
  assert.equal(section.crucial, "public-reply"); assert.equal(section.manual, 2); assert.match(section.note, /1 à un avis négatif/);
  const sql = readFileSync("supabase/migrations/20261224010000_google_reviews_agent.sql", "utf8");
  assert.match(sql, /google_reviews_auto_positive check \(published_by is distinct from 'auto' or coalesce\(rating, 0\) >= 4\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /'negative_review'/);
  assert.match(readFileSync("lib/notifications/schema.ts", "utf8"), /\/\^\\\/avis\\\?client=/);
});
