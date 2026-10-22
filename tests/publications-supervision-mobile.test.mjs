// Socle Publications, lot 7 (mobile) : supervision pilotable depuis un téléphone. Navigation sur une seule page
// (?view=, ?client=), cartes de validation avec aperçu par plateforme, reconnexion OAuth existante, état de l'agent,
// photothèque derrière un point de lecture unique, raccourcis. Mise en page vérifiée à 375 px dans Chromium (sans réseau).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load, src, json, uid, root } from "./helpers/ts-load.mjs";
import { createFakeSupabase } from "./helpers/fake-supabase.mjs";

const C = uid("1", 1), C2 = uid("1", 2), P = uid("3", 1), PUB = n => uid("4", n), REV = n => uid("5", n), OCC = n => uid("6", n), A = n => uid("a", n), CONN = n => uid("c", n);
const now = new Date("2026-10-12T08:00:00Z");
const at = h => new Date(now.getTime() + h * 3600000).toISOString();
const view = load("lib/publications/supervision-view.ts");
const model = load("lib/publications/supervision-model.ts");

test("deep link: view and client parsed strictly; unknown values fall back to the overview and all clients", () => {
  assert.deepEqual(json(view.parseSupervisionQuery({ view: "review", client: C }, [C, C2])), { view: "review", client: C });
  assert.deepEqual(json(view.parseSupervisionQuery({}, [C])), { view: "overview", client: null });
  assert.deepEqual(json(view.parseSupervisionQuery({ view: "drop table", client: "x" }, [C])), { view: "overview", client: null });
  assert.equal(view.parseSupervisionQuery({ client: uid("1", 9) }, [C]).client, null, "a client absent from the supervision is ignored");
  assert.equal(view.parseSupervisionQuery({ view: ["errors", "review"] }, []).view, "errors");
  assert.equal(view.supervisionHref("review", C), `/publications/supervision?view=review&client=${C}`);
  assert.equal(view.supervisionHref("overview", null), "/publications/supervision");
  assert.equal(view.supervisionHref("overview", C), `/publications/supervision?client=${C}`);
  assert.deepEqual([...view.SUPERVISION_VIEWS], ["overview", "review", "errors", "scheduled", "accounts", "photos", "agent"]);
  // Les paramètres sont documentés à côté du code et dans la doc.
  assert.match(src("lib/publications/supervision-view.ts"), /view\s+= overview \(défaut\) \| review \| errors \| scheduled \| accounts \| photos \| agent/);
  assert.match(src("docs/publications-supervision-mobile.md"), /\?view=review&client=/);
});

const pubView = (n, clientId, extra = {}) => ({ id: PUB(n), clientId, projectId: P, platform: "facebook", subject: `Sujet ${n}`, status: "approved", revisionId: REV(n), occurrenceId: OCC(n), scheduledFor: at(10 + n), delivery: "scheduled", cancellable: [], targets: [], errorReason: null, ...extra });
const clientView = (id, name, extra = {}) => ({ id, name, autoPrepare: false, generation: false, leadDays: 3, photos: { available: 8, capped: false, rejected: 0, toReview: 1 }, tooFewPhotos: false, agentProjects: [], accounts: [], projectId: P, lastRun: null, ...extra });
const supervision = () => ({
  settings: { emergencyStop: false, automation: true, generation: true, publishing: false }, scheduledDelivery: false,
  clients: [clientView(C, "JRenov", { accounts: [{ id: A(1), clientId: C, platform: "instagram", name: "jrenov.officiel", state: "reconnect", reason: "Connexion expirée" }], tooFewPhotos: true, photos: { available: 2, capped: false, rejected: 1, toReview: 0 },
    autoPrepare: true, generation: true, agentProjects: [P], lastRun: { state: "failed", label: "Dernière préparation en échec", reason: "Génération en échec", at: at(-3) } }),
    clientView(C2, "Couverture Catalane", { accounts: [{ id: A(2), clientId: C2, platform: "google_business_profile", name: "Couverture Catalane — Perpignan", state: "connected", reason: null }] })],
  scheduled: [pubView(1, C, { targets: [{ id: OCC(9), scheduledFor: at(48) }], cancellable: [uid("d", 1)] }), pubView(2, C2)],
  errors: [pubView(3, C, { delivery: "error", errorReason: "Autorisation refusée ou révoquée (token_expired)" })], published: [pubView(4, C2, { delivery: "published" })],
  tasks: [{ occurrenceId: OCC(7), clientId: C, projectId: P, platform: "instagram", scheduledFor: at(30), prepareFrom: at(0), automatic: true }],
  counts: { pendingReview: 1, scheduled: 2, published: 1, errors: 1, connected: 1, reconnect: 1 },
});

