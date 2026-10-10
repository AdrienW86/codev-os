"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postTranscription } from "@/lib/assistant/client-api";
import { createSilenceDetector } from "@/lib/voice/silence";
import { MAX_AUDIO_BYTES } from "@/lib/voice/audio";

export type VoiceState = "idle" | "requesting" | "recording" | "transcribing" | "responding";
type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null };
function recognitionCtor() {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}
const errors: Record<string, string> = {
  NotAllowedError: "Accès au micro refusé. Autorisez-le dans les réglages du navigateur.",
  SecurityError: "Le micro nécessite une page HTTPS et votre autorisation.",
  NotFoundError: "Aucun micro détecté.",
  empty: "Aucune voix détectée. Réessayez avec le bouton micro.",
  large: "Enregistrement trop volumineux. Dictez une demande plus courte.",
  unsupported: "Voix continue indisponible ici. Utilisez le bouton micro ou le clavier.",
  failed: "La dictée a échoué. Réessayez avec le bouton micro ou le clavier.",
};

/** One cancellable loop; no effect can restart it. Each cycle closes the microphone before sending. */
export function useVoice(onTranscript: (text: string, signal: AbortSignal) => Promise<boolean>) {
  const [state, setState] = useState<VoiceState>("idle");
  const [message, setMessage] = useState("");
  const [continuous, setContinuous] = useState(false);
  const callback = useRef(onTranscript);
  useEffect(() => { callback.current = onTranscript; }, [onTranscript]);
  const current = useRef<AbortController | null>(null);
  const finish = useRef<(() => void) | null>(null);
  const preferBrowser = useRef(false);
  const cancel = useCallback(() => {
    current.current?.abort(); current.current = null; finish.current = null;
    stopSpeaking(); setContinuous(false); setState("idle"); setMessage("Voix arrêtée.");
  }, []);

  const start = useCallback(async (loop: boolean) => {
    if (current.current) return;
    const controller = new AbortController(); const { signal } = controller;
    current.current = controller; setContinuous(loop); setMessage("");
    const active = () => !signal.aborted && current.current === controller;
    try {
      if (loop && (preferBrowser.current || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined" || !("speechSynthesis" in window))) throw new Error("unsupported");
      do {
        setState("requesting"); setMessage("Autorisation du micro…");
        let text: string;
        if (preferBrowser.current || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
          const Ctor = recognitionCtor(); if (!Ctor || loop) throw new Error("unsupported");
          text = await new Promise<string>((resolve, reject) => {
            const recognition = new Ctor(); let heard = "";
            recognition.lang = "fr-FR"; recognition.interimResults = false; recognition.maxAlternatives = 1;
            const timeout = setTimeout(() => recognition.stop(), 60_000);
            const abort = () => { recognition.abort(); reject(new DOMException("Cancelled", "AbortError")); };
            signal.addEventListener("abort", abort, { once: true });
            recognition.onresult = (event) => { heard = event.results[0]?.[0]?.transcript?.trim() ?? ""; };
            recognition.onerror = (event) => reject(new Error(["not-allowed", "service-not-allowed"].includes(event.error) ? "NotAllowedError" : "failed"));
            recognition.onend = () => { clearTimeout(timeout); signal.removeEventListener("abort", abort); finish.current = null; if (heard) resolve(heard); else reject(new Error("empty")); };
            finish.current = () => recognition.stop();
            setState("recording"); setMessage("Dictée du navigateur : appuyez de nouveau pour terminer."); recognition.start();
          });
        } else {
          // getUserMedia cannot be aborted: close a late stream before using it.
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          if (!active()) { stream.getTracks().forEach((track) => track.stop()); return; }
          const blob = await new Promise<Blob>((resolve, reject) => {
            let recorder: MediaRecorder | null = null; let audio: AudioContext | null = null;
            let interval: ReturnType<typeof setInterval> | undefined; let timeout: ReturnType<typeof setTimeout> | undefined;
            const chunks: Blob[] = []; let bytes = 0; let failure: string | null = null;
            const cleanup = () => { clearInterval(interval); clearTimeout(timeout); stream.getTracks().forEach((track) => track.stop()); void audio?.close().catch(() => {}); signal.removeEventListener("abort", abort); finish.current = null; };
            const stop = () => { if (recorder?.state === "recording") recorder.stop(); };
            const abort = () => { cleanup(); stop(); reject(new DOMException("Cancelled", "AbortError")); };
            signal.addEventListener("abort", abort, { once: true });
            try {
              const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
              recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
              recorder.ondataavailable = (event) => { bytes += event.data.size; if (bytes > MAX_AUDIO_BYTES) { failure = "large"; stop(); } else if (event.data.size) chunks.push(event.data); };
              recorder.onerror = () => { cleanup(); reject(new Error("failed")); };
              recorder.onstop = () => { const type = recorder?.mimeType || "audio/webm"; cleanup(); if (signal.aborted) return; if (failure) reject(new Error(failure)); else if (bytes < 1000) reject(new Error("empty")); else resolve(new Blob(chunks, { type })); };
              if (loop) {
                audio = new AudioContext(); const analyser = audio.createAnalyser(); analyser.fftSize = 1024;
                audio.createMediaStreamSource(stream).connect(analyser);
                const samples = new Float32Array(analyser.fftSize); const detect = createSilenceDetector(performance.now());
                void audio.resume().catch(() => { failure = "unsupported"; stop(); });
                interval = setInterval(() => {
                  analyser.getFloatTimeDomainData(samples); const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
                  const outcome = detect(rms, performance.now()); if (outcome !== "listen") { if (outcome === "empty") failure = "empty"; stop(); }
                }, 100);
              }
              finish.current = stop; recorder.start(250);
              timeout = setTimeout(stop, loop ? 30_000 : 60_000);
              setState("recording"); setMessage(loop ? "Écoute… une pause termine votre demande. Arrêter reste disponible." : "Enregistrement… appuyez de nouveau pour envoyer, Échap pour annuler.");
            } catch { cleanup(); reject(new Error("unsupported")); }
          });
          if (!active()) return;
          setState("transcribing"); setMessage("Transcription…");
          const response = await postTranscription(blob, AbortSignal.any([signal, AbortSignal.timeout(35_000)]));
          const data = await response.json() as { text?: string; error?: string };
          if (!response.ok || !data.text?.trim()) {
            if (data.error === "stt_not_configured" && recognitionCtor()) preferBrowser.current = true;
            throw new Error(data.error === "no_speech" ? "empty" : data.error === "stt_not_configured" ? "unsupported" : "failed");
          }
          text = data.text.trim().slice(0, 2000);
        }
        if (!active()) return;
        setState("responding"); setMessage("Traitement de votre demande… micro suspendu.");
        const succeeded = await callback.current(text, signal);
        if (active()) setMessage(succeeded ? "" : "Session vocale interrompue. Consultez la réponse puis réessayez avec le bouton micro.");
        if (!succeeded) break;
      } while (loop && active() && document.visibilityState === "visible");
    } catch (error) {
      if (active()) { const value = error as Error; setMessage(errors[value.name] ?? errors[value.message] ?? errors.failed); }
    } finally {
      if (current.current === controller) { current.current = null; finish.current = null; setState("idle"); setContinuous(false); }
    }
  }, []);
  const toggle = useCallback(() => { if (finish.current) finish.current(); else if (!current.current) void start(false); }, [start]);
  const toggleContinuous = useCallback(() => { if (current.current) cancel(); else void start(true); }, [cancel, start]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState !== "visible") cancel(); };
    document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", cancel);
    return () => { document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", cancel); current.current?.abort(); stopSpeaking(); };
  }, [cancel]);
  return { state, message, setMessage, continuous, toggle, toggleContinuous, cancel };
}

/** Resolve after playback ends so the recording loop cannot hear the synthesized reply. */
export async function speak(text: string, signal?: AbortSignal): Promise<"ok" | "unsupported" | "no_voice" | "failed"> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return "unsupported";
  if (signal?.aborted) return "failed";
  const voices = window.speechSynthesis.getVoices(); const voice = voices.find((item) => item.lang.toLowerCase().startsWith("fr"));
  if (voices.length && !voice) return "no_voice";
  stopSpeaking();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 450)); utterance.lang = "fr-FR"; if (voice) utterance.voice = voice;
    let settled = false;
    const done = (result: "ok" | "failed") => { if (settled) return; settled = true; clearTimeout(timeout); signal?.removeEventListener("abort", abort); resolve(result); };
    const abort = () => { stopSpeaking(); done("failed"); };
    const timeout = setTimeout(abort, 30_000); signal?.addEventListener("abort", abort, { once: true });
    utterance.onend = () => done("ok"); utterance.onerror = () => done("failed");
    try { window.speechSynthesis.speak(utterance); } catch { done("failed"); }
  });
}
export function stopSpeaking() { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }
