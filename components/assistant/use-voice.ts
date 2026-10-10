"use client";

// Voix V1 : dictée push-to-talk (MediaRecorder → /api/assistant/transcribe), repli sur la
// reconnaissance vocale du navigateur, lecture des réponses par speechSynthesis.
// Chaque état d'échec a un message explicite : micro refusé, navigateur incompatible,
// aucune voix détectée, échec de transcription, annulation.
import { useCallback, useEffect, useRef, useState } from "react";
import { postTranscription } from "@/lib/assistant/client-api";

export type VoiceState = "idle" | "recording" | "transcribing";
type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null };

const MAX_RECORDING_MS = 60_000;

function speechRecognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const errorMessages: Record<string, string> = {
  denied: "Accès au micro refusé. Autorisez le micro dans les réglages du navigateur pour dicter.",
  unsupported: "Ce navigateur ne permet pas la dictée. Tapez votre demande.",
  no_speech: "Aucune voix détectée. Réessayez en parlant plus près du micro.",
  failed: "La transcription a échoué. Réessayez ou tapez votre demande.",
  cancelled: "Dictée annulée.",
  no_device: "Aucun micro détecté.",
};

export function useVoice(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [message, setMessage] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const preferBrowser = useRef(false);

  const stopTracks = () => recorder.current?.stream.getTracks().forEach((track) => track.stop());

  const browserRecognition = useCallback(() => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) { setMessage(errorMessages.unsupported); setState("idle"); return false; }
    const instance = new Ctor();
    instance.lang = "fr-FR"; instance.interimResults = false; instance.maxAlternatives = 1;
    let heard = false;
    instance.onresult = (event) => { const text = event.results[0]?.[0]?.transcript?.trim(); if (text) { heard = true; onTranscript(text); } };
    instance.onerror = (event) => setMessage(event.error === "not-allowed" || event.error === "service-not-allowed" ? errorMessages.denied : event.error === "no-speech" ? errorMessages.no_speech : event.error === "aborted" ? errorMessages.cancelled : errorMessages.failed);
    instance.onend = () => { setState("idle"); recognition.current = null; if (!heard && !cancelled.current) setMessage((current) => current || errorMessages.no_speech); };
    recognition.current = instance;
    setState("recording");
    setMessage("Parlez… appuyez de nouveau pour terminer.");
    instance.start();
    return true;
  }, [onTranscript]);

  const upload = useCallback(async (blob: Blob) => {
    setState("transcribing");
    setMessage("Transcription…");
    controller.current = new AbortController();
    try {
      const response = await postTranscription(blob, controller.current.signal);
      const data = await response.json().catch(() => ({})) as { text?: string; error?: string; reason?: string; message?: string };
      if (response.ok && data.text) { setMessage(""); onTranscript(data.text); return; }
      if (data.error === "stt_not_configured" && speechRecognitionCtor()) { setMessage("Transcription serveur non configurée : utilisation de la dictée du navigateur."); browserRecognition(); return; }
      if (data.error === "no_speech") { setMessage(errorMessages.no_speech); return; }
      if (data.error === "stt_not_configured") { setMessage("Transcription serveur non configurée : voir Paramètres → Connexions."); return; }
      // Raison précise renvoyée par le serveur (quota, clé, modèle, format…), sinon message générique.
      const reason = typeof data.message === "string" && data.message ? data.message.slice(0, 240) : errorMessages.failed;
      // Panne durable côté serveur : la prochaine pression utilise la dictée du navigateur si elle existe.
      const lasting = ["quota", "unauthorized", "model", "format", "rejected", "blocked"].includes(data.reason ?? "");
      if (lasting && speechRecognitionCtor()) preferBrowser.current = true;
      setMessage(lasting && speechRecognitionCtor() ? `${reason} Appuyez de nouveau sur le micro pour utiliser la dictée du navigateur.` : reason);
    } catch (error) {
      setMessage((error as { name?: string }).name === "AbortError" ? errorMessages.cancelled : errorMessages.failed);
    } finally {
      controller.current = null;
      setState((current) => (current === "transcribing" ? "idle" : current));
    }
  }, [browserRecognition, onTranscript]);

  const start = useCallback(async () => {
    cancelled.current = false;
    setMessage("");
    if (preferBrowser.current || typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { browserRecognition(); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (error) {
      const name = (error as { name?: string }).name;
      setMessage(name === "NotAllowedError" || name === "SecurityError" ? errorMessages.denied : name === "NotFoundError" ? errorMessages.no_device : errorMessages.failed);
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported?.(candidate)) ?? "";
    const instance = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks.current = [];
    instance.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
    instance.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timer.current) clearTimeout(timer.current);
      if (cancelled.current) { setState("idle"); setMessage(errorMessages.cancelled); return; }
      const blob = new Blob(chunks.current, { type: instance.mimeType || "audio/webm" });
      if (blob.size < 1_000) { setState("idle"); setMessage(errorMessages.no_speech); return; }
      void upload(blob);
    };
    recorder.current = instance;
    instance.start();
    setState("recording");
    setMessage("Enregistrement… appuyez de nouveau pour envoyer, Échap pour annuler.");
    timer.current = setTimeout(() => { if (instance.state === "recording") instance.stop(); }, MAX_RECORDING_MS);
  }, [browserRecognition, upload]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    recognition.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recognition.current?.abort();
    controller.current?.abort();
    setState("idle");
    setMessage(errorMessages.cancelled);
  }, []);

  const toggle = useCallback(() => { if (state === "recording") stop(); else if (state === "idle") void start(); }, [start, state, stop]);

  useEffect(() => () => { stopTracks(); recognition.current?.abort(); controller.current?.abort(); if (timer.current) clearTimeout(timer.current); }, []);

  return { state, message, setMessage, toggle, cancel };
}

/** Lecture vocale des réponses (voix française si disponible). */
export function speak(text: string): "ok" | "unsupported" | "no_voice" {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return "unsupported";
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((item) => item.lang?.toLowerCase().startsWith("fr")) ?? null;
  if (voices.length && !voice) return "no_voice";
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 600));
  utterance.lang = "fr-FR";
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return "ok";
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