test("client filter: lists and counts follow the selected client, without any new read", () => {
  const data = supervision();
  const filtered = json(view.filterSupervision(data, C, [{ clientId: C }, { clientId: C2 }, { clientId: C }]));
  assert.deepEqual(filtered.clients.map(c => c.id), [C]); assert.deepEqual(filtered.scheduled.map(p => p.id), [PUB(1)]);
  assert.deepEqual(filtered.counts, { pendingReview: 2, scheduled: 1, published: 0, errors: 1, connected: 0, reconnect: 1 });
  assert.equal(view.filterSupervision(data, null, [{ clientId: C }, { clientId: C2 }]).counts.pendingReview, 2, "review count = full review queue");
  assert.deepEqual(json(view.supervisionBadges(data)), { overview: null, review: 1, errors: 1, scheduled: 2, accounts: 1, photos: 1, agent: 1 });
});

test("agent status and reconnect provider: safe labels only", () => {
  assert.deepEqual(json(model.agentRunView({ status: "failed", error_code: "generation_failed", created_at: at(-2), completed_at: at(-1) })), { state: "failed", label: "Dernière préparation en échec", reason: "Génération en échec", at: at(-1) });
  assert.equal(model.agentRunView({ status: "failed", error_code: "weird", created_at: at(-2), completed_at: null }).reason, "Échec non identifié");
  assert.equal(model.agentRunView({ status: "processing", error_code: null, created_at: at(-2), completed_at: null }).state, "running");
  assert.equal(model.providerOfPlatform("instagram"), "meta"); assert.equal(model.providerOfPlatform("google_business_profile"), "google_business_profile");
});

