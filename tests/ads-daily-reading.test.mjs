import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";
const grounded = loadTs("lib/ai/grounded.ts");
const reading = loadTs("lib/ads/daily-reading.ts", { "@/lib/ai/grounded": grounded });
const anomaly = { campaignId: "123456", campaign: "Dératisation", rule: "spend_without_conversions", severity: "medium", detail: "84,50 € dépensés sans conversion sur la période." };
const row = (cost, conversions) => ({ id: "123456", name: "Dératisation", status: "ENABLED", impressions: 900, clicks: 41, cost, conversions, budget: 15 });
const payload = reading.adsReadingPayload([anomaly], [row(84.5, 0)], [row(60, 2)]);

test("lecture Ads : seules les anomalies fournies, chiffres repris des données", () => {
  const out = reading.validateAdsReading({ items: [
    { campaign_id: "123456", reading: "Les 84,50 € sans conversion peuvent venir d'une balise d'appel inactive, à confirmer.", check: "Contrôler l'état des conversions puis les termes de recherche des 41 clics." },
    { campaign_id: "999", reading: "Inventée.", check: "Rien." },
  ] }, payload);
  assert.equal(out.ok, true);
  assert.equal(out.readings.size, 1);
  assert.match(out.readings.get("123456").check, /41 clics/);
  assert.ok(reading.adsReadingSchema(["123456"]).properties.items.items.properties.campaign_id.enum.includes("123456"));
});

test("lecture Ads : chiffre calculé refusé, réponse vide refusée, identifiant non compté comme chiffre", () => {
  const bad = reading.validateAdsReading({ items: [{ campaign_id: "123456", reading: "Dépenses en hausse de 41 %, soit 24,50 € de plus.", check: "Vérifier." }] }, payload);
  assert.equal(bad.ok, false); assert.equal(bad.reason, "ungrounded"); assert.match(bad.detail, /24\.5/);
  assert.equal(reading.validateAdsReading({ items: [] }, payload).ok, false);
  assert.equal(reading.validateAdsReading({ items: [{ campaign_id: "123456", reading: "Campagne 123456 à revoir.", check: "Vérifier." }] }, payload).reason, "ungrounded");
});
