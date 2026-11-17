// Agent Copywriter : note de naturel (pure), consignes communes, branchement Blog, Newsletter et Publications.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const c = loadTs("lib/copywriter/style.ts");
const natural = `Une tuile déplacée suffit pour que l’eau s’infiltre. Au début, rien ne se voit.
Puis une auréole apparaît au plafond, souvent après une grosse pluie d’automne. Vérifiez vos combles avec une lampe : une trace sombre sur le bois signale une fuite ancienne.
Le démoussage évite aussi que la mousse retienne l’humidité sur les tuiles. Faites-le au printemps, quand le toit est sec.
Un couvreur commence par un état des lieux. Il repère les tuiles fêlées, les faîtières mal scellées et les gouttières bouchées. Ensuite seulement, il propose un nettoyage ou une réparation.`;

test("texte naturel : bonne note, aucune remarque bloquante", () => {
  const a = c.auditStyle(natural);
  assert.ok(a.score >= c.STYLE_GOOD_SCORE, JSON.stringify(a.issues));
});

test("formules toutes faites, superlatifs et mention d'IA : note basse et remarques précises", () => {
  const a = c.auditStyle("Dans un monde où tout va vite, n’hésitez pas à nous contacter. Il est essentiel de choisir un artisan exceptionnel pour un résultat parfait. En tant qu’IA, je vous conseille une solution sur mesure. En conclusion, un véritable savoir-faire fait toute la différence.");
  assert.ok(a.score < c.STYLE_GOOD_SCORE);
  const codes = a.issues.map((i) => i.code);
  for (const code of ["ai_self", "stock_phrases", "hype"]) assert.ok(codes.includes(code), code);
  assert.match(a.issues.find((i) => i.code === "stock_phrases").message, /n’hésitez pas/);
});

test("tutoiement et vouvoiement : mélange refusé, consigne du client respectée", () => {
  assert.ok(c.auditStyle("Vous verrez la différence. Tu peux nous appeler demain matin sans souci.").issues.some((i) => i.code === "address_mix"));
  assert.equal(c.addressFromGuidelines("Ton chaleureux, on tutoie les clients."), "tu");
  assert.equal(c.addressFromGuidelines("Vouvoiement obligatoire"), "vous");
  assert.equal(c.addressFromGuidelines("Tutoiement ou vouvoiement selon le réseau"), null);
  assert.ok(c.auditStyle("Votre toit mérite un contrôle chaque année avant l’hiver.", { address: "tu" }).issues.some((i) => i.code === "address_wrong"));
});

test("retour au rédacteur : remarques de style, aucune promesse sur les détecteurs d'IA", () => {
  const feedback = c.styleFeedback(c.auditStyle("N’hésitez pas. Il est essentiel de bien choisir. En conclusion, un véritable plus."));
  assert.match(feedback, /note de naturel \d+\/100/);
  assert.doesNotMatch(c.COPY_STYLE_RULES + feedback, /détecteur|indétectable/i);
});

test("branchements : Blog et Newsletter réécrivent sous 75 et gardent le meilleur ; consignes partagées ; charte du Copywriter", () => {
  const blog = readFileSync("lib/blog-agent/service.ts", "utf8");
  assert.match(blog, /style=auditStyle\(articleProse\(checked\.article\),\{address\}\)/);
  assert.match(blog, /audit\.score\+style\.score>best\.audit\.score\+best\.style\.score/);
  assert.ok(blog.indexOf("const checked=checkArticle(") < blog.indexOf("auditStyle("), "anti-invention avant le style");
  const newsletter = readFileSync("lib/emailing/newsletter-service.ts", "utf8");
  assert.match(newsletter, /auditStyle\(newsletterProse\(checked\.content\), \{ address \}\)/);
  assert.match(newsletter, /style: \{ score: style\.score, issues: style\.issues \}/);
  assert.match(readFileSync("lib/emailing/newsletter.ts", "utf8"), /\$\{COPY_STYLE_RULES\}/);
  assert.match(readFileSync("lib/publications/agent-v2/prompt.ts", "utf8"), /COPY_STYLE_RULES,/);
  assert.match(readFileSync("lib/harness/charter.ts", "utf8"), /id: "copywriter"/);
  assert.match(readFileSync("app/(cockpit)/blog/[id]/page.tsx", "utf8"), /data-blog-style/);
});
