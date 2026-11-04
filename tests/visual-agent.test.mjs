// Agent Visuels : réglages, échéance, rotation, contrôle des accroches, contraste. Aucun réseau, aucune IA réelle.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, json, form } from "./helpers/ts-load.mjs";

const m = load("lib/visual-agent/model.ts");
const now = new Date("2026-11-03T10:00:00Z");
const daysAgo = d => new Date(now.getTime() - d * 86400000).toISOString();

test("settings form: 1 to 14 visuals a week, hex colours, short one-line contact", () => {
  const ok = { enabled: "on", per_week: "3", primary_color: "#112233", secondary_color: "#ffaa00", text_color: "#ffffff", contact_line: "code-v.fr" };
  assert.deepEqual(json(m.parseSettingsForm(form(ok))), { enabled: true, perWeek: 3, primaryColor: "#112233", secondaryColor: "#ffaa00", textColor: "#ffffff", contactLine: "code-v.fr" });
  assert.equal(m.parseSettingsForm(form({ ...ok, enabled: "" })).enabled, false);
  for (const bad of [{ per_week: "0" }, { per_week: "15" }, { per_week: "2.5" }, { primary_color: "red" }, { contact_line: "x" }, { contact_line: "a".repeat(81) }])
    assert.ok("error" in m.parseSettingsForm(form({ ...ok, ...bad })), JSON.stringify(bad));
  assert.deepEqual(json(m.settingsFromRow(null)), json(m.DEFAULT_VISUAL_SETTINGS));
});

test("due: never when disabled; at most per_week in 7 days, spread over the week", () => {
  const s = { enabled: true, perWeek: 3 };
  assert.equal(m.isDue({ ...s, enabled: false }, [], now), false);
  assert.equal(m.isDue(s, [], now), true);
  assert.equal(m.isDue(s, [{ created_at: daysAgo(1) }], now), false, "too soon after the last one (7/3 days × 0.8)");
  assert.equal(m.isDue(s, [{ created_at: daysAgo(2) }], now), true);
  assert.equal(m.isDue(s, [{ created_at: daysAgo(2) }, { created_at: daysAgo(4) }, { created_at: daysAgo(6) }], now), false, "quota reached");
  assert.equal(m.isDue({ enabled: true, perWeek: 14 }, [{ created_at: daysAgo(0.5) }], now), true);
});

test("rotation: least recently illustrated service, template different from the last one", () => {
  const services = ["Dératisation", "Désinsectisation", "Punaises de lit"];
  assert.equal(m.nextService(services, []), "Dératisation");
  assert.equal(m.nextService(services, [{ service: "Dératisation", created_at: daysAgo(1) }]), "Désinsectisation");
  assert.equal(m.nextService(services, [{ service: "Dératisation", created_at: daysAgo(1) }, { service: "Désinsectisation", created_at: daysAgo(3) }, { service: "Punaises de lit", created_at: daysAgo(2) }]), "Désinsectisation");
  assert.equal(m.nextService([], []), null);
  assert.equal(m.nextTemplate([]), "bandeau");
  assert.equal(m.nextTemplate([{ template: "bandeau", created_at: daysAgo(1) }, { template: "minimal", created_at: daysAgo(5) }]), "diagonale");
  assert.equal(m.nextTemplate([{ template: "minimal", created_at: daysAgo(1) }]), "bandeau");
});

test("copy check: short, nothing invented, no hashtag or link, never reused", () => {
  const facts = "Protection Nuisibles\nDératisation\nPerpignan";
  assert.deepEqual(json(m.checkCopy({ headline: "  Des rongeurs chez vous ?  ", subline: "Une intervention professionnelle et discrète." }, facts, [])),
    { ok: true, headline: "Des rongeurs chez vous ?", subline: "Une intervention professionnelle et discrète." });
  assert.equal(m.checkCopy({ headline: "x".repeat(61), subline: "" }, facts, []).ok, false);
  assert.equal(m.checkCopy({ headline: "Dératisation dès 89 €", subline: "" }, facts, []).ok, false, "invented price");
  assert.equal(m.checkCopy({ headline: "Garantie 1 an", subline: "" }, facts, []).ok, false, "invented guarantee");
  // Le verbe « garantir » (« garantit un travail soigné ») est accepté (accord d'Adrien, 03/11) ; « garantie » reste refusée.
  assert.equal(m.checkCopy({ headline: "Votre couvreur", subline: "Il garantit un travail durable." }, facts, []).ok, true);
  assert.equal(m.checkCopy({ headline: "Suivez-nous #perpignan", subline: "" }, facts, []).ok, false);
  assert.equal(m.checkCopy({ headline: "Des rongeurs chez vous ?", subline: "" }, facts, ["des rongeurs chez VOUS"]).ok, false, "already used");
  assert.deepEqual(json(m.fallbackCopy("Dératisation", "Perpignan")), { headline: "Dératisation", subline: "À votre service — Perpignan" });
});

test("logo keeps its proportions inside the frame: tall ones capped by height, wide ones by 1.6 × the frame", () => {
  assert.deepEqual(json(m.fitLogo({ width: 450, height: 264 }, 200)), { width: 320, height: 188 });
  assert.deepEqual(json(m.fitLogo({ width: 300, height: 600 }, 200)), { width: 100, height: 200 });
  assert.deepEqual(json(m.fitLogo({ width: 480, height: 480 }, 240)), { width: 240, height: 240 });
});

test("readable text colour on any brand colour", () => {
  assert.equal(m.readableOn("#ffffff"), "#111827");
  assert.equal(m.readableOn("#f59e0b"), "#111827");
  assert.equal(m.readableOn("#1f2937"), "#ffffff");
});

test("migration and wiring: private logos, journal, scheduled step, Drive deposit, no publication", () => {
  const sql = readFileSync("supabase/migrations/20261124000000_visual_agent.sql", "utf8");
  assert.match(sql, /create table public\.client_visual_agents/); assert.match(sql, /per_week smallint not null default 3 check\(per_week between 1 and 14\)/);
  assert.match(sql, /'brand-assets','brand-assets',false/); assert.match(sql, /revoke all on public\.client_visual_agents, public\.client_visual_items from public, anon, authenticated/);
  const service = readFileSync("lib/visual-agent/service.ts", "utf8");
  assert.match(service, /uploadDrive\(token,driveFileId,ctx\.folder as string/);
  assert.match(service, /checkCopy\(value,ctx\.facts,used\)/);
  assert.doesNotMatch(service, /publication_(review|submit|schedule|prepare)/, "the agent never creates or approves a publication");
  assert.match(readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8"), /step\("visual_agent", \(\) => runVisualAgentTick\(new Date\(\)\)/);
});

test("visuals made by the agent enter the photo library validated (both import orders), never overriding a human decision", () => {
  const sql = readFileSync("supabase/migrations/20261126000000_visual_agent_validated.sql", "utf8");
  assert.match(sql, /after insert on public\.whatsapp_assets/); assert.match(sql, /after insert on public\.client_visual_items/);
  assert.match(sql, /i\.client_id=new\.client_id and i\.sha256=new\.sha256/);
  assert.match(sql, /status_changed_by !~ '\^user_'/);
  assert.match(sql, /library_status in \('received','to_review','quarantined'\)/);
  assert.match(sql, /status_changed_by='visual_agent'/);
});
