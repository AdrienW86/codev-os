// Agent Blog : réglages, échéance, slug, contrôle de l'article, rendu HTML sûr, relais par réseau, API publique, câblage.
import test from "node:test";
import assert from "node:assert/strict";
import { load, json, form, src } from "./helpers/ts-load.mjs";

const m = load("lib/blog-agent/model.ts");
const now = new Date("2026-11-04T12:07:00Z");
const daysAgo = (d) => new Date(now.getTime() - d * 86400000).toISOString();
const FACTS = "Toiture Exemple\nCouvreur\nPerpignan\nDémoussage\nRéparation de toiture";
const paragraph = "Une toiture bien entretenue protège durablement la maison contre les infiltrations et les dégâts liés aux intempéries. Un contrôle visuel régulier permet de repérer les tuiles déplacées, les mousses installées et les gouttières encombrées avant qu’ils ne deviennent un vrai problème pour la couverture.";
const body = ["Introduction claire sur le sujet de l’article et sur ce que le lecteur va apprendre.", "",
  "## Pourquoi entretenir sa toiture", "", paragraph, "", paragraph, "", paragraph, "",
  "## Les signes qui doivent alerter", "", "- Des tuiles **déplacées** ou cassées", "- De la mousse sur les versants exposés au nord", "", paragraph, "", paragraph, "", paragraph, "",
  "## Comment se déroule un démoussage", "", paragraph, "", paragraph, "", paragraph, "", "Il est conseillé de faire contrôler sa toiture tous les 5 ans et de la traiter entre 10 et 15 ans selon l’exposition.", "",
  "## En résumé", "", paragraph, "", paragraph, "", paragraph, "", "Pour un conseil adapté à votre maison, contactez notre équipe."].join("\n");
const good = {
  title: "Démoussage de toiture : quand et pourquoi le faire",
  meta_description: "Mousses, tuiles abîmées, infiltrations : nos conseils pour savoir quand prévoir un démoussage de toiture à Perpignan.",
  excerpt: "La mousse abîme les tuiles plus qu’on ne le croit. Voici comment repérer les signes et quand agir.",
  image_alt: "Toiture en tuiles couverte de mousse avant démoussage",
  body_markdown: body,
  social: {
    facebook: "La mousse sur votre toiture n’est pas qu’une question d’esthétique : elle retient l’humidité et fragilise les tuiles. Nos conseils pour savoir quand agir.",
    instagram: "Mousse sur le toit ? Voici les signes qui doivent vous alerter et le bon moment pour un démoussage. #toiture #demoussage #perpignan",
    google_business_profile: "Nouvel article : comment savoir s’il est temps de démousser votre toiture, et pourquoi c’est important pour éviter les infiltrations.",
  },
};

test("settings: site normalised to https without path, 1 or 2 articles a week, site required to enable, relay opt-in", () => {
  assert.equal(m.normalizeSiteUrl("www.Code-V.fr/"), "https://www.code-v.fr");
  assert.equal(m.normalizeSiteUrl("http://exemple.fr/blog?x=1"), "https://exemple.fr");
  for (const bad of ["", "pas un site", "https://user:pw@exemple.fr", "https://localhost:3000"]) assert.equal(m.normalizeSiteUrl(bad), null, bad);
  assert.deepEqual(json(m.parseBlogSettingsForm(form({ enabled: "on", per_week: "2", site_url: "exemple.fr", blog_path: "actualites/", social_relay: "on" }))),
    { enabled: true, perWeek: 2, siteUrl: "https://exemple.fr", blogPath: "/actualites", socialRelay: true });
  assert.ok("error" in m.parseBlogSettingsForm(form({ enabled: "on", per_week: "1", site_url: "" })), "site required when enabled");
  assert.ok("error" in m.parseBlogSettingsForm(form({ per_week: "3", site_url: "exemple.fr" })));
  assert.ok("error" in m.parseBlogSettingsForm(form({ per_week: "1", site_url: "exemple.fr", blog_path: "/Blog Perso" })));
  assert.equal(m.parseBlogSettingsForm(form({ per_week: "1", site_url: "exemple.fr" })).socialRelay, false, "relay is never on by default");
  assert.deepEqual(json(m.blogSettingsFromRow(null)), json(m.DEFAULT_BLOG_SETTINGS));
});

