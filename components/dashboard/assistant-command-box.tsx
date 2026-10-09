"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { speak, stopSpeaking, useVoice } from "@/components/assistant/use-voice";
import { postAssistant } from "@/lib/assistant/client-api";

export type AssistantSuggestion = { label: string; href: string; icon: IconName };

export const defaultSuggestions: AssistantSuggestion[] = [
  { label: "Voir les urgences", href: "/work?view=review", icon: "alert" },
  { label: "Préparer les publications", href: "/publications", icon: "publications" },
  { label: "Vérifier les campagnes", href: "/clients", icon: "ads" },
  { label: "Voir les tâches du jour", href: "/work?view=todo", icon: "tasks" },
];

type Link_ = { label: string; href: string };
type Proposal = { tool: string; input: Record<string, unknown>; summary: string };
type Reply = { reply?: string; links?: Link_[]; proposal?: Proposal; degraded?: boolean; error?: string };
type Turn = { role: "user" | "assistant"; content: string; links?: Link_[] };

const failure = "L’assistant est momentanément indisponible. Réessayez dans un instant.";

/**
 * Assistant CODE-V : envoi au serveur (/api/assistant, même origine, session admin), qui choisit
 * l'IA configurée ou l'analyseur déterministe. Les écritures sont PROPOSÉES puis confirmées ici.
 * Aucune clé ni appel fournisseur côté navigateur.
 */
