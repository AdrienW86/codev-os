import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";
const { createSilenceDetector } = loadTs("lib/voice/silence.ts");
test("Silence alone sends nothing; short noises do not count as a phrase", () => {
  const detect = createSilenceDetector(0);
  assert.equal(detect(.1, 100), "listen");
  assert.equal(detect(0, 2000), "listen");
  assert.equal(detect(0, 12000), "empty");
});
test("A phrase finishes after a pause, bounded by the recording deadline", () => {
  const detect = createSilenceDetector(0);
  for (let now = 100; now <= 500; now += 100) assert.equal(detect(.05, now), "listen");
  assert.equal(detect(0, 1699), "listen");
  assert.equal(detect(0, 1700), "finish");
  const nonstop = createSilenceDetector(0);
  for (let now = 100; now < 30000; now += 100) nonstop(.05, now);
  assert.equal(nonstop(.05, 30000), "finish");
});
test("Playback waits for its actual end and cancellation settles the promise", async () => {
  let utterance;
  const synthesis = { getVoices: () => [{ lang: "fr-FR" }], cancel() {}, speak(value) { utterance = value; } };
  const voice = loadTs("components/assistant/use-voice.ts", {
    "@/lib/assistant/client-api": {}, "@/lib/voice/silence": { createSilenceDetector }, "@/lib/voice/audio": { MAX_AUDIO_BYTES: 4000000 },
  }, { window: { speechSynthesis: synthesis }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } });
  let finished = false;
  const played = voice.speak("Résumé court.").then((result) => { finished = true; return result; });
  await Promise.resolve(); assert.equal(finished, false);
  utterance.onend(); assert.equal(await played, "ok");
  const controller = new AbortController(); const cancelled = voice.speak("Résumé", controller.signal);
  controller.abort(); assert.equal(await cancelled, "failed");
});
