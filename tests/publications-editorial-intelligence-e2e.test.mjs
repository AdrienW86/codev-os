// Socle Publications, PR #42 — phase 2 de bout en bout (déterministe : IA, Drive et réseaux sociaux simulés).
// Quatre clients d'exemple fictifs × Facebook / Instagram / Google Business Profile, par le chemin existant :
// planificateur (runScheduledPreparation) → Agent v2 réel (prepareNextPublicationsAs : contexte, plan éditorial,
// génération simulée, validation, finish, étape média) → soumission « À valider » → approbation humaine obligatoire →
// modification = nouvelle approbation → préparation de la diffusion seulement si PUBLICATIONS_SCHEDULED_DELIVERY=enabled.
// Les RPC sont des miroirs en mémoire ; leur version SQL réelle est testée sur la chaîne complète des migrations
// (publications-socle-3/4/6 et P10_FULL_CHAIN de tests/publications-scheduled-flow-db.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json, uid } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";
import { candidates } from "./helpers/scheduled-candidates.mjs";

const ADMIN = "user_admin", AGENT = uid("9", 1), now = new Date("2026-10-13T08:00:00Z");
const JPEG = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);
const on = { id: "00000000-0000-0000-0000-000000000001", emergency_stop: false, generation_enabled: true, automation_enabled: true, publishing_enabled: true };
const PLATFORMS = ["facebook", "instagram", "google_business_profile"];
const CTA_BY_STYLE = { contact: "Contactez-nous pour en parler.", message: "Écrivez-nous en message privé.", conseil: "Demandez conseil à notre équipe.", question: "Posez-nous vos questions.", appel: "Appelez-nous pour en discuter." };

// --- Clients d'exemple (fictifs) : profil, historique et photothèque importée d'un export WhatsApp, déjà classée ---
const CLIENTS = [
  { key: "codev", n: 1, name: "CODE-V", activity: "Agence web", zone: null, services: ["Création de site", "Référencement local"],
    history: [["Création de site vitrine", "Un site vitrine présente votre activité en quelques pages claires et lisibles."]],
    photos: [["Capture d’écran d’un site web.", ["site web"], { quality_issues: ["screenshot"], verdict: "to_review" }], ["Facture de prestation.", [], { confidential: true, sensitive: ["invoice"], verdict: "to_review" }]] },
  { key: "jrenov", n: 2, name: "JRenov", activity: "Rénovation intérieure", zone: "Montpellier", services: ["Rénovation de salle de bain", "Carrelage", "Peinture intérieure"],
    history: [["Salle de bain : douche à l’italienne", "Une douche à l’italienne libère de la place dans une petite salle de bain."], ["Salle de bain : bien choisir sa vasque", "Une vasque bien proportionnée change toute la salle de bain."]],
    photos: [["Salle de bain rénovée avec douche.", ["salle de bain"]], ["Carrelage posé au sol d’une cuisine.", ["carrelage"]], ["Mur fraîchement repeint en peinture blanche.", ["peinture"]]] },
  { key: "catalane", n: 3, name: "Couverture Catalane", activity: "Couvreur", zone: "Perpignan", services: ["Démoussage", "Zinguerie", "Réparation de faîtage"],
    history: [["Démoussage avant l’hiver", "La mousse retient l’humidité sur les tuiles pendant des semaines."], ["Le démoussage en trois étapes", "Brossage, traitement puis protection : trois gestes pour des tuiles propres."]],
    photos: [["Toiture couverte de mousse.", ["toiture"], {}, "used"], ["Toiture couverte de mousse.", ["toiture"], {}, "copy"], ["Gouttière en zinc le long d’un toit.", ["zinguerie"]], ["Tuiles faîtières au sommet d’un toit.", ["toiture"]]] },
  { key: "nuisibles", n: 4, name: "Protection Nuisibles", activity: "Dératisation et désinsectisation", zone: null, services: ["Dératisation", "Désinsectisation"],
    history: [["Dératisation d’une cave", "Les rongeurs suivent les murs : les pièges se posent le long des plinthes."]],
    photos: [["Attestation de traitement posée sur un bureau.", ["document"], { manual_verdict: "relevant" }, "validated"], ["Facture d’intervention.", [], { confidential: true, sensitive: ["invoice"], verdict: "to_review" }],
      ["Piège à rats dans une cave.", ["dératisation"]], ["Nid de guêpes sous un toit.", ["désinsectisation"]]] }];

