"use client";

// État de l'assistant partagé par la zone d'accueil et le panneau de résultats : fil de conversation,
// contexte (client, vue, filtres), dernière vue structurée, proposition en attente, dictée.
// Toutes les données viennent du serveur (/api/assistant) ; le navigateur ne fait que les afficher.
import { useCallback, useEffect, useRef, useState } from "react";
import { speak, stopSpeaking, useVoice } from "@/components/assistant/use-voice";
import { postAssistant } from "@/lib/assistant/client-api";
import { writeFilters, type DashboardFilters } from "@/lib/integrations/google-ads/dashboard";
import type { AssistantContext, AssistantView, ViewLink } from "@/lib/assistant/views";

export type Proposal = { tool: string; input: Record<string, unknown>; summary: string; heard?: string };
export type Reply = { keepProposal?: boolean; reply?: string; links?: ViewLink[]; proposal?: Proposal; view?: AssistantView; context?: AssistantContext; degraded?: boolean; degradedReason?: string; error?: string };
export type Turn = { role: "user" | "assistant"; content: string; links?: ViewLink[]; via?: "voice" };

const failure = "L’assistant est momentanément indisponible. Réessayez dans un instant.";

export function useAssistant() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pending, setPending] = useState(false);
  /** Une nouvelle demande remplacera la vue : l'ancien résultat est masqué pendant ce temps (pas pour une proposition). */
  const [refreshing, setRefreshing] = useState(false);
  const [latency, setLatency] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [synthesisMs, setSynthesisMs] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<AssistantView | null>(null);
  /** Incrémenté à chaque nouvelle vue serveur : remonte le composant avec ses nouvelles données. */
  const [viewVersion, setViewVersion] = useState(0);
  const [open, setOpen] = useState(false);
  /** Dernière demande en échec technique (réseau, session, serveur) : peut être renvoyée telle quelle. */
  const [failed, setFailed] = useState<{ content: string; via: "text" | "voice" } | null>(null);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const voiceOutputRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const playback = useRef<AbortController | null>(null);
  const context = useRef<AssistantContext>({});
  /** Élément qui a déclenché la demande (hors panneau) : le focus y revient à la fermeture, même s'il a été désactivé entre-temps. */
  const trigger = useRef<HTMLElement | null>(null);
  const rememberTrigger = () => {
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest("dialog")) trigger.current = active;
  };
  const busy = useRef(false);

  const call = useCallback(async (body: unknown, signal?: AbortSignal): Promise<Reply> => {
    const own = signal ? null : new AbortController();
    if (own) request.current = own;
    const activeSignal = signal ?? AbortSignal.any([own!.signal, AbortSignal.timeout(60_000)]);
    try {
      const response = await postAssistant(body, activeSignal);
      if (response.status === 401) return { reply: "Session expirée : rechargez la page pour vous reconnecter.", error: "unauthorized" };
      const data = await response.json().catch(() => ({})) as Reply;
      return response.ok ? data : { reply: data.reply ?? failure, error: data.error ?? "failed" };
    } catch { return { reply: failure, error: activeSignal.aborted ? "cancelled" : "network" }; }
    finally { if (own && request.current === own) request.current = null; }
  }, []);

  const deliver = useCallback((data: Reply) => {
    const text = data.reply ?? failure;
    setTurns((current) => [...current, { role: "assistant" as const, content: text, links: data.links }].slice(-12));
    setProposal(data.proposal ?? null);
    if (data.context) context.current = data.context;
    if (data.view) { setView(data.view); setViewVersion((value) => value + 1); setOpen(true); }
    setNotice(data.degraded ? `IA indisponible${data.degradedReason ? ` (${data.degradedReason})` : ""} : réponse en mode simplifié.` : "");
  }, []);

  const readReply = useCallback(async (text: string, signal?: AbortSignal) => {
    if (!voiceOutputRef.current) return true;
    const controller = new AbortController(); playback.current?.abort(); playback.current = controller;
    setSpeaking(true);
    const synthesisStart = performance.now();
    const result = await speak(text, signal ? AbortSignal.any([signal, controller.signal]) : controller.signal);
    setSynthesisMs(Math.round(performance.now() - synthesisStart));
    if (playback.current === controller) { playback.current = null; setSpeaking(false); }
    if (result !== "ok" && !signal?.aborted) setNotice("Lecture vocale interrompue ou indisponible. Utilisez le bouton micro ou le clavier.");
    return result === "ok";
  }, []);

  const send = useCallback(async (text: string, via: "text" | "voice" = "text", base: Turn[] = turns, externalSignal?: AbortSignal) => {
    const content = text.trim().slice(0, 2000);
    if (!content || busy.current || externalSignal?.aborted) return false;
    busy.current = true;
    const controller = new AbortController(); request.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000), ...(externalSignal ? [externalSignal] : [])]);
    rememberTrigger();
    const history = [...base, { role: "user" as const, content, ...(via === "voice" ? { via } : {}) }].slice(-12);
    setTurns(history);
    const waiting = proposal;
    setProposal(null);
    setFailed(null);
    setPending(true);
    setRefreshing(true);
    try {
    const requestStart = performance.now();
    setLatency("Résolution du client, lecture des données et analyse en cours…");
    const data = await call({ messages: history.map(({ role, content: message }) => ({ role, content: message.slice(0, 2000) })), context: context.current, via }, signal);
    if (signal.aborted) return false;
    deliver(data);
    requestAnimationFrame(() => setLatencyMs(Math.round(performance.now() - requestStart)));
    setLatency("Détail affiché ; la synthèse vocale ne lit que le résumé.");
    // « oui » écrit ou dicté : la proposition reste à confirmer par le bouton, rien n'a été exécuté.
    if (data.keepProposal && waiting) setProposal(waiting);
    if (data.error) setFailed({ content, via });
    const spoken = !data.error && await readReply(data.reply ?? failure, signal);
    return !data.error && spoken;
    } finally {
    setRefreshing(false);
    setPending(false);
    busy.current = false;
    if (request.current === controller) request.current = null;
    }
  }, [call, deliver, proposal, readReply, turns]);

  const retry = useCallback(() => {
    if (!failed) return;
    // Le couple demande / réponse en échec est retiré de l'historique avant le nouvel envoi.
    void send(failed.content, failed.via, turns.slice(0, -2));
  }, [failed, send, turns]);

  const voice = useVoice(useCallback((text: string, signal: AbortSignal) => send(text, "voice", turns, signal), [send, turns]));
  const { cancel: cancelVoice, continuous, state: voiceState, toggleContinuous: toggleVoiceContinuous } = voice;
  const stopVoice = useCallback(() => { cancelVoice(); request.current?.abort(); playback.current?.abort(); stopSpeaking(); }, [cancelVoice]);
  const toggleContinuous = useCallback(() => {
    if (continuous || voiceState !== "idle") { stopVoice(); return; }
    if (busy.current) return;
    voiceOutputRef.current = true; setVoiceOutput(true); toggleVoiceContinuous();
  }, [stopVoice, continuous, voiceState, toggleVoiceContinuous]);

  const confirm = useCallback(async () => {
    // Même règle que le bouton : désactivé seulement pendant une requête en cours.
    if (!proposal || busy.current) return;
    cancelVoice(); playback.current?.abort();
    busy.current = true;
    setPending(true);
    const current = proposal;
    setProposal(null);
    const reply = await call({ confirm: { tool: current.tool, input: current.input } });
    if (reply.error === "cancelled") { setPending(false); busy.current = false; return; }
    deliver(reply);
    // Échec technique (quota, réseau, session) : la proposition reste disponible pour réessayer.
    if (reply.error) setProposal(current);
    await readReply(reply.reply ?? failure);
    setPending(false);
    busy.current = false;
  }, [call, deliver, proposal, readReply, cancelVoice]);

  const cancelProposal = useCallback(() => {
    setProposal(null);
    setTurns((current) => [...current, { role: "assistant" as const, content: "Proposition abandonnée. Rien n’a été modifié." }]);
  }, []);

  /** Bouton d'une vue : le serveur valide et décrit la proposition ; rien n'est exécuté avant « Confirmer ». */
  const proposeFromView = useCallback(async (tool: string, input: Record<string, unknown>) => {
    if (busy.current) return { ok: false, message: "Une demande est déjà en cours." };
    cancelVoice(); playback.current?.abort();
    busy.current = true;
    setPending(true);
    const reply = await call({ propose: { tool, input } });
    setPending(false);
    busy.current = false;
    if (reply.error === "cancelled") return { ok: false, message: "Demande annulée." };
    if (reply.proposal) { setProposal(reply.proposal); return { ok: true, message: "Proposition prête : vérifiez-la puis confirmez en bas du panneau." }; }
    return { ok: false, message: reply.reply ?? failure };
  }, [call, cancelVoice]);

  /** Filtres modifiés directement dans la vue : les demandes suivantes partent de cet état. */
  const syncAdsFilters = useCallback((clientId: string, clientName: string, filters: DashboardFilters) => {
    context.current = { clientId, clientName, view: "ads_campaigns", adsQuery: writeFilters(new URLSearchParams(), filters).toString() };
  }, []);

  const toggleVoiceOutput = useCallback(() => {
    const next = !voiceOutputRef.current;
    voiceOutputRef.current = next;
    setVoiceOutput(next);
    if (!next) { stopVoice(); playback.current?.abort(); }
    setNotice(next ? "Mode vocal activé : seules les phrases de synthèse sont lues, jamais les tableaux." : "Mode vocal désactivé.");
  }, [stopVoice]);

  useEffect(() => () => { request.current?.abort(); playback.current?.abort(); stopSpeaking(); }, []);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState !== "visible") stopVoice(); };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, [stopVoice]);

  return {
    turns, proposal, pending, refreshing, latency, latencyMs, synthesisMs, notice, setNotice, view, viewVersion, open, setOpen, failed, voice, voiceOutput,
    speaking, stopVoice, toggleContinuous, trigger, rememberTrigger, send, retry, confirm, cancelProposal, proposeFromView, syncAdsFilters, toggleVoiceOutput,
  };
}

export type AssistantSession = ReturnType<typeof useAssistant>;
