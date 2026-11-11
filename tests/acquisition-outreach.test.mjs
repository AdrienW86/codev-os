import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/load-ts.mjs";

const prescribers = loadTs("lib/acquisition/prescribers.ts");
const outreach = loadTs("lib/acquisition/outreach.ts", { "./prescribers": prescribers });
const json = (v) => JSON.parse(JSON.stringify(v));
const p = (id, extra = {}) => ({ id, company_name: `Société ${id}`, category: "prescriber", stage: "discovered", score: 50, segment: "architects", city: "Strasbourg", contact_email: `contact@${id}.fr`, ...extra });

test("transmission : seules les fiches contactables, par score, sans doublon ni exclusion", () => {
  const prospects = [
    p("a", { score: 40 }), p("b", { score: 90 }), p("c", { contact_email: null }), p("d", { stage: "contacted" }),
    p("e"), p("f", { contact_email: "CONTACT@b.fr" }), p("g", { contact_email: "info@stop.fr" }),
    p("h", { segment: "property_managers" }), p("i", { score: 10 }),
  ];
  const { selected, skipped } = outreach.selectHandoffProspects(prospects, { segment: "architects", minScore: 20 }, {
    draftedProspectIds: new Set(["e"]), usedEmails: new Set(), isSuppressed: (e) => e === "info@stop.fr",
  });
  assert.deepEqual(json(selected.map((s) => s.id)), ["b", "a"]);
  assert.deepEqual(json(skipped), { no_email: 1, stage: 1, filtered: 2, already_drafted: 1, suppressed: 1, duplicate_email: 1, limit: 0 });
  const capped = outreach.selectHandoffProspects([p("x"), p("y"), p("z")], {}, { draftedProspectIds: new Set(), usedEmails: new Set(["contact@z.fr"]), isSuppressed: () => false, limit: 1 });
  assert.equal(capped.selected.length, 1); assert.equal(capped.skipped.duplicate_email, 1); assert.equal(capped.skipped.limit, 1);
  assert.equal(outreach.selectHandoffProspects([p("x")], {}, { draftedProspectIds: new Set(), usedEmails: new Set(), isSuppressed: () => false, limit: 10_000 }).selected.length, 1);
});

test("brouillon : variables remplacées, sujet sur une ligne, mention d'opposition toujours présente", () => {
  const vars = outreach.templateVars(p("a", { company_name: "Atelier\nArchi" }), { name: "Toitures Martin", activity: "Couverture" });
  assert.equal(vars.metier, "architectes"); assert.equal(vars.activite, "couverture");
  const draft = outreach.draftMessage(outreach.DEFAULT_OUTREACH_TEMPLATE, vars);
  assert.equal(draft.subject, "Atelier Archi et Toitures Martin");
  assert.ok(!draft.subject.includes("\n"));
  assert.match(draft.body, /Atelier Archi exerce à Strasbourg, où Toitures Martin intervient en couverture/);
  assert.ok(draft.body.includes(outreach.SEGMENT_BENEFITS.architects));
  assert.ok(draft.body.endsWith(outreach.OPT_OUT_FOOTER));
  assert.equal(outreach.renderTemplate("{{ Entreprise }} {{inconnu}}", vars), "Atelier Archi {{inconnu}}");
  const generic = outreach.templateVars(p("z", { segment: null, city: null }), { name: "X", activity: null });
  assert.equal(generic.ville, "votre secteur"); assert.equal(generic.metier, "professionnel");
  assert.match(generic.benefice, /professionnel de confiance/);
});

test("expertise : un argument propre à chaque métier prescripteur, sans affirmation sur le client", () => {
  for (const id of Object.keys(prescribers.PRESCRIBER_SEGMENTS)) {
    const benefit = outreach.SEGMENT_BENEFITS[id];
    assert.ok(benefit && benefit.length < 200, id);
    assert.doesNotMatch(benefit, /garanti|24 ?h|meilleur|moins cher|prix|nous intervenons/i, id);
  }
});

test("contrôle qualité : le modèle par défaut est prêt, les défauts courants sont signalés", () => {
  const vars = outreach.templateVars(p("a"), { name: "Toitures Martin", activity: "Couverture" });
  const good = outreach.auditOutreachDraft(outreach.draftMessage(outreach.DEFAULT_OUTREACH_TEMPLATE, vars), "Société a");
  assert.equal(good.score, 100, JSON.stringify(good.issues));
  assert.ok(good.words <= 120);

  const bad = outreach.auditOutreachDraft({
    subject: "OFFRE EXCLUSIVE et gratuite pour votre entreprise, ne manquez surtout pas cette occasion unique",
    body: "Bonjour ! Cliquez ici https://a.fr et https://b.fr, c'est garanti ! {{inconnu}}",
  }, "Société a");
  const codes = bad.issues.map((i) => i.code);
  for (const code of ["placeholder", "opt_out", "subject_long", "spam_terms", "links", "exclamation", "caps", "no_question", "not_personal", "short"]) assert.ok(codes.includes(code), code);
  assert.equal(bad.score, 0);

  const fallback = outreach.auditOutreachDraft(outreach.draftMessage(outreach.DEFAULT_OUTREACH_TEMPLATE, outreach.templateVars(p("z", { city: null }), { name: "X", activity: null })), "Société z");
  assert.ok(fallback.issues.some((i) => i.code === "fallback"));
});

test("transmission câblée : administrateur, brouillons uniquement, exclusions emailing consultées", () => {
  const server = readFileSync("lib/acquisition/handoff.ts", "utf8");
  assert.match(server, /^import "server-only";/);
  assert.match(server, /state: "draft"/);
  assert.doesNotMatch(server, /state: "(approved|queued|sending|sent)"/);
  assert.match(server, /from\("email_suppressions"\)/);
  assert.match(server, /from\("acquisition_suppressions"\)/);
  assert.match(server, /isBlockedBy\(rs, scope\)/);
  const action = readFileSync("app/(cockpit)/acquisition/actions.ts", "utf8");
  assert.match(action, /export async function handoffToEmailAction\(data: FormData\) \{\n  await requireAdmin\(\);/);
  assert.match(readFileSync("components/acquisition/workspace-tabs.tsx", "utf8"), /action=\{handoffToEmailAction\}/);
});