function world(client) {
  const C = uid("1", client.n), P = uid("3", client.n), A = i => uid("a", client.n * 10 + i), O = i => uid("6", client.n * 10 + i), H = i => uid("4", client.n * 100 + i);
  const at = [["facebook", "2026-10-14T10:00:00Z"], ["instagram", "2026-10-14T16:00:00Z"], ["google_business_profile", "2026-10-15T07:00:00Z"]];
  const tables = {
    publication_settings: [on], publication_events: [{ client_id: C, action: "publication.client_settings_saved", actor_id: ADMIN, after_data: { auto_prepare_enabled: true }, created_at: "2026-10-01T00:00:00Z" }],
    publication_client_settings: [{ client_id: C, auto_prepare_enabled: true, generation_enabled: true, prepare_lead_days: 3, editorial_brief: "", media_reuse_allowed: false, media_reuse_after_days: 180, last_auto_prepared_at: null }],
    publication_agent_projects: [{ project_id: P, client_id: C, enabled: true, rights_confirmed: true, verified_services: client.services, editorial_rules: "Vouvoiement, ton sobre.", drive_folder_id: `folder_${client.key}_0001` }],
    projects: [{ id: P, client_id: C, name: `Réseaux ${client.name}`, type: "Réseaux sociaux" }], clients: [{ id: C, name: client.name, activity: client.activity, geographic_area: client.zone }],
    publication_project_channels: PLATFORMS.map(platform => ({ project_id: P, client_id: C, platform, enabled: true, editorial_rules: null })),
    client_media_profiles: [{ client_id: C, services: client.services, priority_topics: [], communication_guidelines: "" }],
    publication_channel_occurrences: at.map(([platform, scheduled_for], i) => ({ id: O(i + 1), client_id: C, project_id: P, platform, local_date: scheduled_for.slice(0, 10), local_time: "12:00:00", timezone: "Europe/Paris", scheduled_for, publication_id: null, skipped_at: null })),
    publications: client.history.map(([subject], i) => ({ id: H(i + 1), client_id: C, project_id: P, subject, platform: "facebook", status: "approved", archived_at: null, current_revision_id: uid("7", client.n * 100 + i + 1), occurrence_id: null, created_at: `2026-10-${String(11 - i).padStart(2, "0")}T08:00:00Z`, updated_at: "0" })),
    publication_variants: client.history.map(([, text], i) => ({ client_id: C, publication_id: H(i + 1), revision_id: uid("7", client.n * 100 + i + 1), platform: "facebook", text_content: text, metadata: { cta: "Contactez-nous pour en savoir plus." } })),
    whatsapp_assets: client.photos.map(([, , , tag], i) => ({ id: A(i + 1), client_id: C, library_status: tag === "used" ? "used" : tag === "validated" ? "validated" : "received", media_kind: "image", mime_type: "image/jpeg", size: JPEG.length, width: 1600, height: 1200,
      purged_at: null, imported_at: `2026-10-0${i + 1}T08:00:00Z`, claimed_agent_v2_run_id: null, sha256: (tag === "copy" ? "f" : String(i + 1)).repeat(64), md5: String(i + 1).repeat(32), origin: "whatsapp_export",
      drive_file_id: `wa_export_${client.key}_${i + 1}`, drive_folder_id: `folder_wa_${client.key}`, caption: "Message privé du client avec son adresse" })),
    whatsapp_asset_assessments: client.photos.map(([description, topics, extra = {}], i) => ({ asset_id: A(i + 1), client_id: C, verdict: "relevant", confidential: false, sensitive: [], manual_verdict: null, description, topics, quality: "good", quality_issues: [], business_relevance: 0.9, publishability: 0.9, ...extra })),
    whatsapp_asset_uses: [], publication_drive_media: [], publication_media_uses: [], publication_agent_v2_runs: [], admin_notifications: [], publication_scheduled_runs: [], publication_reviews: [], publication_deliveries: [] };
  // Photo déjà publiée (et sa copie exacte importée par l'export) : jamais reproposée.
  const usedIndex = client.photos.findIndex(p => p[3] === "used");
  if (usedIndex >= 0) { tables.whatsapp_asset_uses.push({ client_id: C, asset_id: A(usedIndex + 1), publication_id: H(1), platform: "facebook", used_at: "2026-10-11T08:00:00Z" }); tables.whatsapp_assets[usedIndex + 1].sha256 = tables.whatsapp_assets[usedIndex].sha256; }
  let runs = 0, pubs = 0;
  const run = (t, id) => t.publication_agent_v2_runs.find(r => r.id === id);
  const fake = createFakeSupabase(tables, { unique: { publication_scheduled_runs: [["run_id"]], admin_notifications: [["event_key"]] }, rpc: {
    publication_channel_occurrences_ensure: () => ({ created: 0 }),
    publication_agent_v2_begin: (a, t) => { const id = uid("8", client.n * 10 + ++runs); t.publication_agent_v2_runs.push({ id, agent_id: AGENT, client_id: C, project_id: a.p_project_id, status: "processing", occurrence_ids: a.p_occurrence_ids, publication_ids: [], editorial_justification: null, media_status: "none", media_attempts: 0, media_lease_until: null, selected_library_asset_id: null, error_code: null, created_at: now.toISOString() }); return { run_id: id, reused: false }; },
    publication_editorial_justification_record: (a, t) => { const r = run(t, a.p_run_id); if (!r || r.status !== "processing" || r.editorial_justification) throw Error("Editorial justification is immutable"); r.editorial_justification = a.p_justification; return { run_id: r.id, recorded: true }; },
    publication_agent_v2_finish: (a, t) => { const r = run(t, a.p_run_id); if (r.status !== "processing") throw Error("Agent run is immutable");
      if (a.p_media_id) { const asset = t.whatsapp_assets.find(x => x.id === a.p_media_id && x.client_id === C); if (!asset || asset.claimed_agent_v2_run_id || t.whatsapp_asset_uses.some(u => u.asset_id === asset.id)) throw Error("Invalid agent output"); asset.claimed_agent_v2_run_id = r.id; r.selected_library_asset_id = asset.id; }
      const ids = a.p_output.publications.map(item => { const o = t.publication_channel_occurrences.find(x => x.id === item.occurrence_id && !x.publication_id); if (!o) throw Error("occurrence"); const id = uid("4", client.n * 100 + 50 + ++pubs), rev = uid("7", client.n * 100 + 50 + pubs);
        t.publications.push({ id, client_id: C, project_id: P, subject: a.p_output.idea.subject, platform: o.platform, occurrence_id: o.id, status: "draft", archived_at: null, current_revision_id: rev, created_at: now.toISOString(), updated_at: String(pubs) });
        t.publication_variants.push({ id: uid("b", client.n * 100 + pubs), client_id: C, publication_id: id, revision_id: rev, platform: o.platform, text_content: item.text, metadata: item.cta ? { cta: item.cta } : {} }); o.publication_id = id; return id; });
      Object.assign(r, { status: "completed", publication_ids: ids, media_status: a.p_media_id ? "pending" : "none" }); return { run_id: r.id, publication_ids: ids, media_status: r.media_status }; },
    publication_agent_v2_fail: (a, t) => { Object.assign(run(t, a.p_run_id), { status: "failed", error_code: a.p_error_code }); return null; },
    publication_agent_v2_media_claim: (a, t) => { const r = run(t, a.p_run_id), asset = t.whatsapp_assets.find(x => x.id === r.selected_library_asset_id); r.media_attempts++;
      return { run_id: r.id, media_status: "pending", attempt: r.media_attempts, client_id: C, media: { id: asset.id, source: "library", origin: asset.origin, md5: asset.md5, drive_file_id: asset.drive_file_id, drive_folder_id: asset.drive_folder_id, mime_type: asset.mime_type, file_size: asset.size },
        targets: r.publication_ids.map(id => { const p = t.publications.find(x => x.id === id); return { publication_id: id, revision_id: p.current_revision_id, variant_id: t.publication_variants.find(v => v.publication_id === id).id, platform: p.platform }; }) }; },
    publication_agent_v2_media_attach: (a, t) => { const r = run(t, a.p_run_id), asset = t.whatsapp_assets.find(x => x.id === r.selected_library_asset_id);
      for (const x of a.p_assets) t.whatsapp_asset_uses.push({ client_id: C, asset_id: asset.id, publication_id: x.publication_id, platform: t.publications.find(p => p.id === x.publication_id).platform, used_at: now.toISOString(), derivative: [x.width, x.height] });
      Object.assign(asset, { claimed_agent_v2_run_id: null, library_status: "used" }); r.media_status = "attached"; return { media_status: "attached" }; },
    publication_submit_manual: (a, t) => { const p = t.publications.find(x => x.id === a.p_publication_id); if (p.status !== "draft" || p.current_revision_id !== a.p_revision_id) throw Error("stale"); p.status = "pending_review"; return null; },
    publication_scheduled_delivery_candidates: candidates,
    publication_prepare_delivery: (a, t) => { const p = t.publications.find(x => x.id === a.p_publication_id); if (p.status !== "approved") throw Error("not approved"); t.publication_deliveries.push({ publication_id: p.id, revision_id: p.current_revision_id, status: "scheduled", actor: a.p_actor_id }); return { publication_id: p.id }; },
  } });
  const stored = [];
  fake.client.storage = { from: () => ({ upload: async path => { stored.push(path); return { error: null }; }, remove: async () => ({ error: null }) }) };
  // Génération simulée qui suit le plan éditorial du serveur (comme le modèle y est invité) : une seule par préparation.
  const inputs = [];
  const generator = { generate: async input => { inputs.push(input); const plan = input.editorial.plan, service = plan.favouredServices[0] ?? input.services.find(s => !plan.deprioritised.some(d => d.service === s)) ?? input.services[0];
    const photo = input.media.find(m => !m.used && (m.services ?? []).includes(service)) ?? null, low = service.toLocaleLowerCase("fr");
    const output = { idea: { subject: `${service} : repères pour votre logement`, angle: `Expliquer simplement ${low}.` }, publications: input.occurrences.map(o => ({ occurrenceId: o.occurrenceId, platform: o.platform, mediaId: photo?.id ?? null,
      text: o.platform === "facebook" ? `Comment savoir quand penser à ${low} ? Quelques repères simples avant de nous solliciter.` : o.platform === "instagram" ? `${service}, en une image. #${client.key} #renovation` : `${service} : ${input.client.name} vous accompagne${input.client.zone ? ` à ${input.client.zone}` : ""}, avec des explications claires.`,
      cta: o.platform === "facebook" ? CTA_BY_STYLE[plan.ctaStyle] : null })) };
    return { output: client.override ? client.override(output) : output, usage: { input_tokens: 900, output_tokens: 300, estimated_cost_eur: 0.0004, model: "gpt-4.1-mini-2025-04-14" } }; } };
  const fetched = [];
  const service = load("lib/publications/agent-v2/service.ts", {
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: ADMIN }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client },
    "../project-channels": { getPublicationProjectChannels: async () => ({ source: "configured", channels: [], platforms: PLATFORMS, legacyAligned: true }) },
    "./openai-generator": { openaiAgentV2Generator: () => generator }, "./media-runs": { getAgentV2RunMedia: async () => ({ media: { preview: null } }) },
    "../media/source": { driveMediaSource: () => ({ fetchMedia: async ref => { fetched.push(ref); return { bytes: JPEG, mimeType: "image/jpeg" }; } }) },
    "../media/transform": { adaptImage: async (_b, platform) => ({ bytes: new Uint8Array([255, 216, 255, platform.length]), width: platform === "google_business_profile" ? 1200 : 1080, height: platform === "google_business_profile" ? 900 : 1080, mime_type: "image/jpeg" }) } });
  const scheduler = load("lib/publications/automation/scheduled.ts", {
    "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client }, "@/lib/admin-policy": { isAuthorizedAdmin: id => id === ADMIN }, "@/lib/core/audit": { writeAudit: async () => {} },
    // Aucun second moteur : le planificateur appelle l'Agent v2 réel chargé ci-dessus.
    "../agent-v2/service": service,
    "../delivery/registry": { SCHEDULED_LATE_TOLERANCE_SECONDS: 7200, scheduledDeliveryEnabled: env => env.PUBLICATIONS_SCHEDULED_DELIVERY === "enabled" } });
  const audits = [];
  const deps = { prepare: service.prepareNextPublicationsAs, isAdmin: id => id === ADMIN, audit: async (actor, entry) => { audits.push([actor, entry]); }, retryMedia: (u, r) => service.retryAgentV2MediaAs(u, r) };
  return { C, P, A, fake, tables: fake.tables, service, scheduler, deps, inputs, fetched, stored, audits };
}
const enabled = { PUBLICATIONS_SCHEDULED_DELIVERY: "enabled" };
// Décision humaine (bouton « À publier » du panneau) : jamais prise par le planificateur ni par l'agent.
const humanApproves = (t, id) => { const p = t.publications.find(x => x.id === id); p.status = "approved"; t.publication_reviews.push({ publication_id: id, revision_id: p.current_revision_id, decision: "approved", actor_id: ADMIN, created_at: "2026-10-13T09:00:00Z" }); };
// Modification après approbation (publication_save_draft) : nouvelle révision en brouillon, à revalider.
const humanEdits = (t, id) => { const p = t.publications.find(x => x.id === id); p.current_revision_id = uid("c", Number(id.slice(-4))); p.status = "draft"; };