test("due: needs a site, at most per_week a week (cancelled included), spread out; publication 24 h later on a quarter hour", () => {
  const s = { enabled: true, perWeek: 1, siteUrl: "https://exemple.fr" };
  assert.equal(m.blogDue({ ...s, siteUrl: null }, [], now), false);
  assert.equal(m.blogDue({ ...s, enabled: false }, [], now), false);
  assert.equal(m.blogDue(s, [], now), true);
  assert.equal(m.blogDue(s, [{ created_at: daysAgo(4) }], now), false);
  assert.equal(m.blogDue({ ...s, perWeek: 2 }, [{ created_at: daysAgo(3) }], now), true);
  assert.equal(m.blogDue({ ...s, perWeek: 2 }, [{ created_at: daysAgo(2) }], now), false, "spread: 80 % of 3.5 days");
  assert.equal(m.publishAtFrom(now).toISOString(), "2026-11-05T12:15:00.000Z");
});

test("service rotation, angles, slug without accents and unique per client", () => {
  assert.equal(m.nextBlogService(["Démoussage", "Réparation"], [{ service: "Démoussage", created_at: daysAgo(3) }]), "Réparation");
  assert.equal(m.nextBlogService([], []), null);
  assert.notEqual(m.nextAngle(0), m.nextAngle(1));
  assert.equal(m.slugify("Démoussage de toiture : quand et pourquoi ?"), "demoussage-de-toiture-quand-et-pourquoi");
  assert.equal(m.uniqueSlug("demoussage", new Set(["demoussage", "demoussage-2"])), "demoussage-3");
  assert.ok(m.slugify("a".repeat(200)).length <= 84);
});

