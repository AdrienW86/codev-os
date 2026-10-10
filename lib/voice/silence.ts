/** Local energy detection only. No samples leave this detector. */
export function createSilenceDetector(started: number) {
  let voicedMs = 0;
  let last = started;
  let lastVoice = started;
  return (rms: number, now: number): "listen" | "finish" | "empty" => {
    const elapsed = Math.max(0, Math.min(250, now - last));
    last = now;
    if (rms >= 0.018) { voicedMs += elapsed; lastVoice = now; }
    if (voicedMs >= 300 && now - lastVoice >= 1200) return "finish";
    if (now - started >= 12_000 && voicedMs < 300) return "empty";
    if (now - started >= 30_000) return voicedMs >= 300 ? "finish" : "empty";
    return "listen";
  };
}
