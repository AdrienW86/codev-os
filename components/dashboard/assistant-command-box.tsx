"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { useAssistant, type AssistantSession, type Turn } from "@/components/assistant/use-assistant";
import { ResultDialog } from "@/components/assistant/result-dialog";
import { ProposalCard, ResultView, SafeLink } from "@/components/assistant/result-view";

export type AssistantSuggestion = { label: string; href: string; icon: IconName };

export const defaultSuggestions: AssistantSuggestion[] = [
  { label: "Voir les urgences", href: "/work?view=review", icon: "alert" },
  { label: "Préparer les publications", href: "/publications", icon: "publications" },
  { label: "Vérifier les campagnes", href: "/advertising", icon: "ads" },
  { label: "Voir les tâches du jour", href: "/work?view=todo", icon: "tasks" },
];

/**
 * Assistant CODE-V : envoi au serveur (/api/assistant, même origine, session admin), qui choisit
 * l'IA configurée ou l'analyseur déterministe et appelle les outils métier. Les résultats structurés
 * s'ouvrent dans UN panneau (modale sur ordinateur, plein écran sur smartphone) où l'on peut
 * poursuivre au clavier ou à la voix (« et sur 7 jours ? »). Les écritures sont PROPOSÉES puis
 * confirmées par un bouton ; aucune clé ni appel fournisseur côté navigateur.
 */
export function AssistantCommandBox({ suggestions = defaultSuggestions }: { suggestions?: AssistantSuggestion[] }) {
  const inputId = useId();
  const statusId = useId();
  const session = useAssistant();
  const { turns, proposal, pending, notice, view, open, voice } = session;
  const status = voice.message || notice;
  const lastReply = [...turns].reverse().find((turn) => turn.role === "assistant");
  const list = useRef<HTMLOListElement>(null);
  // Le dernier échange reste visible : la liste défile jusqu'au message le plus récent.
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [turns.length, pending, open]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && voice.state !== "idle") { event.preventDefault(); voice.cancel(); }
  }

  const proposalCard = proposal && <ProposalCard proposal={proposal} pending={pending} onConfirm={() => void session.confirm()} onCancel={session.cancelProposal} />;

  return (
    <section aria-labelledby={`${inputId}-title`} onKeyDown={onKeyDown} className="rounded-2xl border border-accent/25 bg-gradient-to-b from-accent/[0.07] to-surface p-4 shadow-[0_0_0_1px_rgba(184,244,155,0.04)] sm:p-6">
      <h2 id={`${inputId}-title`} className="sr-only">Assistant</h2>

      {turns.length > 0 && !open && (
        <ol ref={list} aria-label="Conversation avec l’assistant" aria-live="polite" className="mb-4 max-h-80 space-y-3 overflow-y-auto pr-1">
          {turns.map((turn, index) => <TurnItem key={index} turn={turn} />)}
          {pending && <li className="text-sm text-muted">L’assistant réfléchit…</li>}
        </ol>
      )}
      {view && (
        <button type="button" onClick={() => { session.rememberTrigger(); session.setOpen(true); }} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-accent/40 px-4 text-sm text-accent">
          Ouvrir le résultat : {view.title}
        </button>
      )}
      {!open && proposalCard && <div className="mb-4">{proposalCard}</div>}

      <Composer id={inputId} describedBy={statusId} session={session} placeholder="Ex. « Campagnes Google Ads de Protection Nuisibles sur 7 jours »" />
      <div className="flex min-h-5 items-start justify-between gap-2 px-1 pt-2">
        <p id={statusId} role="status" aria-live="polite" className="text-xs text-muted">{open ? "" : status}</p>
        {voice.state === "recording" && !open && <button type="button" onClick={voice.cancel} className="-mt-1 min-h-9 rounded-lg px-2 text-xs text-muted hover:text-foreground">Annuler la dictée</button>}
        {voice.state !== "recording" && status && !open && <button type="button" onClick={() => { session.setNotice(""); voice.setMessage(""); }} aria-label="Fermer le message" className="-mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground"><span aria-hidden="true">×</span></button>}
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

      {/* Monté seulement lorsqu'il est ouvert : aucun contenu caché en double dans la page. */}
      {view && open && (
        <ResultDialog open={open} onClose={() => session.setOpen(false)} returnFocus={() => session.trigger.current} title={view.title} busy={pending}
          subtitle="Données lues sur le serveur · lecture seule sauf confirmation explicite"
          footer={
            <div className="space-y-3" onKeyDown={onKeyDown}>
              {proposalCard}
              <Composer id={`${inputId}-panel`} describedBy={`${statusId}-panel`} session={session} compact label="Affiner ou poser une autre question" placeholder="Affiner : « et sur 7 jours ? », « uniquement Local Services »…" />
              <p id={`${statusId}-panel`} role="status" aria-live="polite" className="min-h-4 text-xs text-muted">{status}</p>
            </div>
          }>
          {lastReply && <p aria-live="polite" className="mb-4 rounded-xl bg-white/[0.04] px-3 py-2 text-sm leading-6">{lastReply.content}</p>}
          {session.failed && (
            <div role="alert" className="mb-4 rounded-xl border border-amber-300/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              La demande n’a pas abouti.
              <button type="button" onClick={session.retry} className="ml-2 min-h-9 rounded-lg border border-border px-3 text-foreground">Réessayer</button>
            </div>
          )}
          {/* Pendant une actualisation, l'ancien résultat est masqué : il n'est jamais présenté comme le nouveau. */}
          {session.refreshing && <p role="status" className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">Actualisation en cours… le résultat précédent est masqué.</p>}
          {/* Masqué sans être démonté : une réponse sans nouvelle vue (question, « oui ») conserve les filtres choisis dans la vue. */}
          <div hidden={session.refreshing}>
            <ResultView view={view} version={session.viewVersion} onAdsFilters={session.syncAdsFilters} propose={session.proposeFromView} />
          </div>
        </ResultDialog>
      )}
    </section>
  );
}

