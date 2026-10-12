"use client";
/* eslint-disable @next/next/no-img-element -- Private signed URLs are short-lived and must not be cached by an image proxy. */
import Link from "next/link";
import { useActionState, useState } from "react";
import { Action } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { mediaLibraryAction, type MediaLibraryState } from "@/app/(cockpit)/clients/[id]/media-actions";
import { MAX_PUBLICATION_MEDIA, statusLabels, manualStatuses } from "@/lib/whatsapp/library-model";
import { SENSITIVE_LABELS, VERDICT_LABELS, type SensitiveKind, type Verdict } from "@/lib/media-intelligence/model";
import type { LibraryStatus, MediaKind } from "@/lib/whatsapp/types";

export type LibraryCard = {
  id: string; kind: MediaKind; status: LibraryStatus; thumbnailUrl: string | null; previewHref: string; driveHref: string;
  receivedLabel: string; receivedIso: string; caption: string | null; sender: string; sizeLabel: string;
  uses: { id: string; label: string; href: string; date: string }[];
  ai: { verdict: Verdict; relevance: number; publishability: number; sensitive: SensitiveKind[]; confidential: boolean; description: string; reviewed: boolean } | null;
};
const verdictTones: Record<Verdict, StatusTone> = { relevant: "green", to_review: "amber", off_topic: "red" };
const percent = (value: number) => `${Math.round(value * 100)} %`;
export type ProjectChoice = { id: string; name: string; platforms: { id: string; label: string }[] };
const tones: Record<LibraryStatus, StatusTone> = { received: "blue", to_review: "amber", validated: "green", used: "neutral", archived: "neutral", quarantined: "red", rejected: "neutral" };
const initial: MediaLibraryState = {};
const field = "block w-full rounded-lg border border-border bg-background p-3";

export function MediaLibraryForm({ clientId, cards, projects }: { clientId: string; cards: LibraryCard[]; projects: ProjectChoice[] }) {
  const [state, action, pending] = useActionState(mediaLibraryAction, initial);
  const [selected, setSelected] = useState<string[]>([]);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const project = projects.find(p => p.id === projectId);
  const chosen = cards.filter(card => selected.includes(card.id));
  const reused = chosen.some(card => card.status === "used");
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  return <form action={action}>
    <input type="hidden" name="client_id" value={clientId} />
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{cards.map(card => {
      const checked = selected.includes(card.id);
      return <li key={card.id} className={`overflow-hidden rounded-xl border bg-surface ${checked ? "border-accent" : "border-border"}`}>
        <a href={card.previewHref} target="_blank" rel="noreferrer" className="block aspect-square bg-surface-raised" aria-label="Prévisualiser l’original">
          {card.thumbnailUrl ? <img src={card.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            : <span className="flex h-full items-center justify-center text-sm text-muted">{card.kind === "video" ? "▶ Vidéo" : "Aperçu indisponible"}</span>}
        </a>
        <div className="space-y-2 p-3 text-sm">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="asset_id" value={card.id} checked={checked} onChange={() => toggle(card.id)} />
            <StatusBadge label={statusLabels[card.status]} tone={tones[card.status]} />{card.kind === "video" && <span className="text-xs text-muted">Vidéo</span>}</label>
          <p className="text-xs text-muted"><time dateTime={card.receivedIso}>{card.receivedLabel}</time> · {card.sender} · {card.sizeLabel}</p>
          {card.ai && <div className="space-y-1 rounded-lg border border-border p-2 text-xs">
            <p className="flex flex-wrap items-center gap-2"><StatusBadge label={`IA : ${VERDICT_LABELS[card.ai.verdict]}`} tone={verdictTones[card.ai.verdict]} />{card.ai.confidential && <StatusBadge label="Confidentiel" tone="red" />}{card.ai.reviewed && <span className="text-muted">Vérifié par un humain</span>}</p>
            <p className="text-muted">Pertinence {percent(card.ai.relevance)} · Publiable {percent(card.ai.publishability)}</p>
            {card.ai.sensitive.length > 0 && <p className="text-warning">{card.ai.sensitive.map(kind => SENSITIVE_LABELS[kind]).join(" · ")}</p>}
            <p className="line-clamp-3">{card.ai.description}</p>
          </div>}
          {card.caption ? <p className="line-clamp-4 whitespace-pre-line" title={card.caption}>« {card.caption} »</p> : <p className="text-xs text-muted">Aucun message associé.</p>}
          <a href={card.driveHref} target="_blank" rel="noreferrer" className="text-xs text-accent">Ouvrir dans Drive</a>
          {card.uses.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-warning">Déjà utilisé {card.uses.length} fois</summary>
            <ul className="mt-1 space-y-1">{card.uses.map(use => <li key={use.id}><Link className="text-accent" href={use.href}>{use.label}</Link> · {use.date}</li>)}</ul></details>}
        </div>
      </li>;
    })}</ul>
    {/* Barre collante à partir de sm seulement : sur mobile, ses boutons couvriraient la moitié de l’écran. */}
    <div className="mt-6 space-y-4 rounded-xl border border-border bg-surface p-4 sm:sticky sm:bottom-0">
      <p className="text-sm">{selected.length ? `${selected.length} média(s) sélectionné(s)` : "Sélectionnez des médias pour changer leur statut ou préparer une publication."}</p>
      <div className="flex flex-wrap gap-2"><Action type="submit" name="intent" value="analyze" disabled={pending || !selected.length || selected.length > 20}>Analyser avec l’IA</Action>{manualStatuses.map(status => <Action key={status} type="submit" name="intent" value={`status:${status}`} disabled={pending || !selected.length}>{`Marquer « ${statusLabels[status]} »`}</Action>)}</div>
      <details className="rounded-lg border border-border p-3">
        <summary className="min-h-10 cursor-pointer font-medium">Préparer une publication avec les photos validées</summary>
        {projects.length ? <div className="mt-3 grid max-w-xl gap-3">
          <p className="text-sm text-muted">{MAX_PUBLICATION_MEDIA} photos validées au maximum. Un brouillon est créé dans Publications : il devra être relu, soumis et approuvé avant toute diffusion.</p>
          <label className="text-sm">Projet<select className={field} name="project_id" value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="mb-1">Plateformes</legend>{project?.platforms.map(platform => <label key={platform.id} className="flex items-center gap-2"><input type="checkbox" name="platform" value={platform.id} defaultChecked />{platform.label}</label>)}</fieldset>
          <label className="text-sm">Texte de la publication (facultatif)<textarea className={field} name="text" rows={4} maxLength={10000} placeholder="Laissez vide pour un texte « À rédiger » ou une suggestion de l’IA." /></label>
          <label className="flex gap-3 text-sm"><input type="checkbox" name="suggest" />Proposer une légende avec l’IA, à partir du message du client et de sa fiche (aucune information inventée).</label>
          {reused && <label className="flex gap-3 text-sm text-warning"><input type="checkbox" name="allow_reuse" />Je confirme le réemploi d’un média déjà utilisé.</label>}
          <Action type="submit" name="intent" value="prepare" variant="primary" disabled={pending || !selected.length || selected.length > MAX_PUBLICATION_MEDIA}>{pending ? "Préparation…" : "Préparer le brouillon"}</Action>
        </div> : <p className="mt-3 text-sm text-muted">Aucun projet Publications actif pour ce client.</p>}
      </details>
      <p role="status" className="text-sm">{state.message}{state.publicationId && <> <Link className="text-accent" href={`/publications/${state.publicationId}`}>Ouvrir la publication</Link></>}</p>
    </div>
  </form>;
}