test("article check: a sound article passes; maintenance intervals are not seniority claims; hashtags trimmed per network", () => {
  const r = m.checkArticle(good, FACTS, ["Autre titre"]);
  assert.equal(r.ok, true, r.reason);
  assert.doesNotMatch(r.article.social.google_business_profile, /#/);
  assert.equal(m.neutralizeDurations("contrôler tous les 5 ans, refaire entre 10 et 15 ans"), "contrôler tous les plusieurs années, refaire entre plusieurs années");
  assert.match(m.neutralizeDurations("plus de 20 ans d’expérience"), /20 ans/, "seniority stays checked");
});

test("article check: refusals name the reason (claims, links, phone, structure, lengths, reused title)", () => {
  const variant = (patch) => m.checkArticle({ ...good, ...patch }, FACTS, ["Démoussage de toiture : quand et pourquoi le faire!"]);
  assert.match(m.checkArticle(good, FACTS, [good.title]).reason, /titre déjà employé/);
  assert.match(variant({ body_markdown: body + "\n\nProfitez de notre garantie décennale à partir de 990 €." }).reason, /affirmation non confirmée/);
  assert.match(variant({ body_markdown: body + "\n\nPlus d’infos sur https://exemple.fr" }).reason, /lien/);
  assert.match(variant({ body_markdown: body + "\n\nAppelez le 06 12 34 56 78." }).reason, /téléphone/);
  assert.match(variant({ body_markdown: "# Titre\n" + body }).reason, /niveau 1/);
  assert.match(variant({ body_markdown: body.replace(/## /g, "") }).reason, /intertitres/);
  assert.match(variant({ body_markdown: "## A\n## B\n## C\nCourt." }).reason, /mots/);
  assert.match(variant({ title: "Court" }).reason, /titre/);
  assert.match(variant({ social: { ...good.social, instagram: "" } }).reason, /Instagram/);
  assert.match(variant({ body_markdown: body + "\n\nNous proposons aussi la plomberie." }).reason, /plomberie/);
});

test("markdown: safe subset only, everything escaped", () => {
  const html = m.renderMarkdown("Intro **forte** et *douce*.\n\n## Partie <script>alert(1)</script>\n- un\n- deux\n\n1. premier\n2. second\n\n### Détail\nTexte & suite");
  assert.equal(html, "<p>Intro <strong>forte</strong> et <em>douce</em>.</p>\n<h2>Partie &lt;script&gt;alert(1)&lt;/script&gt;</h2>\n<ul><li>un</li><li>deux</li></ul>\n<ol><li>premier</li><li>second</li></ol>\n<h3>Détail</h3>\n<p>Texte &amp; suite</p>");
  assert.doesNotMatch(m.renderMarkdown('<img src=x onerror="a()">'), /<img/);
});

test("relay texts end with the call to read the full article; public shape exposes only published fields", () => {
  const url = m.articleUrl("https://www.exemple.fr", "/blog", "demoussage");
  assert.equal(url, "https://www.exemple.fr/blog/demoussage");
  assert.equal(m.relayText("facebook", "Résumé.", url, "https://www.exemple.fr"), "Résumé.\n\nRetrouvez l’intégralité de notre article sur notre site web 👉 https://www.exemple.fr/blog/demoussage");
  assert.equal(m.relayText("instagram", "Résumé.", url, "https://www.exemple.fr"), "Résumé.\n\nRetrouvez l’intégralité de notre article sur notre site web : exemple.fr, rubrique Blog.");
  const row = { slug: "demoussage", title: "T", meta_description: "D", excerpt: "E", body_markdown: "## A\nTexte", service: "Démoussage", image_path: "c/i.jpg", image_alt: "Alt", published_at: "2026-11-05T12:15:00Z", updated_at: "2026-11-05T12:15:00Z" };
  const full = m.toPublicArticle(row, "https://cdn/blog-images", { siteUrl: "https://www.exemple.fr", blogPath: "/blog" }, true);
  assert.deepEqual(json(full.image), { url: "https://cdn/blog-images/c/i.jpg", alt: "Alt", width: 1600, height: 900 });
  assert.equal(full.url, url); assert.equal(full.html, "<h2>A</h2>\n<p>Texte</p>");
  const short = m.toPublicArticle(row, "https://cdn/blog-images", null, false);
  assert.equal(short.html, undefined); assert.equal(short.url, null);
  assert.deepEqual(Object.keys(short).sort(), ["description", "excerpt", "image", "publishedAt", "readingMinutes", "service", "slug", "title", "updatedAt", "url"]);
});

test("wiring: migration, public read-only API, notification, scheduler step, admin guards, explicit relay consent", () => {
  const sql = src("supabase/migrations/20261128000000_blog_agent.sql");
  assert.match(sql, /create table public\.client_blog_agents/); assert.match(sql, /create table public\.blog_articles/);
  assert.match(sql, /per_week between 1 and 2/); assert.match(sql, /social_relay boolean not null default false/);
  assert.match(sql, /'blog-images','blog-images',true/); assert.match(sql, /'blog_scheduled'/); assert.match(sql, /publications\|blog\)/);
  assert.match(sql, /revoke all on public\.client_blog_agents, public\.blog_articles from public, anon, authenticated/);
  const service = src("lib/blog-agent/service.ts");
  assert.match(service, /\.eq\('status','published'\)/, "public reads: published only");
  assert.match(service, /category:'blog_scheduled',href:`\/blog\/\$\{articleId\}`/);
  assert.match(service, /publishAtFrom\(now\)/, "never published at once by the agent");
  assert.match(service, /if\(!settings\.socialRelay\|\|!settings\.siteUrl\)return \{status:'off'/);
  assert.match(service, /if\(!actor\|\|!isAuthorizedAdmin\(actor\)\)/, "relay only on behalf of the authorised admin who enabled it");
  assert.match(service, /\.eq\('id',id\)\.eq\('status','scheduled'\)\.select\(COLUMNS\)/, "published once, even concurrently");
  for (const f of ["app/api/public/blog/[clientId]/route.ts", "app/api/public/blog/[clientId]/[slug]/route.ts"]) {
    const route = src(f);
    assert.doesNotMatch(route, /export (async )?function (POST|PUT|PATCH|DELETE)/, `${f}: read only`);
    assert.doesNotMatch(route, /requireAdmin|body_markdown|social/);
  }
  assert.match(src("proxy.ts"), /path\.startsWith\("\/api\/public\/blog\/"\) && \["GET", "HEAD", "OPTIONS"\]\.includes\(request\.method\)/);
  assert.match(src("app/api/blog-agent/route.ts"), /origin !== new URL\(request\.url\)\.origin[\s\S]*await requireAdmin\(\)/);
  for (const f of ["app/(cockpit)/blog/[id]/actions.ts", "app/(cockpit)/clients/[id]/blog-actions.ts"])
    for (const fn of src(f).match(/export async function \w+\([^)]*\)[^{]*\{\n[^\n]*/g)) assert.match(fn, /await requireAdmin\(\)/, fn);
  assert.match(src("app/(cockpit)/blog/[id]/page.tsx"), /await requireAdmin\(\)/);
  const tick = src("app/api/internal/scheduler/tick/route.ts");
  assert.match(tick, /step\("blog_agent", \(\) => runBlogAgentTick\(new Date\(\)\)/);
  assert.ok(tick.indexOf('step("blog_agent"') < tick.indexOf('step("video_agent"'));
  assert.match(src("lib/notifications/schema.ts"), /blog_scheduled: "Article de blog prévu demain"/);
  const schema = load("lib/notifications/schema.ts");
  assert.equal(schema.safeNotificationHref("/blog/11111111-1111-4111-8111-111111111111"), "/blog/11111111-1111-4111-8111-111111111111");
});