export function AssistantCommandBox({ suggestions = defaultSuggestions }: { suggestions?: AssistantSuggestion[] }) {
  const inputId = useId();
  const statusId = useId();
  const [value, setValue] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [voiceOutput, setVoiceOutput] = useState(false);
  const voiceOutputRef = useRef(false);

  const call = useCallback(async (body: unknown): Promise<Reply> => {
    try {
      const response = await postAssistant(body);
      if (response.status === 401) return { reply: "Session expirée : rechargez la page pour vous reconnecter." };
      const data = await response.json().catch(() => ({})) as Reply;
      return response.ok ? data : { reply: data.reply ?? failure, error: data.error ?? "failed" };
    } catch { return { reply: failure, error: "network" }; }
  }, []);

  const deliver = useCallback((data: Reply) => {
    const text = data.reply ?? failure;
    setTurns((current) => [...current, { role: "assistant" as const, content: text, links: data.links }].slice(-8));
    setProposal(data.proposal ?? null);
    setNotice(data.degraded ? "IA indisponible : réponse en mode simplifié." : "");
    if (voiceOutputRef.current) {
      const result = speak(text);
      if (result !== "ok") setNotice(result === "no_voice" ? "Aucune voix française disponible sur cet appareil." : "La lecture vocale n’est pas prise en charge par ce navigateur.");
    }
  }, []);

  const send = useCallback(async (text: string) => {
    const content = text.trim().slice(0, 2000);
    if (!content || pending) return;
    const history = [...turns, { role: "user" as const, content }].slice(-12);
    setTurns(history);
    setValue("");
    setProposal(null);
    setPending(true);
    deliver(await call({ messages: history.map(({ role, content: message }) => ({ role, content: message.slice(0, 2000) })) }));
    setPending(false);
  }, [call, deliver, pending, turns]);

  const voice = useVoice(useCallback((text: string) => { void send(text); }, [send]));

  async function confirm() {
    if (!proposal || pending) return;
    setPending(true);
    const current = proposal;
    setProposal(null);
    const reply = await call({ confirm: { tool: current.tool, input: current.input } });
    deliver(reply);
    // Échec technique (quota, réseau, session) : la proposition reste disponible pour réessayer.
    if (reply.error) setProposal(current);
    setPending(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && voice.state !== "idle") { event.preventDefault(); voice.cancel(); }
  }

  function toggleVoiceOutput() {
    const next = !voiceOutputRef.current;
    voiceOutputRef.current = next;
    setVoiceOutput(next);
    if (!next) stopSpeaking();
    setNotice(next ? "Mode vocal activé : les réponses seront lues à voix haute." : "Mode vocal désactivé.");
  }

  const recording = voice.state === "recording";
  const status = voice.message || notice;

  return (
    <section aria-labelledby={`${inputId}-title`} onKeyDown={onKeyDown} className="rounded-2xl border border-accent/25 bg-gradient-to-b from-accent/[0.07] to-surface p-4 shadow-[0_0_0_1px_rgba(184,244,155,0.04)] sm:p-6">
      <h2 id={`${inputId}-title`} className="sr-only">Assistant</h2>

      {turns.length > 0 && (
        <ol aria-label="Conversation avec l’assistant" aria-live="polite" className="mb-4 max-h-80 space-y-3 overflow-y-auto pr-1">
          {turns.map((turn, index) => (
            <li key={index} className={turn.role === "user" ? "ml-auto max-w-[85%] rounded-xl bg-white/5 px-3 py-2 text-sm" : "max-w-[95%] text-sm leading-6"}>
              <span className="sr-only">{turn.role === "user" ? "Vous : " : "Assistant : "}</span>
              {turn.content}
              {turn.links && turn.links.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-2">
                  {turn.links.filter((link) => /^\/(?!\/)|^https:\/\//.test(link.href)).slice(0, 4).map((link) => link.href.startsWith("/")
                    ? <Link key={link.href} href={link.href} className="text-xs text-accent hover:underline">{link.label}</Link>
                    : <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-accent hover:underline">{link.label} ↗</a>)}
                </span>
              )}
            </li>
          ))}
          {pending && <li className="text-sm text-muted">L’assistant réfléchit…</li>}
        </ol>
      )}

      {proposal && (
        <div role="group" aria-label="Action proposée" className="mb-4 rounded-xl border border-accent/40 bg-accent/[0.06] p-4">
          <p className="text-xs font-medium tracking-[0.14em] text-muted uppercase">À confirmer</p>
          <p className="mt-1 text-sm">{proposal.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={confirm} disabled={pending} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-background disabled:opacity-60">Confirmer</button>
            <button type="button" onClick={() => { setProposal(null); setTurns((current) => [...current, { role: "assistant" as const, content: "Proposition abandonnée. Rien n’a été modifié." }]); }} className="min-h-11 rounded-lg border border-border px-4 text-sm">Annuler</button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} aria-describedby={statusId}>
        <label htmlFor={inputId} className="sr-only">Votre demande à l’assistant</label>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/70 p-2 focus-within:border-accent/60 sm:flex-row sm:items-center">
          <input
            id={inputId}
            name="prompt"
            type="text"
            autoComplete="off"
            maxLength={2000}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={pending}
            placeholder="Ex. « Génère le rapport hebdomadaire pour Jrenov »"
            className="min-h-12 w-full min-w-0 flex-1 bg-transparent px-3 text-base text-foreground placeholder:text-muted/70 focus:outline-none sm:text-sm"
          />
          <div className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 sm:flex">
            <button type="button" onClick={voice.toggle} disabled={voice.state === "transcribing" || pending} aria-pressed={recording}
              aria-label={recording ? "Arrêter la dictée et envoyer" : "Dicter avec le micro"}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-60 ${recording ? "animate-pulse border-red-400/60 bg-red-400/10 text-red-200" : "border-border text-muted hover:border-accent/50 hover:text-foreground"}`}>
              <Icon name="mic" />
            </button>
            <button type="button" onClick={toggleVoiceOutput} aria-pressed={voiceOutput} className={`flex h-12 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm whitespace-nowrap transition-colors sm:px-3 ${voiceOutput ? "border-accent/60 text-accent" : "border-border text-muted hover:border-accent/50 hover:text-foreground"}`}>
              <Icon name="voice" />
              <span>Mode vocal</span>
            </button>
            <button type="submit" disabled={pending || !value.trim()} className="flex h-12 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 text-sm font-semibold whitespace-nowrap text-background transition-opacity hover:opacity-90 disabled:opacity-60 sm:px-4">
              <span>{pending ? "Envoi…" : "Envoyer"}</span>
              <Icon name="send" width={18} height={18} />
            </button>
          </div>
        </div>
      </form>
      <div className="flex min-h-5 items-start justify-between gap-2 px-1 pt-2">
        <p id={statusId} role="status" aria-live="polite" className="text-xs text-muted">{status}</p>
        {recording && <button type="button" onClick={voice.cancel} className="-mt-1 min-h-9 rounded-lg px-2 text-xs text-muted hover:text-foreground">Annuler la dictée</button>}
        {!recording && status && <button type="button" onClick={() => { setNotice(""); voice.setMessage(""); }} aria-label="Fermer le message" className="-mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground"><span aria-hidden="true">×</span></button>}
      </div>
      <ul aria-label="Suggestions rapides" className="mt-1 flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <li key={suggestion.label}>
            <Link href={suggestion.href} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-sm text-muted transition-colors hover:border-accent/50 hover:text-foreground">
              <Icon name={suggestion.icon} width={16} height={16} className="text-accent" />
              {suggestion.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
