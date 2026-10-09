"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

export type AssistantSuggestion = { label: string; href: string; icon: IconName };

export const defaultSuggestions: AssistantSuggestion[] = [
  { label: "Voir les urgences", href: "/work?view=review", icon: "alert" },
  { label: "Préparer les publications", href: "/publications", icon: "publications" },
  { label: "Vérifier les campagnes", href: "/clients", icon: "ads" },
  { label: "Voir les tâches du jour", href: "/work?view=todo", icon: "tasks" },
];

const comingSoon = "L’assistant CODE-V arrive bientôt. Votre demande n’a pas été envoyée.";

/**
 * Bloc de commande de l’assistant — interface seule pour ce lot.
 * Aucun appel réseau, modèle IA, micro ni synthèse vocale : les contrôles
 * affichent uniquement un message d’information. Le futur branchement se fera
 * dans `handleSubmit` / `handleVoice`.
 */
export function AssistantCommandBox({ suggestions = defaultSuggestions }: { suggestions?: AssistantSuggestion[] }) {
  const inputId = useId();
  const statusId = useId();
  const [notice, setNotice] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(comingSoon);
  }

  function handleVoice() {
    setNotice("Le mode vocal sera disponible dans une prochaine version.");
  }

  return (
    <section aria-labelledby={`${inputId}-title`} className="rounded-2xl border border-accent/25 bg-gradient-to-b from-accent/[0.07] to-surface p-4 shadow-[0_0_0_1px_rgba(184,244,155,0.04)] sm:p-6">
      <h2 id={`${inputId}-title`} className="sr-only">Assistant</h2>
      <form onSubmit={handleSubmit} aria-describedby={statusId}>
        <label htmlFor={inputId} className="sr-only">Votre demande à l’assistant</label>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/70 p-2 focus-within:border-accent/60 sm:flex-row sm:items-center">
          <input
            id={inputId}
            name="prompt"
            type="text"
            autoComplete="off"
            placeholder="Ex. « Prépare les publications de Jrenov pour la semaine prochaine »"
            className="min-h-12 w-full min-w-0 flex-1 bg-transparent px-3 text-base text-foreground placeholder:text-muted/70 focus:outline-none sm:text-sm"
          />
          <div className="grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 sm:flex">
            <button type="button" onClick={handleVoice} aria-label="Dicter avec le micro" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:border-accent/50 hover:text-foreground">
              <Icon name="mic" />
            </button>
            <button type="button" onClick={handleVoice} className="flex h-12 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-sm whitespace-nowrap text-muted sm:px-3 transition-colors hover:border-accent/50 hover:text-foreground">
              <Icon name="voice" />
              <span>Mode vocal</span>
            </button>
            <button type="submit" className="flex h-12 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 text-sm font-semibold whitespace-nowrap text-background transition-opacity hover:opacity-90 sm:px-4">
              <span>Envoyer</span>
              <Icon name="send" width={18} height={18} />
            </button>
          </div>
        </div>
      </form>
      <p id={statusId} role="status" aria-live="polite" className="min-h-5 px-1 pt-2 text-xs text-muted">{notice}</p>
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
