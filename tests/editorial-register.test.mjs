// Registre éditorial permanent (socle éditorial, lot 3) : empreinte, ressemblance, doublons par canal, réservations.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const text = loadTs("lib/publications/editorial-text.ts");
const m = loadTs("lib/editorial-register/model.ts", { "@/lib/publications/editorial-text": text });
const now = new Date("2026-11-13T10:00:00Z");
const daysAgo = (n) => new Date(now.getTime() - n * 86_400_000).toISOString();
const entry = (extra) => ({ channel: "blog", topic: "x", service: null, angle: null, status: "used", date: daysAgo(10), ref: "blog:1", ...extra });

test("empreinte : accents, pluriels, mots vides et ordre n'y changent rien", () => {
  assert.equal(m.topicFingerprint("Démoussage des toitures à Perpignan"), m.topicFingerprint("toiture perpignan : le démoussage"));
  assert.notEqual(m.topicFingerprint("Démoussage de toiture"), m.topicFingerprint("Isolation des combles"));
  assert.equal(m.topicFingerprint("le la les"), "");
});

test("ressemblance : même sujet reformulé proche, sujets différents loin", () => {
  assert.ok(m.topicSimilarity("Pourquoi démousser sa toiture avant l'hiver", "Démousser votre toiture avant l’hiver : pourquoi") >= m.SAME_TOPIC);
  assert.ok(m.topicSimilarity("Démoussage de toiture : erreurs à éviter", "Isolation des combles : comment bien choisir") < 0.3);
});

test("doublon : même canal sur 6 mois, même prestation et angle sur 3 mois", () => {
  const blog = entry({ topic: "Démoussage de toiture : les erreurs à éviter", service: "Démoussage", angle: "erreurs à éviter" });
  assert.equal(m.findDuplicate({ channel: "blog", topic: "Les erreurs à éviter pour le démoussage de toiture" }, [blog], now)?.reason, "same_topic");
  assert.equal(m.findDuplicate({ channel: "blog", topic: "Les erreurs à éviter pour le démoussage de toiture" }, [{ ...blog, date: daysAgo(200) }], now), null);
  assert.equal(m.findDuplicate({ channel: "blog", topic: "Démoussage : 5 pièges", service: "démoussage", angle: "Erreurs à éviter" }, [blog], now)?.reason, "same_service_angle");
  assert.equal(m.findDuplicate({ channel: "blog", topic: "Démoussage : 5 pièges", service: "démoussage", angle: "Erreurs à éviter" }, [{ ...blog, date: daysAgo(100) }], now), null);
});

test("autre canal : un sujet publié reste permis, un sujet réservé quasi identique bloque", () => {
  const social = entry({ channel: "social", topic: "Démoussage de toiture : les erreurs à éviter", ref: "publication:1" });
  assert.equal(m.findDuplicate({ channel: "blog", topic: "Démoussage de toiture : les erreurs à éviter" }, [social], now), null);
  assert.equal(m.findDuplicate({ channel: "blog", topic: "Démoussage de toiture : les erreurs à éviter" }, [{ ...social, status: "reserved" }], now)?.reason, "reserved_elsewhere");
  assert.match(m.duplicateMessage(m.findDuplicate({ channel: "blog", topic: "Démoussage de toiture : les erreurs à éviter" }, [{ ...social, status: "reserved" }], now)), /déjà réservé \(Réseaux sociaux\)/);
});

test("premier sujet libre : les angles déjà traités sont passés, dans l'ordre de l'agent", () => {
  const used = [entry({ topic: "Démoussage : guide pratique" }), entry({ topic: "Démoussage : questions fréquentes" })];
  const candidates = ["guide pratique", "questions fréquentes", "erreurs à éviter"].map((angle) => ({ channel: "blog", topic: `Démoussage : ${angle}`, angle }));
  const r = m.firstFreeTopic(candidates, used, now);
  assert.equal(r.choice.angle, "erreurs à éviter");
  assert.equal(r.skipped.length, 2);
  assert.equal(m.firstFreeTopic(candidates.slice(0, 2), used, now).choice, null);
});

test("registre transmis aux agents : 6 mois, plus récent d'abord, borné", () => {
  const brief = m.registerBrief([entry({ topic: "A ancien", date: daysAgo(300) }), entry({ topic: "B", date: daysAgo(5) }), entry({ topic: "C", date: daysAgo(1), status: "reserved" })], now);
  assert.deepEqual([...brief.map((b) => b.topic)], ["C", "B"]);
  assert.equal(brief[0].status, "reserved");
  assert.equal(m.registerBrief(Array.from({ length: 60 }, (_, i) => entry({ topic: `T${i}`, ref: String(i) })), now).length, 40);
});

