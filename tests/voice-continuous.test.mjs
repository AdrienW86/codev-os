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

function captureHarness(getUserMedia, postTranscription = async () => ({ ok: true, json: async () => ({ text: "Dictée" }) })) {
  const cleanups = []; const recordings = []; const heard = [];
  const voice = loadTs("components/assistant/use-voice.ts", {
    react: { useCallback: (value) => value, useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }), useEffect: (effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } },
    "@/lib/assistant/client-api": { postTranscription }, "@/lib/voice/silence": { createSilenceDetector }, "@/lib/voice/audio": { MAX_AUDIO_BYTES: 4000000 },
  }, { Blob, DOMException, setInterval, clearInterval, navigator: { mediaDevices: { getUserMedia } }, window: { addEventListener() {}, removeEventListener() {} }, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} }, MediaRecorder: class {
    static isTypeSupported() { return true; }
    constructor(stream) { this.stream = stream; this.state = "inactive"; this.mimeType = "audio/webm"; recordings.push(this); }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)]) }); this.onstop?.(); }
  } });
  return { session: voice.useVoice(async (text) => { heard.push(text); return true; }), recordings, heard, cleanups };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
test("Stop while microphone permission is pending closes a late stream and never records", async () => {
  let resolve; let requests = 0; let stopped = 0;
  const x = captureHarness(() => { requests++; return new Promise((done) => resolve = done); });
  x.session.toggle(); x.session.toggle(); assert.equal(requests, 1);
  x.session.cancel(); resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await tick();
  assert.equal(stopped, 1); assert.equal(x.recordings.length, 0); assert.equal(x.heard.length, 0);
});
test("Unmount aborts transcription and a late response cannot send a request", async () => {
  let resolve; let signal; let stopped = 0;
  const x = captureHarness(async () => ({ getTracks: () => [{ stop: () => stopped++ }] }), (_, value) => { signal = value; return new Promise((done) => resolve = done); });
  x.session.toggle(); await tick(); x.session.toggle(); await tick(); assert.equal(stopped, 1);
  x.cleanups.forEach((cleanup) => cleanup()); assert.equal(signal.aborted, true);
  resolve({ ok: true, json: async () => ({ text: "Late transcript" }) }); await tick(); assert.equal(x.heard.length, 0);
});
