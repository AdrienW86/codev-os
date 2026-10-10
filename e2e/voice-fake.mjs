/** Installed in the test browser only. Actual application hooks run unchanged. */
export function installFakeVoice() {
  window.__voiceTest = { open: 0, starts: 0, speaking: false };
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
    window.__voiceTest.open++; window.__voiceTest.starts++; let stopped = false;
    return { getTracks: () => [{ stop() { if (!stopped) { stopped = true; window.__voiceTest.open--; } } }] };
  } });
  window.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor(stream) { this.stream = stream; this.mimeType = "audio/webm"; this.state = "inactive"; }
    start() { this.state = "recording"; }
    stop() { if (this.state !== "recording") return; this.state = "inactive"; this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)], { type: this.mimeType }) }); this.onstop?.(); }
  };
  window.AudioContext = class {
    constructor() { this.started = performance.now(); }
    createAnalyser() { const started = this.started; return { fftSize: 1024, getFloatTimeDomainData(samples) { samples.fill(performance.now() - started < 700 ? .04 : 0); } }; }
    createMediaStreamSource() { return { connect() {} }; } resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
  };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
    getVoices: () => [{ lang: "fr-FR" }],
    speak(utterance) { window.__voiceTest.speaking = true; this.utterance = utterance; this.timer = setTimeout(() => { window.__voiceTest.speaking = false; utterance.onend?.(); }, 2000); },
    cancel() { clearTimeout(this.timer); window.__voiceTest.speaking = false; this.utterance?.onerror?.(); this.utterance = null; },
  } });
}
