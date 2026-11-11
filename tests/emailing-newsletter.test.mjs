// Agent Newsletter : contrôle anti-invention, qualité, rendu e-mail, import de contacts, envoi verrouillé.
import test from "node:test";
import assert from "node:assert/strict";
import { load, src, json } from "./helpers/ts-load.mjs";

const nl = load("lib/emailing/newsletter.ts");
const contacts = load("lib/emailing/contacts.ts");

const URL_A = "https://www.couverture-exemple.fr/blog/demoussage-toiture-automne";
const sources = [
  { kind: "article", title: "Démoussage de toiture : pourquoi le faire à l'automne", summary: "Les mousses retiennent l'humidité et abîment les tuiles.", url: URL_A },
  { kind: "service", title: "démoussage", summary: "Prestation proposée par Couverture Exemple.", url: null },
];
const facts = nl.sourceFacts(sources, { name: "Couverture Exemple", activity: "Couverture", zone: "Perpignan" });
const good = {
  subject: "Votre toiture est-elle prête pour l'hiver ?",
  preheader: "Mousses, tuiles, gouttières : les vérifications utiles avant les pluies",
  intro: "L'automne est le bon moment pour regarder votre toiture de près, avant les pluies et le gel.",
  sections: [
    { title: "Pourquoi démousser à l'automne", body: "Les mousses retiennent l'humidité et abîment les tuiles. Un démoussage avant l'hiver limite les infiltrations. Nous expliquons la méthode dans notre dernier article.", url: URL_A },
    { title: "Les signes qui doivent alerter", body: "Des tuiles verdies, des gouttières qui débordent ou des traces d'humidité au plafond méritent un coup d'œil. Mieux vaut le vérifier tôt que réparer tard.", url: null },
  ],
  cta: { label: "Lire l'article", url: URL_A },
  signoff: "Bonne fin de saison,\nL'équipe Couverture Exemple",
};

test("anti-invention : seules les adresses fournies, aucune affirmation absente des faits, aucun balisage", () => {
  const ok = nl.checkNewsletter(good, { facts, allowedUrls: [URL_A] });
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.content.sections.length, 2);
  const badUrl = nl.checkNewsletter({ ...good, cta: { label: "Devis", url: "https://ailleurs.fr" } }, { facts, allowedUrls: [URL_A] });
  assert.equal(badUrl.ok, false);
  const price = nl.checkNewsletter({ ...good, intro: "Démoussage à 9 € le mètre carré, garanti 10 ans." }, { facts, allowedUrls: [URL_A] });
  assert.equal(price.ok, false); assert.match(price.reason, /price|guarantee|experience/);
  const markup = nl.checkNewsletter({ ...good, intro: "<b>Bonjour</b> voir www.site.fr" }, { facts, allowedUrls: [URL_A] });
  assert.equal(markup.ok, false);
  assert.equal(nl.checkNewsletter({ ...good, sections: [] }, { facts, allowedUrls: [URL_A] }).ok, false);
  assert.equal(nl.checkNewsletter("texte", { facts, allowedUrls: [] }).ok, false);
});

test("contrôle qualité : le brouillon exemplaire passe, les défauts courants sont signalés", () => {
  const audit = nl.auditNewsletter(nl.checkNewsletter(good, { facts, allowedUrls: [URL_A] }).content);
  assert.ok(audit.score >= 90, JSON.stringify(audit.issues));
  const bad = nl.auditNewsletter({ ...good, subject: "PROMO GRATUITE sur toutes nos prestations de toiture cet hiver !", preheader: "PROMO GRATUITE sur toutes nos prestations de toiture cet hiver !", cta: null });
  const codes = bad.issues.map((i) => i.code);
  for (const code of ["subject_long", "subject_shout", "preheader_repeat", "no_cta", "spam_terms"]) assert.ok(codes.includes(code), code);
  assert.ok(bad.score < 60);
});

test("rendu : HTML échappé, une colonne, pré-en-tête, lien de désabonnement et version texte", () => {
  const content = { ...good, intro: "Bonjour <script>alert(1)</script> & bienvenue" };
  const { html, text } = nl.renderNewsletter(content, { brand: "Couverture Exemple", unsubscribeUrl: "https://cockpit.exemple.fr/api/email/unsubscribe?t=abc" });
  assert.ok(!html.includes("<script>")); assert.ok(html.includes("&lt;script&gt;"));
  assert.match(html, /max-width:600px/); assert.match(html, /Se désabonner/);
  assert.ok(html.includes("https://cockpit.exemple.fr/api/email/unsubscribe?t=abc"));
  assert.ok(html.includes(good.preheader));
  assert.match(text, /Se désabonner : https:\/\/cockpit\.exemple\.fr/); assert.ok(text.includes(URL_A));
  const unsafe = nl.renderNewsletter({ ...good, cta: { label: "X", url: "javascript:alert(1)" } }, { brand: "B", unsubscribeUrl: "https://a.fr/u" });
  assert.ok(!unsafe.html.includes("javascript:"));
});

test("contacts : adresses normalisées, dédoublonnées, lignes invalides comptées", () => {
  const parsed = contacts.parseContactLines("Jean <JEAN@exemple.fr>\nmarie@exemple.fr; jean@exemple.fr\npas-une-adresse\n\n");
  assert.deepEqual(json(parsed), { emails: ["jean@exemple.fr", "marie@exemple.fr"], invalid: 1 });
  assert.equal(contacts.isConsentBasis("customer"), true); assert.equal(contacts.isConsentBasis("achat"), false);
});

test("service câblé : approbation obligatoire, exclusions relues avant chaque envoi, désabonnement en un clic, idempotence", () => {
  const s = src("lib/emailing/newsletter-service.ts");
  assert.match(s, /withCharter\("newsletter"/);
  assert.match(s, /\["approved", "sending"\]\.includes\(row\.status\) \|\| !row\.approved_at/);
  assert.match(s, /emailSendingStatus\(\)/);
  assert.match(s, /eq\("status", "subscribed"\)/);
  assert.match(s, /isBlockedBy\(late/);
  assert.match(s, /unsubscribeHeaders\(/);
  assert.match(s, /idempotencyKey: `newsletter:\$\{id\}:\$\{p\.id\}`/);
  const actions = src("app/(cockpit)/emailing/actions.ts");
  assert.match(actions, /requireAdminWriter/); assert.match(actions, /field\(data, "confirm"\) !== "on"/);
  const migration = src("supabase/migrations/20261206000000_email_newsletters.sql");
  assert.match(migration, /check \(status in \('draft','cancelled'\) or approved_at is not null\)/);
  assert.match(migration, /unique \(newsletter_id, email_normalized\)/);
  assert.match(migration, /revoke all on public\.email_newsletters, public\.email_newsletter_sends from anon, authenticated/);
});