for (const client of CLIENTS.filter(c => c.key !== "codev")) {
  test(`phase 2 — ${client.name} : photo importée et classée → sujet + photo → 3 textes natifs → validation humaine → diffusion seulement avec le drapeau`, async () => {
    const w = world(client), t = w.tables;
    const summary = await w.scheduler.runScheduledPreparation(now, w.deps);
    assert.deepEqual(json(summary), { clients: 1, preparations: 1, submitted: 3, notified: 1, skipped: {}, followUp: { runs: 0, attached: 0, submitted: 0, gaveUp: 0 } });
    // Un seul appel au générateur (aucun appel IA par photo candidate) avec un contexte éditorial compact.
    assert.equal(w.inputs.length, 1);
    const input = w.inputs[0], plan = input.editorial.plan, offered = input.media.filter(m => !m.used).map(m => m.id);
    assert.equal(input.editorial.history.length, client.history.length);
    for (const [i, [description, , extra = {}, tag]] of client.photos.entries()) {
      const document = /Attestation|Facture|Capture/.test(description) || extra.confidential;
      if (document || tag === "used" || tag === "copy") assert.ok(!offered.includes(w.A(i + 1)), `${description} never offered`);
    }
    const recent = client.history[0][0];
    assert.ok(plan.deprioritised.some(d => recent.toLocaleLowerCase("fr").normalize("NFD").replace(/[̀-ͯ]/g, "").includes(d.service.toLocaleLowerCase("fr").normalize("NFD").replace(/[̀-ͯ]/g, "").split(" ").at(-1))), `recent service deprioritised (${JSON.stringify(plan.deprioritised)})`);
    // Trois brouillons distincts, un par plateforme, soumis « À valider », jamais approuvés ni diffusés.
    const run = t.publication_agent_v2_runs[0], created = t.publications.filter(p => run.publication_ids.includes(p.id));
    assert.deepEqual(json(created.map(p => p.platform)), PLATFORMS);
    assert.ok(created.every(p => p.status === "pending_review"), "human approval required");
    const texts = t.publication_variants.filter(v => run.publication_ids.includes(v.publication_id)).map(v => v.text_content);
    assert.equal(new Set(texts).size, 3, "3 distinct variants");
    const gbp = t.publication_variants.find(v => v.publication_id === created[2].id).text_content;
    assert.doesNotMatch(gbp, /#/, "no hashtag on GBP");
    if (client.zone) assert.match(gbp, new RegExp(`à ${client.zone}`), "only the client's own zone is named");
    assert.ok(!plan.deprioritised.some(d => created[0].subject.startsWith(d.service)), `subject avoids recently highlighted services: ${created[0].subject}`);
    // Une seule photo, celle de la prestation du sujet, un dérivé par plateforme, relue depuis l'import (accès de son origine).
    const uses = t.whatsapp_asset_uses.filter(u => run.publication_ids.includes(u.publication_id));
    assert.equal(uses.length, 3); assert.equal(new Set(uses.map(u => u.asset_id)).size, 1);
    const chosen = input.media.find(m => m.id === uses[0].asset_id);
    assert.ok(chosen.services.some(s => created[0].subject.startsWith(s)), "photo selected for the chosen subject");
    assert.deepEqual(json(w.fetched.map(f => [f.source, f.origin])), [["library", "whatsapp_export"]]);
    assert.deepEqual(json(uses.map(u => u.derivative)), [[1080, 1080], [1080, 1080], [1200, 900]]);
    // Justification éditoriale enregistrée avec le run, sans légende ni identifiant Drive.
    assert.equal(run.editorial_justification.outcome, "prepared");
    assert.equal(run.editorial_justification.history.length, client.history.length);
    assert.ok(run.editorial_justification.deprioritised.length >= 1);
    assert.doesNotMatch(JSON.stringify(run.editorial_justification) + JSON.stringify(w.inputs), /Message privé du client|wa_export_|folder_wa_/);
    assert.ok(!w.fake.calls.some(c => c[0] === "rpc" && /approve|review_manual|prepare_delivery/.test(c[1])), "the scheduler never approves nor delivers");
    assert.deepEqual(json(t.admin_notifications.map(n => n.category)), ["publication_review"]);

    // Diffusion : drapeau absent → rien n'est lu ni préparé, même après approbation.
    for (const id of run.publication_ids) humanApproves(t, id);
    const calls = w.fake.calls.length;
    assert.equal((await w.scheduler.prepareApprovedDeliveries({}, now)).disabled, "flag");
    assert.equal(w.fake.calls.length, calls, "flag absent: nothing read"); assert.equal(t.publication_deliveries.length, 0);
    // Une modification après approbation repasse en brouillon : elle doit être revalidée avant toute diffusion.
    humanEdits(t, run.publication_ids[1]);
    const delivered = await w.scheduler.prepareApprovedDeliveries(enabled, now, { isAdmin: id => id === ADMIN });
    assert.equal(delivered.prepared, 2);
    assert.deepEqual(json(t.publication_deliveries.map(d => d.publication_id).sort()), [run.publication_ids[0], run.publication_ids[2]].sort());
    assert.ok(t.publication_deliveries.every(d => d.actor === ADMIN), "delivered in the name of the human approver");
    // Créneau manqué (au-delà de la tolérance) : rien n'est envoyé en retard, l'admin est notifié une fois.
    humanApproves(t, run.publication_ids[1]);
    const late = await w.scheduler.prepareApprovedDeliveries(enabled, new Date("2026-10-14T19:00:00Z"), { isAdmin: id => id === ADMIN });
    assert.equal(late.late, 1); assert.equal(late.prepared, 0);
    assert.ok(t.admin_notifications.some(n => n.category === "delivery_failed" && n.event_key.startsWith(`publication-missed:${run.publication_ids[1]}`)));
  });
}

test("phase 2 — CODE-V : aucune photo utilisable (capture d'écran, facture) → brouillons sans photo, « Photo manquante » notifiée, jamais soumis", async () => {
  const codev = CLIENTS.find(c => c.key === "codev"), w = world(codev), t = w.tables;
  const summary = await w.scheduler.runScheduledPreparation(now, w.deps);
  assert.equal(summary.preparations, 1); assert.equal(summary.submitted, 0);
  assert.deepEqual(json(w.inputs[0].media.filter(m => !m.used)), [], "screenshot and invoice never offered");
  const run = t.publication_agent_v2_runs[0];
  assert.ok(t.publications.filter(p => run.publication_ids.includes(p.id)).every(p => p.status === "draft"), "approval impossible while the photo is missing");
  assert.ok(t.admin_notifications.some(n => n.category === "media_missing" && n.href === `/clients/${w.C}?tab=media`));
  const health = load("lib/publications/editorial-health.ts", { "@/lib/require-admin": { requireAdmin: async () => {} }, "@/lib/supabase/server": { getSupabaseServerClient: () => w.fake.client } });
  const lacking = await health.listClientsLackingPhotos({ now });
  assert.deepEqual(json(lacking.map(h => [h.clientName, h.usable, h.documents, h.servicesLacking])), [["CODE-V", 0, 2, ["Création de site", "Référencement local"]]]);
});

test("phase 2 — refus clair et enregistré : lieu inventé → aucun brouillon, motif dans la justification, projet en pause", async () => {
  const catalane = { ...CLIENTS.find(c => c.key === "catalane"), override: o => ({ ...o, publications: o.publications.map(p => p.platform === "google_business_profile" ? { ...p, text: p.text.replace("à Perpignan", "à Narbonne") } : p) }) };
  const w = world(catalane), t = w.tables;
  const summary = await w.scheduler.runScheduledPreparation(now, w.deps);
  assert.equal(summary.skipped.preparation_refused, 1);
  const run = t.publication_agent_v2_runs[0];
  assert.deepEqual(json([run.status, run.error_code]), ["failed", "invalid_output"]);
  assert.deepEqual(json(run.editorial_justification.refusal), { reason: "place_not_allowed", detail: "lieu absent des données du client : Narbonne" });
  assert.equal(t.publications.filter(p => p.status !== "approved").length, 0, "no draft written");
  assert.ok(t.whatsapp_assets.every(a => !a.claimed_agent_v2_run_id), "no photo reserved");
  // Échec récent : aucun nouvel appel IA avant la fin de la pause (budget partagé).
  const again = await w.scheduler.runScheduledPreparation(new Date(now.getTime() + 3600000), w.deps);
  assert.equal(again.skipped.failure_backoff, 1); assert.equal(w.inputs.length, 1);
  // Le message de l'agent donne le motif précis.
  const direct = world(catalane);
  const r = await direct.service.prepareNextPublicationsAs(ADMIN, direct.P, { allowRealAI: true, now, leadDays: 3 });
  assert.equal(r.ok, false); assert.match(r.message, /lieu absent des données du client.*Motif : lieu absent des données du client : Narbonne\./);
});

test("phase 2 — un seul moteur : le planificateur, l'action manuelle et la reprise média passent par l'Agent v2 existant", () => {
  assert.match(src("lib/publications/automation/scheduled.ts"), /import \{NO_OPEN_OCCURRENCE,prepareNextPublicationsAs,retryAgentV2MediaAs,type AgentV2Result,type PrepareOptions\} from '\.\.\/agent-v2\/service'/);
  const service = src("lib/publications/agent-v2/service.ts");
  assert.equal((service.match(/publication_agent_v2_finish/g) ?? []).length, 1);
  assert.match(service, /validateGeneratorOutput\(context\.input,raw\)/);
  for (const f of ["editorial-plan", "editorial-guards", "editorial-memory", "editorial-health", "editorial-history"]) assert.doesNotMatch(src(`lib/publications/${f}.ts`), /structuredResponse|publication_agent_v2_finish|publication_prepare_delivery/, f);
});
