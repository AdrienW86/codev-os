// Agent Vidéo : réglages, échéance, choix prestation + photos, contrôle du script, palette de la charte, câblage.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, json, form } from "./helpers/ts-load.mjs";

const m = load("lib/video-agent/model.ts");
const now = new Date("2026-11-04T12:00:00Z");
const daysAgo = (d) => new Date(now.getTime() - d * 86400000).toISOString();

test("settings: 1 to 7 videos a week, known pace and music; defaults when absent", () => {
  assert.deepEqual(json(m.parseVideoSettingsForm(form({ enabled: "on", per_week: "2", pace: "dynamic", music: "elan" }))), { enabled: true, perWeek: 2, pace: "dynamic", music: "elan" });
  for (const bad of [{ per_week: "0" }, { per_week: "8" }, { pace: "turbo" }, { music: "inconnu" }])
    assert.ok("error" in m.parseVideoSettingsForm(form({ per_week: "1", pace: "standard", music: "auto", ...bad })), JSON.stringify(bad));
  assert.deepEqual(json(m.videoSettingsFromRow(null)), json(m.DEFAULT_VIDEO_SETTINGS));
});

test("due: never when disabled, at most per_week in 7 days, spread out", () => {
  assert.equal(m.videoDue({ enabled: false, perWeek: 1 }, [], now), false);
  assert.equal(m.videoDue({ enabled: true, perWeek: 1 }, [], now), true);
  assert.equal(m.videoDue({ enabled: true, perWeek: 1 }, [{ created_at: daysAgo(3) }], now), false);
  assert.equal(m.videoDue({ enabled: true, perWeek: 2 }, [{ created_at: daysAgo(3) }], now), true);
});

test("service and photos together: least recent service illustrated by at least 2 photos, unused and recent photos first", () => {
  const photos = [
    { id: "a", text: "Toiture en tuiles avec mousse, démoussage", used: true, date: "2026-10-01" },
    { id: "b", text: "Démoussage de toiture en cours", used: false, date: "2026-10-02" },
    { id: "c", text: "Gouttière en zinc posée", used: false, date: "2026-10-03" },
  ];
  const services = ["Zinguerie", "Nettoyage et démoussage de toiture"];
  const pick = m.chooseServiceAndPhotos(services, photos, []);
  assert.equal(pick.service, "Nettoyage et démoussage de toiture", "zinguerie : une seule photo");
  assert.deepEqual(json(pick.photoIds), ["b", "a"]);
  assert.equal(m.chooseServiceAndPhotos(["Zinguerie"], photos, []), null);
});

test("script check: lengths, no hashtag or link, nothing invented, headline never reused; fallback without AI", () => {
  const facts = "Jrenov\nNettoyage et démoussage de toiture\nLyon";
  const ok = m.checkVideoScript({ headline: "Une toiture propre, ça change tout", captions: ["La mousse retient l’humidité", "Après : des tuiles nettes", "en trop"], closing: "Parlons de votre toiture" }, facts, [], 2);
  assert.equal(ok.ok, true); assert.equal(ok.script.captions.length, 2, "une légende par photo suivante, pas plus");
  assert.equal(m.checkVideoScript({ headline: "Démoussage dès 99 €", captions: [], closing: "" }, facts, [], 1).ok, false);
  assert.equal(m.checkVideoScript({ headline: "Suivez #toiture", captions: [], closing: "" }, facts, [], 1).ok, false);
  assert.equal(m.checkVideoScript({ headline: "Une toiture propre, ça change tout", captions: [], closing: "" }, facts, ["une TOITURE propre ça change tout"], 1).ok, false);
  assert.deepEqual(json(m.fallbackVideoScript("Démoussage", "Lyon")), { headline: "Démoussage", captions: [], closing: "À votre service — Lyon" });
});

test("palette: brand colours only when white text stays readable on the background", () => {
  assert.deepEqual(json(m.videoPaletteFromBrand({ primary: "#07111f", secondary: "#4f8cff" })), { deep: "#07111f", accent: "#4f8cff", ink: "#FFFFFF" });
  assert.deepEqual(json(m.videoPaletteFromBrand({ primary: "#f5f5f5", secondary: "#0b1b3f" })), { deep: "#0b1b3f", accent: "#f5f5f5", ink: "#FFFFFF" });
  assert.equal(m.videoPaletteFromBrand({ primary: "#ffffff", secondary: "#f5d000" }), null);
  assert.equal(m.videoPaletteFromBrand(null), null);
});

test("wiring: last scheduler step, never publishes, admin same-origin route, migration", () => {
  const route = readFileSync("app/api/internal/scheduler/tick/route.ts", "utf8");
  assert.match(route, /step\("video_agent", \(\) => runVideoAgentTick\(new Date\(\)\)/);
  assert.ok(route.indexOf('step("video_agent"') > route.indexOf('step("publication_preparation"'), "après la préparation des publications");
  const service = readFileSync("lib/video-agent/service.ts", "utf8");
  assert.doesNotMatch(service, /publication_(review|submit|schedule|prepare)|createVideoDraft/, "aucune publication créée");
  assert.match(service, /created_by:'video_agent'/);
  const api = readFileSync("app/api/video-agent/route.ts", "utf8");
  assert.match(api, /origin !== new URL\(request\.url\)\.origin/); assert.match(api, /await requireAdmin\(\)/);
  const sql = readFileSync("supabase/migrations/20261127000000_video_agent.sql", "utf8");
  assert.match(sql, /create table public\.client_video_agents/); assert.match(sql, /or created_by='video_agent'/);
  assert.match(readFileSync("next.config.ts", "utf8"), /"\/api\/internal\/scheduler\/tick": motionVideoFiles/);
});