function service(results) {
  const calls = [];
  const db = { from(table) {
    const q = { table, ops: [] };
    const chain = new Proxy({}, { get(_, op) {
      if (op === "then") return (ok, ko) => Promise.resolve(results(q)).then(ok, ko);
      return (...args) => { q.ops.push([op, ...args]); if (op === "single" || op === "maybeSingle") return Promise.resolve(results(q)); return chain; };
    } });
    calls.push(q); return chain;
  } };
  const s = loadTs("lib/editorial-register/service.ts", { "@/lib/supabase/server": { getSupabaseServerClient: () => db }, "@/lib/publications/editorial-memory": { proposedPublication: (p) => p.status !== "rejected" }, "./model": m });
  return { s, calls };
}
const C = "11111111-1111-4111-8111-111111111111";

test("réservation : refusée sans écriture si le sujet est déjà traité ; table absente acceptée ; course perdue refusée", async () => {
  const used = [entry({ topic: "Démoussage : guide pratique" })];
  let { s, calls } = service(() => ({ data: null, error: null }));
  const dup = await s.reserveTopic(C, "blog", { channel: "blog", topic: "Guide pratique du démoussage" }, used, now);
  assert.equal(dup.ok, false); assert.equal(calls.length, 0);
  ({ s, calls } = service(() => ({ data: null, error: { code: "42P01", message: "relation does not exist" } })));
  assert.deepEqual({ ...(await s.reserveTopic(C, "blog", { channel: "blog", topic: "Isolation des combles" }, used, now)) }, { ok: true, id: null });
  ({ s, calls } = service((q) => q.ops.some(([op]) => op === "insert") ? { data: null, error: { code: "23505" } } : { data: null, error: null }));
  const race = await s.reserveTopic(C, "blog", { channel: "blog", topic: "Isolation des combles" }, used, now);
  assert.equal(race.ok, false); assert.match(race.message, /autre agent/);
  ({ s, calls } = service((q) => q.ops.some(([op]) => op === "insert") ? { data: { id: "r1" }, error: null } : { data: null, error: null }));
  assert.equal((await s.reserveTopic(C, "blog", { channel: "blog", topic: "Isolation des combles" }, used, now)).id, "r1");
  const insert = calls.find((q) => q.ops.some(([op]) => op === "insert")).ops.find(([op]) => op === "insert")[1];
  assert.equal(insert.fingerprint, "combl isolation"); assert.equal(insert.reserved_by, "blog");
  assert.equal(await s.reserveTopic(C, "Blog!", { channel: "blog", topic: "x y" }, [], now).then((r) => r.ok), false);
});

test("lecture : publications, blog et newsletters hors annulés, réservations non expirées ; tables facultatives absentes tolérées", async () => {
  const rows = {
    publications: [{ id: "p1", subject: "Sujet social", status: "approved", archived_at: null, created_at: daysAgo(3) }, { id: "p2", subject: "Refusé", status: "rejected", created_at: daysAgo(2) }],
    blog_articles: [{ id: "b1", title: "Article", service: "Démoussage", status: "published", created_at: daysAgo(4) }, { id: "b2", title: "Annulé", status: "cancelled", created_at: daysAgo(1) }],
    email_newsletters: null,
    editorial_reservations: [{ id: "r1", channel: "blog", topic: "Réservé", service: null, angle: null, reserved_at: daysAgo(1), expires_at: daysAgo(-5) }, { id: "r2", channel: "blog", topic: "Expiré", reserved_at: daysAgo(20), expires_at: daysAgo(6) }],
  };
  const { s } = service((q) => rows[q.table] === null ? { data: null, error: { code: "PGRST205" } } : { data: rows[q.table], error: null });
  const list = await s.readRegister(C, now);
  assert.deepEqual([...list.map((e) => `${e.channel}:${e.topic}:${e.status}`)], ["social:Sujet social:used", "blog:Article:used", "blog:Réservé:reserved"]);
  const { s: down } = service((q) => q.table === "publications" ? { data: null, error: { message: "down" } } : { data: [], error: null });
  await assert.rejects(down.readRegister(C, now));
});

test("branchements : Blog réserve avant d'écrire et libère en cas d'échec ; Newsletter et Publications reçoivent le registre ; migration fermée au public", () => {
  const blog = readFileSync("lib/blog-agent/service.ts", "utf8");
  assert.match(blog, /reserveTopic\(clientId,'blog'/);
  assert.match(blog, /closeReservation\(reservation\.id,outcome\.ok\?\{consumedBy:`blog:\$\{outcome\.id\}`\}:'released'/);
  assert.ok(blog.indexOf("reserveTopic(") < blog.indexOf("writeArticle(ctx,service,angle"));
  assert.match(readFileSync("lib/emailing/newsletter-service.ts", "utf8"), /editorial_register: registerBrief\(register, now\)/);
  assert.match(readFileSync("lib/publications/agent-v2/prompt.ts", "utf8"), /editorial_register_other_channels/);
  const sql = readFileSync("supabase/migrations/20261211000000_editorial_register.sql", "utf8");
  assert.match(sql, /create unique index editorial_reservations_one_active on public\.editorial_reservations\(client_id, channel, fingerprint\) where status = 'reserved'/);
  assert.match(sql, /revoke all on public\.editorial_reservations from public, anon, authenticated/);
});
