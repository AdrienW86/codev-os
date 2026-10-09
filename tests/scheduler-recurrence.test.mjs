import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const rec = loadTs("lib/scheduler/recurrence.ts");
const iso = (date) => date?.toISOString() ?? null;

test("daily / weekly / monthly in Europe/Paris, strictly after the reference instant", () => {
  const after = new Date("2026-10-09T05:00:00Z"); // vendredi 07:00 à Paris (UTC+2)
  assert.equal(iso(rec.nextRun("daily", { time: "08:00" }, "Europe/Paris", after)), "2026-10-09T06:00:00.000Z");
  assert.equal(iso(rec.nextRun("daily", { time: "06:00" }, "Europe/Paris", after)), "2026-10-10T04:00:00.000Z", "already passed today → tomorrow");
  assert.equal(iso(rec.nextRun("weekly", { time: "08:00", weekdays: [1] }, "Europe/Paris", after)), "2026-10-12T06:00:00.000Z", "next Monday");
  assert.equal(iso(rec.nextRun("weekly", { time: "08:00", weekdays: [5] }, "Europe/Paris", new Date("2026-10-09T06:00:00Z"))), "2026-10-16T06:00:00.000Z", "same instant is not repeated");
  assert.equal(iso(rec.nextRun("monthly", { time: "09:00", monthDay: 31 }, "Europe/Paris", new Date("2026-11-01T00:00:00Z"))), "2026-11-30T08:00:00.000Z", "31 → last day of a 30-day month");
  assert.equal(iso(rec.nextRun("monthly", { time: "09:00", monthDay: 29 }, "Europe/Paris", new Date("2027-02-01T00:00:00Z"))), "2027-02-28T08:00:00.000Z");
});

test("DST transitions: winter time, spring gap and autumn overlap", () => {
  // Passage à l'heure d'hiver le 25/10/2026 : 08:00 Paris = 07:00 UTC ensuite.
  assert.equal(iso(rec.nextRun("daily", { time: "08:00" }, "Europe/Paris", new Date("2026-10-24T07:00:00Z"))), "2026-10-25T07:00:00.000Z");
  // 02:30 inexistant le 29/03/2026 (saut 02:00 → 03:00) : placé après le saut.
  const gap = rec.zonedToUtc(2026, 3, 29, 2, 30, "Europe/Paris");
  assert.equal(iso(gap), "2026-03-29T01:30:00.000Z");
  assert.equal(rec.localParts(gap, "Europe/Paris").hour, 3);
  // 02:30 ambigu le 25/10/2026 : première occurrence (heure d'été, UTC+2).
  assert.equal(iso(rec.zonedToUtc(2026, 10, 25, 2, 30, "Europe/Paris")), "2026-10-25T00:30:00.000Z");
  // Autre fuseau : New York change à une autre date.
  assert.equal(iso(rec.nextRun("daily", { time: "08:00" }, "America/New_York", new Date("2026-11-01T11:00:00Z"))), "2026-11-01T13:00:00.000Z");
  assert.equal(iso(rec.nextRun("daily", { time: "08:00" }, "Asia/Kolkata", new Date("2026-10-09T00:00:00Z"))), "2026-10-09T02:30:00.000Z", "half-hour offset");
});

test("once: future run kept, past run → null", () => {
  const after = new Date("2026-10-09T10:00:00Z");
  assert.equal(iso(rec.nextRun("once", { runAt: "2026-10-13T07:00:00Z" }, "Europe/Paris", after)), "2026-10-13T07:00:00.000Z");
  assert.equal(rec.nextRun("once", { runAt: "2026-10-01T07:00:00Z" }, "Europe/Paris", after), null);
  assert.equal(rec.nextRun("once", { runAt: "pas une date" }, "Europe/Paris", after), null);
});

test("schedule validation rejects malformed or incomplete schedules and unknown timezones", () => {
  const ok = (value) => rec.scheduleSchema.safeParse(value).success;
  assert.equal(ok({ frequency: "weekly", timezone: "Europe/Paris", schedule: { time: "08:00", weekdays: [1] } }), true);
  assert.equal(ok({ frequency: "weekly", timezone: "Europe/Paris", schedule: { time: "08:00" } }), false, "weekdays required");
  assert.equal(ok({ frequency: "daily", timezone: "Europe/Paris", schedule: { time: "25:00" } }), false);
  assert.equal(ok({ frequency: "daily", timezone: "Mars/Olympus", schedule: { time: "08:00" } }), false);
  assert.equal(ok({ frequency: "monthly", timezone: "Europe/Paris", schedule: { time: "08:00", monthDay: 32 } }), false);
  assert.equal(ok({ frequency: "once", timezone: "Europe/Paris", schedule: {} }), false);
  assert.equal(ok({ frequency: "hourly", timezone: "Europe/Paris", schedule: { time: "08:00" } }), false);
  assert.equal(ok({ frequency: "daily", timezone: "Europe/Paris", schedule: { time: "08:00", cron: "* * * * *" } }), false, "unknown keys rejected");
  assert.equal(rec.isValidTimezone("Europe/Paris"), true);
  assert.equal(rec.isValidTimezone("../../etc/passwd"), false);
});

test("human description", () => {
  assert.equal(rec.describeSchedule("weekly", { time: "08:00", weekdays: [1] }, "Europe/Paris"), "Tous les lundis à 08:00");
  assert.equal(rec.describeSchedule("daily", { time: "07:00" }, "America/New_York"), "Tous les jours à 07:00 (America/New_York)");
  assert.equal(rec.describeSchedule("monthly", { time: "09:00", monthDay: 1 }, "Europe/Paris"), "Le 1 de chaque mois à 09:00");
});