function TurnItem({ turn }: { turn: Turn }) {
  return (
    <li className={turn.role === "user" ? "ml-auto max-w-[85%] rounded-xl bg-white/5 px-3 py-2 text-sm" : "max-w-[95%] text-sm leading-6"}>
      <span className="sr-only">{turn.role === "user" ? (turn.via === "voice" ? "Vous (dictée) : " : "Vous : ") : "Assistant : "}</span>
      {turn.content}
      {turn.links && turn.links.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-2">
          {turn.links.slice(0, 4).map((link) => <SafeLink key={link.href} link={link} className="text-xs text-accent hover:underline" />)}
        </span>
      )}
    </li>
  );
}

/** Saisie partagée (accueil et panneau) : texte, dictée, mode vocal. */
function Composer({ id, describedBy, session, placeholder, compact = false, label = "Votre demande à l’assistant" }: { id: string; describedBy: string; session: AssistantSession; placeholder: string; compact?: boolean; label?: string }) {
  const [value, setValue] = useState("");
  const { pending, voice, voiceOutput } = session;
  const recording = voice.state === "recording";
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim() || pending) return;
    void session.send(value);
    setValue("");
  }
  return (
    <form onSubmit={handleSubmit} aria-describedby={describedBy}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <div className={`flex gap-2 rounded-xl border border-border bg-background/70 p-2 focus-within:border-accent/60 ${compact ? "items-center" : "flex-col gap-3 sm:flex-row sm:items-center"}`}>
        <input id={id} name="prompt" type="text" autoComplete="off" maxLength={2000} value={value} onChange={(event) => setValue(event.target.value)} disabled={pending} placeholder={placeholder}
          className="min-h-12 w-full min-w-0 flex-1 bg-transparent px-3 text-base text-foreground placeholder:text-muted/70 focus:outline-none sm:text-sm" />
        <div className={compact ? "flex items-center gap-2" : "grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 sm:flex"}>
          <button type="button" onClick={voice.toggle} disabled={voice.state === "transcribing" || pending} aria-pressed={recording}
            aria-label={recording ? "Arrêter la dictée et envoyer" : "Dicter avec le micro"}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-60 ${recording ? "animate-pulse border-red-400/60 bg-red-400/10 text-red-200" : "border-border text-muted hover:border-accent/50 hover:text-foreground"}`}>
            <Icon name="mic" />
          </button>
          {!compact && (
            <button type="button" onClick={session.toggleVoiceOutput} aria-pressed={voiceOutput} className={`flex h-12 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm whitespace-nowrap transition-colors sm:px-3 ${voiceOutput ? "border-accent/60 text-accent" : "border-border text-muted hover:border-accent/50 hover:text-foreground"}`}>
              <Icon name="voice" />
              <span>Mode vocal</span>
            </button>
          )}
          <button type="submit" disabled={pending || !value.trim()} aria-label={compact ? "Envoyer" : undefined} className="flex h-12 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold whitespace-nowrap text-background transition-opacity hover:opacity-90 disabled:opacity-60 sm:px-4">
            {!compact && <span>{pending ? "Envoi…" : "Envoyer"}</span>}
            <Icon name="send" width={18} height={18} />
          </button>
        </div>
      </div>
    </form>
  );
}
