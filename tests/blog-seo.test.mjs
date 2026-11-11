// Agent Blog — expertise SEO : requête cible tirée de Search Console et note SEO de chaque article.
import test from "node:test";
import assert from "node:assert/strict";
import { load, json, src } from "./helpers/ts-load.mjs";

const seo = load("lib/blog-agent/seo.ts");
const para = (n) => `Le démoussage protège la toiture contre l’humidité. Une mousse installée retient l’eau et soulève les tuiles. ${"Un contrôle visuel régulier aide à repérer les zones exposées. ".repeat(n)}`.trim();
const good = {
  title: "Démoussage de toiture à Perpignan : quand le prévoir ?",
  metaDescription: "Mousses, tuiles soulevées, infiltrations : les signes qui montrent qu’un démoussage de toiture s’impose et comment bien le préparer chez vous.",
  bodyMarkdown: [
    "Un démoussage de toiture s’impose dès que la mousse couvre une partie des tuiles. Voici comment le reconnaître à Perpignan et le préparer.", "",
    "## Pourquoi prévoir un démoussage de toiture ?", "", para(6), "", para(6), "",
    "## Quels signes doivent alerter ?", "", "- Des tuiles soulevées", "- Des traces d’humidité au plafond", "", para(6), "", para(6), "",
    "## Comment se déroule l’intervention ?", "", para(6), "", para(6), "",
    "## Questions fréquentes", "", "### Faut-il démousser chaque année ?", "", "Non, un contrôle régulier suffit le plus souvent.", "",
    "### Peut-on marcher sur le toit ?", "", "Mieux vaut laisser faire un professionnel équipé.", "",
    "## En résumé", "", para(4),
  ].join("\n"),
};

test("audit: a well-built article scores high; each SEO gap lowers the score with an actionable remark", () => {
  const ok = seo.auditBlogArticle(good, { keyword: "démoussage toiture", zone: "Perpignan" });
  assert.ok(ok.score >= 80, JSON.stringify(ok.issues));
  assert.ok(!ok.issues.some((i) => i.level === "warning"), JSON.stringify(ok.issues));
  const bad = seo.auditBlogArticle({ title: "Tout savoir sur l’entretien des maisons et de leurs extérieurs au fil des saisons", metaDescription: "Nos conseils.",
    bodyMarkdown: "Intro sans le sujet.\n\n## Généralités\n\nTexte.\n\n## Autre partie\n\nTexte." }, { keyword: "démoussage toiture", zone: "Perpignan" });
  const codes = bad.issues.map((i) => i.code);
  for (const code of ["title_long", "title_keyword", "meta_short", "intro_keyword", "h2_keyword", "faq", "no_list", "thin", "zone_missing", "questions"]) assert.ok(codes.includes(code), code);
  assert.ok(bad.score < 40);
  assert.ok(bad.issues.every((i) => i.message.length > 10 && !/undefined/.test(i.message)));
});

test("audit: keyword stuffing and a repeated zone are flagged; plurals and accents still match", () => {
  const stuffed = { ...good, bodyMarkdown: good.bodyMarkdown + "\n\n" + "Démoussage démoussage démoussages à Perpignan. ".repeat(12) };
  const codes = seo.auditBlogArticle(stuffed, { keyword: "démoussage", zone: "Perpignan" }).issues.map((i) => i.code);
  assert.ok(codes.includes("stuffing")); assert.ok(codes.includes("zone_repeated"));
  assert.equal(seo.mentions("Les toitures demoussées", "démoussage toiture"), false, "different word family is not a mention");
  assert.equal(seo.mentions("Nettoyer ses toitures", "toiture"), true);
  assert.equal(seo.mentions("anything", ""), false);
});

test("target query: real related search, highest impressions, never brand, risky intent or an already covered topic", () => {
  const rows = [
    { query: "demoussage toiture perpignan", clicks: 2, impressions: 140, position: 12.4 },
    { query: "demoussage toiture prix", clicks: 9, impressions: 900, position: 6 },
    { query: "toiture exemple avis", clicks: 1, impressions: 500, position: 1 },
    { query: "toiture exemple demoussage", clicks: 1, impressions: 400, position: 1 },
    { query: "demoussage toit quand", clicks: 0, impressions: 60, position: 20 },
    { query: "reparation fuite toiture", clicks: 0, impressions: 300, position: 15 },
    { query: "demoussage", clicks: 0, impressions: 1000, position: 30 },
    { query: "mousse toit rare", clicks: 0, impressions: 5, position: 30 },
  ];
  const opts = { service: "Démoussage", clientName: "Toiture Exemple", usedTitles: [] };
  assert.deepEqual(json(seo.pickTargetQuery(rows, opts)), { query: "demoussage toiture perpignan", impressions: 140, position: 12.4 });
  assert.equal(seo.pickTargetQuery(rows, { ...opts, usedTitles: ["Démoussage de toiture à Perpignan : le guide"] }), null, "same topic already covered: no target");
  assert.equal(seo.pickTargetQuery(null, opts), null, "no Search Console data: no invented target");
  assert.equal(seo.pickTargetQuery([], opts), null);
  assert.equal(seo.pickTargetQuery(rows, { ...opts, service: "Ramonage" }), null);
});

test("wiring: target query passed as untrusted data, SEO retry keeps the best accepted draft, score logged and shown", () => {
  const service = src("lib/blog-agent/service.ts");
  assert.match(service, /pickTargetQuery\(await loadOrganicQueries\(clientId\)/);
  assert.match(service, /target_query_untrusted:target\.query/);
  assert.match(service, /const checked=checkArticle\(value,ctx\.facts,used\);\n   if\(!checked\.ok\)/, "anti-invention check still runs before any SEO scoring");
  assert.match(service, /if\(audit\.score>=SEO_GOOD_SCORE\)break;/);
  assert.match(service, /action:'blog_agent\.article_written'/);
  assert.match(src("app/(cockpit)/blog/[id]/page.tsx"), /data-blog-seo/);
  assert.match(src("app/api/blog-agent/route.ts"), /note SEO \$\{result\.seoScore\}\/100/);
});