// --- Lecture : état de l'agent, projet de reconnexion, photothèque derrière un seul point de lecture ---
function service(tables, options = {}) {
  const fake = createFakeSupabase(tables, options);
  return { fake, mod: load("lib/publications/supervision.ts", { "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) }, "@/lib/supabase/server": { getSupabaseServerClient: () => fake.client } }) };
}
const tables = () => ({
  publication_settings: [{ emergency_stop: true, automation_enabled: false, generation_enabled: false, publishing_enabled: false }],
  clients: [{ id: C, name: "JRenov" }],
  publication_client_settings: [{ client_id: C, auto_prepare_enabled: true, generation_enabled: true, prepare_lead_days: 2, media_reuse_allowed: false, media_reuse_after_days: 180 }],
  publication_agent_projects: [{ project_id: P, client_id: C, enabled: true, rights_confirmed: true }],
  publication_accounts: [{ id: A(1), client_id: C, platform: "facebook", display_name: "Page JRenov", status: "active", enabled: true, connection_id: CONN(1) }],
  client_connections: [{ id: CONN(1), client_id: C, provider: "meta", status: "expired", expires_at: null }],
  publications: [], publication_channel_occurrences: [], publication_deliveries: [],
  publication_agent_v2_runs: [{ client_id: C, status: "failed", error_code: "context_unavailable", created_at: at(-5), completed_at: at(-5), generated_text: "texte généré secret" },
    { client_id: C, status: "completed", error_code: null, created_at: at(-50), completed_at: at(-49) }],
  whatsapp_assets: [], whatsapp_asset_assessments: [], whatsapp_asset_uses: [],
});

test("supervision read: agent status per client, a project for the existing OAuth flow, photos via one swappable function", async () => {
  const s = json(await service(tables()).mod.getSupervision(now));
  const c = s.clients[0];
  assert.deepEqual(c.lastRun, { state: "failed", label: "Dernière préparation en échec", reason: "Contexte du client indisponible", at: at(-5) });
  assert.equal(c.projectId, P); assert.equal(c.tooFewPhotos, true); assert.equal(c.photos.available, 0);
  assert.doesNotMatch(JSON.stringify(s), /texte généré secret/);
  const sup = src("lib/publications/supervision.ts");
  assert.doesNotMatch(sup, /whatsapp_assets|whatsapp_asset_uses|whatsapp_asset_assessments/, "library read only in supervision-photos.ts");
  assert.match(sup, /loadClientPhotoCoverage\(/);
  assert.match(src("lib/publications/supervision-photos.ts"), /POINT DE REMPLACEMENT UNIQUE/);
  for (const file of ["lib/publications/supervision-photos.ts", "lib/publications/supervision-view.ts", "lib/publications/supervision-review.ts"]) assert.doesNotMatch(src(file), /process\.env|fetch\(|https:\/\//, file);
});

test("supervision read: an unreadable library is « illisible », never « trop peu »; a failing agent-run read never breaks the page", async () => {
  const s = json(await service(tables(), { failOn: table => table === "whatsapp_assets" || table === "publication_agent_v2_runs" }).mod.getSupervision(now));
  assert.equal(s.clients[0].photos, null); assert.equal(s.clients[0].tooFewPhotos, false); assert.equal(s.clients[0].lastRun, null);
});

// --- Rendu des composants et de la page (sans réseau ; actions serveur remplacées par des leurres) ---
const Link = ({ href, children, ...rest }) => { delete rest.scroll; delete rest.prefetch; return React.createElement("a", { href, ...rest }, children); };
const action = async () => ({});
const mocks = (extra = {}) => ({
  "next/link": { __esModule: true, default: Link },
  "@/app/(cockpit)/publications/review-actions": { approveFromCardAction: action, approveGroupFromCardAction: action, rejectFromCardAction: action, editFromCardAction: action },
  "@/app/(cockpit)/publications/supervision-actions": { rescheduleAction: action, suspendDeliveryAction: action, suspendClientAction: action },
  "@/app/(cockpit)/publications/connection-actions": { startOAuthAction: action },
  "@/app/(cockpit)/publications/agent-v2-actions": { prepareNextPublicationsAction: action, retryAgentV2MediaAction: action },
  "./agent-forms": { AgentPrepareForm: () => null },
  "@/components/projects/debug-details": { DebugDetails: () => null },
  ...extra,
});
const photo = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='900'/>";
const variant = (platform, label, extra = {}) => ({ platform, label, text: "Chantier terminé à Perpignan : toiture refaite en tuiles canal, zinguerie neuve et nettoyage complet. Devis gratuit sous 48 h.", title: null, cta: null, assetIds: [A(9)], media: { state: "ok", preview: photo }, ...extra });
const reviewItem = (n, clientName, variants) => ({ variants, card: { publicationId: PUB(n), revisionId: REV(n), clientId: C, projectId: P, status: "pending_review", date: "2026-10-14", subject: `Toiture-refaite-sans-espaces-${"x".repeat(60)}`, clientName, projectName: "Site",
  image: photo, variants: variants.map(v => ({ platform: v.platform, label: v.label, text: v.text, title: v.title, cta: v.cta, assetIds: v.assetIds })), editorial: { title: "Toiture", angle: "Toiture", source: "Toiture", targetDate: "2026-10-14" }, rejection: null, versions: [], debug: null } });
const items = () => [reviewItem(1, "Couverture Catalane", [variant("facebook", "Facebook"), variant("instagram", "Instagram"), variant("google_business_profile", "Google Business Profile", { title: "Toiture neuve", cta: "Demander un devis" })]),
  reviewItem(2, "JRenov", [variant("facebook", "Facebook", { assetIds: [], media: { state: "missing", preview: null } })])];

test("previews: one rendering per platform with its own photo; a missing photo blocks approval with the existing rule", () => {
  const preview = load("components/publications/supervision-preview.tsx", mocks());
  const html = p => renderToStaticMarkup(React.createElement(preview.VariantPreview, { variant: p, accountName: "Couverture Catalane" }));
  assert.match(html(variant("instagram", "Instagram")), /data-preview="instagram"[\s\S]*<img[^>]*aspect-square/);
  const gbp = html(variant("google_business_profile", "Google Business Profile", { title: "Toiture neuve", cta: "Demander un devis" }));
  assert.match(gbp, /data-preview="google_business_profile"[\s\S]*Toiture neuve[\s\S]*Demander un devis/);
  assert.match(html(variant("facebook", "Facebook", { media: { state: "missing", preview: null } })), /data-media-missing="missing"[\s\S]*Photo manquante/);
  assert.match(html(variant("facebook", "Facebook", { media: { state: "unavailable", preview: null } })), /Photo indisponible/);
  const card = load("components/publications/supervision-review-card.tsx", mocks());
  const ok = renderToStaticMarkup(React.createElement(card.SupervisionReviewCard, { item: items()[0] }));
  assert.equal((ok.match(/role="tabpanel"/g) ?? []).length, 3); assert.match(ok, /Valider/); assert.match(ok, /Rejeter/); assert.match(ok, /Modifier/);
  const missing = renderToStaticMarkup(React.createElement(card.SupervisionReviewCard, { item: items()[1] }));
  assert.match(missing, /data-media-required="true"/, "same client-side rule as the review queue; the server stays authoritative");
  assert.doesNotMatch(ok + missing, /#[0-9a-fA-F]{3,6}\b|rgb\(|(?:text|bg|border)-(?:red|amber|emerald|green|sky|blue|gray|slate)-\d/);
});

async function renderPage(search, overrides = {}) {
  const data = overrides.data ?? supervision();
  const pending = [{ id: PUB(1), status: "pending_review", archived_at: null, client_id: C2, client: { name: "Couverture Catalane" } }, { id: PUB(2), status: "pending_review", archived_at: null, client_id: C, client: { name: "JRenov" } }];
  let built = null;
  const page = load("app/(cockpit)/publications/supervision/page.tsx", mocks({
    "@/lib/require-admin": { requireAdmin: async () => ({ userId: "user_admin" }) },
    "@/lib/publications/supervision": { getSupervision: async () => data },
    "@/lib/system/providers": { isFlagEnabled: () => false },
    "@/lib/publications/data": { listPublications: async () => pending },
    "@/lib/publications/supervision-review": { SUPERVISION_REVIEW_LIMIT: 10, buildSupervisionReviewItems: async list => { built = list.map(p => p.id); return items(); } },
    "@/components/publications/publications-board": { PublicationsNav: () => null },
  }));
  const element = await page.default({ searchParams: Promise.resolve(search) });
  return { html: renderToStaticMarkup(element), built };
}

test("page: one hub with sticky tabs and client filter; each view renders its section; previews loaded only for « À valider »", async () => {
  const overview = await renderPage({});
  assert.match(overview.html, /data-supervision-tabs="true"/); assert.match(overview.html, /data-client-filter="true"/);
  assert.match(overview.html, /aria-current="page"[^>]*>Synthèse/); assert.equal(overview.built, null, "no signed preview outside the review tab");
  assert.match(overview.html, /href="\/publications\/supervision\?view=review"/);
  const review = await renderPage({ view: "review", client: C });
  assert.deepEqual(review.built, [PUB(2)], "review queue filtered by client before loading previews");
  assert.match(review.html, /data-supervision-review=/); assert.match(review.html, new RegExp(`href="/publications/supervision\\?view=errors&amp;client=${C}"`), "tabs keep the client");
  const accounts = await renderPage({ view: "accounts" });
  assert.match(accounts.html, /data-reconnect="meta"/, "Instagram account to reconnect → existing Meta OAuth flow"); assert.match(accounts.html, /name="return_view" value="client"/);
  const errors = await renderPage({ view: "errors" });
  assert.match(errors.html, /Autorisation refusée ou révoquée \(token_expired\)/);
  const scheduled = await renderPage({ view: "scheduled" });
  assert.match(scheduled.html, /data-reschedule-form="true"/); assert.match(scheduled.html, /data-suspend-delivery="true"/); assert.match(scheduled.html, /\/edit"/);
  const photos = await renderPage({ view: "photos" });
  assert.match(photos.html, /data-too-few-photos="true"/);
  const agent = await renderPage({ view: "agent" });
  assert.match(agent.html, /data-agent-run="failed"/); assert.match(agent.html, /Génération en échec/); assert.match(agent.html, /data-suspend-client="true"/); assert.match(agent.html, /Prochaines tâches de l’agent/);
});

test("shortcuts: dashboard card, sidebar and mobile menu link to the supervision", () => {
  const nav = src("components/layout/navigation.tsx"), home = src("app/(cockpit)/dashboard/page.tsx");
  assert.match(nav, /data-supervision-shortcut="sidebar"/); assert.match(nav, /data-supervision-shortcut="mobile"/);
  assert.match(home, /data-supervision-shortcut="dashboard"/); assert.match(home, /"\/publications\/supervision\?view=review"/);
  for (const file of ["components/layout/navigation.tsx", "app/(cockpit)/dashboard/page.tsx", "components/publications/supervision-tabs.tsx", "components/publications/supervision-preview.tsx", "components/publications/supervision-review-card.tsx", "app/(cockpit)/publications/supervision/page.tsx"])
    assert.doesNotMatch(src(file), /#[0-9a-fA-F]{3,6}\b|rgb\(|(?:text|bg|border)-(?:red|amber|emerald|green|sky|blue|gray|slate)-\d/, file);
});

// --- Mise en page à 375 px (Chromium local, CSS Tailwind réel compilé depuis app/globals.css, aucun réseau) ---
const CHROMIUM = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find(p => existsSync(p));
test("layout at 375 px: no horizontal page scroll in any view, tabs stay visible when scrolling", { skip: CHROMIUM ? false : "Chromium absent" }, async () => {
  const [{ chromium }, { default: postcss }, { default: tailwind }, { readFileSync }] = await Promise.all([import("playwright"), import("postcss"), import("@tailwindcss/postcss"), import("node:fs")]);
  const css = (await postcss([tailwind({ base: root })]).process(readFileSync(`${root}/app/globals.css`, "utf8"), { from: `${root}/app/globals.css` })).css;
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
    await page.route("**/*", route => route.request().url().startsWith("data:") ? route.continue() : route.abort());
    for (const v of ["overview", "review", "errors", "scheduled", "accounts", "photos", "agent"]) {
      const { html } = await renderPage({ view: v });
      await page.setContent(`<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="bg-background text-foreground"><main class="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-10">${html}<div style="height:2000px"></div></main></body></html>`);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(width <= 375, `${v}: page scroll width ${width}px > 375px`);
      const offenders = await page.evaluate(() => [...document.querySelectorAll("main *")].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > 375.5 || r.left < -0.5) && !el.closest("[data-supervision-tabs] ul"); }).slice(0, 3).map(el => el.outerHTML.slice(0, 120)));
      assert.deepEqual(offenders, [], `${v}: elements overflow the viewport`);
      await page.evaluate(() => window.scrollTo(0, 900));
      const top = await page.evaluate(() => document.querySelector("[data-supervision-tabs]").getBoundingClientRect().top);
      assert.ok(Math.abs(top) < 1, `${v}: tabs sticky at the top (top=${top})`);
      if (v === "review") {
        const imgs = await page.evaluate(() => [...document.querySelectorAll("[data-preview] img")].map(i => Math.round(i.getBoundingClientRect().width)));
        assert.ok(imgs.length >= 1 && imgs.every(w => w <= 335), `preview photos fit the card (${imgs})`);
      }
    }
  } finally { await browser.close(); }
});
