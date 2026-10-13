"use client";
/* eslint-disable @next/next/no-img-element -- Private signed URLs are short-lived and must not be cached by an image proxy. */
import Link from "next/link";
import { useActionState, useState } from "react";
import { Action } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { mediaLibraryAction, reclassifyAssetAction, saveAssetCaptionAction, type MediaAssetState, type MediaLibraryState } from "@/app/(cockpit)/clients/[id]/media-actions";
import { MAX_PUBLICATION_MEDIA, statusLabels, manualStatuses } from "@/lib/whatsapp/library-model";
import { SENSITIVE_LABELS, VERDICT_LABELS, type SensitiveKind, type Verdict } from "@/lib/media-intelligence/model";
import type { LibraryStatus, MediaKind } from "@/lib/whatsapp/types";

export type LibraryCard = {
  id: string; kind: MediaKind; status: LibraryStatus; thumbnailUrl: string | null; previewHref: string; driveHref: string;
  originLabel: string; originDateLabel: string; originDateIso: string; caption: string | null; captionEdited: string | null; sender: string | null; sizeLabel: string; topics: string[];
  uses: { id: string; label: string; href: string; date: string; state: string | null }[];
  ai: { verdict: Verdict; relevance: number; publishability: number; sensitive: SensitiveKind[]; confidential: boolean; description: string; reviewed: boolean; reviewedLabel: string | null } | null;
  statusBy: string | null; reuse: string | null; eligible: boolean;
  reasons: { code: string; label: string; blocking: boolean }[];
  decisions: { id: string; label: string; reason: string | null; by: string; date: string }[];
};
const verdictTones: Record<Verdict, StatusTone> = { relevant: "green", to_review: "amber", off_topic: "red" };
const percent = (value: number) => `${Math.round(value * 100)} %`;
export type ProjectChoice = { id: string; name: string; platforms: { id: string; label: string }[] };
const tones: Record<LibraryStatus, StatusTone> = { received: "blue", to_review: "amber", validated: "green", used: "neutral", archived: "neutral", quarantined: "red", rejected: "neutral" };
const initial: MediaLibraryState = {};
const field = "block w-full rounded-lg border border-border bg-background p-3";

/** Reclassement manuel (administrateur) : statut choisi et motif obligatoire, tracés dans l'historique des décisions. */
function ReclassifyForm({ clientId, card }: { clientId: string; card: LibraryCard }) {
  const [state, action, pending] = useActionState(reclassifyAssetAction, {} as MediaAssetState);
  return <form action={action} className="mt-2 space-y-2 border-t border-border pt-2">
    <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="asset_id" value={card.id} />
    <label className="block">Reclasser en<select name="status" defaultValue={card.status === "validated" ? "to_review" : "validated"} className={`${field} mt-1 p-2`}>{manualStatuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
    <label className="block">Motif (obligatoire)<textarea name="reason" rows={2} minLength={3} maxLength={500} className={`${field} mt-1 p-2`} placeholder="Ex. chantier du client, document masqué, photo floue…" /></label>
    <Action type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Reclasser"}</Action>
    {state.message && <p role="status" className={state.ok ? "text-success" : "text-warning"}>{state.message}</p>}
  </form>;
}

/** Légende (administrateur) : donnée affichée et citée comme source, jamais une consigne. */
function CaptionForm({ clientId, card }: { clientId: string; card: LibraryCard }) {
  const [state, action, pending] = useActionState(saveAssetCaptionAction, {} as MediaAssetState);
  return <details className="text-xs"><summary className="min-h-10 cursor-pointer content-center text-accent">Modifier la légende</summary>
    <form action={action} className="mt-1 space-y-2">
      <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="asset_id" value={card.id} />
      <textarea name="caption" rows={3} maxLength={3000} defaultValue={card.caption ?? ""} className={`${field} p-2`} aria-label="Légende de la photo" />
      <Action type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer la légende"}</Action>
      {state.message && <p role="status" className={state.ok ? "text-success" : "text-warning"}>{state.message}</p>}
    </form>
  </details>;
}

function MediaCardView({ clientId, card, formId, checked, onToggle }: { clientId: string; card: LibraryCard; formId: string; checked: boolean; onToggle: () => void }) {
  const blocking = card.reasons.filter(r => r.blocking);
  return <li className={`overflow-hidden rounded-xl border bg-surface ${checked ? "border-accent" : "border-border"}`}>
    <a href={card.previewHref} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-surface-raised sm:aspect-square" aria-label="Prévisualiser l’original">
      {card.thumbnailUrl ? <img src={card.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        : <span className="flex h-full items-center justify-center text-sm text-muted">{card.kind === "video" ? "▶ Vidéo" : "Aperçu indisponible"}</span>}
    </a>
    <div className="space-y-2 p-3 text-sm">
      <label className="flex min-h-11 flex-wrap items-center gap-2"><input type="checkbox" form={formId} name="asset_id" value={card.id} checked={checked} onChange={onToggle} className="size-5" />
        <StatusBadge label={statusLabels[card.status]} tone={tones[card.status]} />
        <StatusBadge label={card.eligible ? "Proposable à l’agent" : "Écartée pour l’agent"} tone={card.eligible ? "green" : "neutral"} />
        {card.kind === "video" && <span className="text-xs text-muted">Vidéo</span>}</label>
      <p className="text-xs text-muted">{card.originLabel} · <time dateTime={card.originDateIso}>{card.originDateLabel}</time>{card.sender ? ` · ${card.sender}` : ""} · {card.sizeLabel}</p>
      {card.statusBy && <p className="text-xs text-muted">{card.statusBy}</p>}
      {card.topics.length > 0 && <p className="flex flex-wrap gap-1">{card.topics.map(topic => <span key={topic} className="rounded-full border border-border px-2 py-0.5 text-xs">{topic}</span>)}</p>}
      {card.ai && <div className="space-y-1 rounded-lg border border-border p-2 text-xs">
        <p className="flex flex-wrap items-center gap-2"><StatusBadge label={`IA : ${VERDICT_LABELS[card.ai.verdict]}`} tone={verdictTones[card.ai.verdict]} />{card.ai.confidential && <StatusBadge label="Confidentiel" tone="red" />}{card.ai.reviewed && <span className="text-muted">Vérifié par un humain</span>}</p>
        <p className="text-muted">Pertinence {percent(card.ai.relevance)} · Publiable {percent(card.ai.publishability)}</p>
        {card.ai.sensitive.length > 0 && <p className="text-warning">{card.ai.sensitive.map(kind => SENSITIVE_LABELS[kind]).join(" · ")}</p>}
        <p className="line-clamp-3">{card.ai.description}</p>
      </div>}
      {card.caption ? <p className="line-clamp-4 whitespace-pre-line" title={card.caption}>« {card.caption} »</p> : <p className="text-xs text-muted">Aucune légende.</p>}
      {card.captionEdited && <p className="text-xs text-muted">{card.captionEdited}</p>}
      <CaptionForm clientId={clientId} card={card} />
      <a href={card.driveHref} target="_blank" rel="noreferrer" className="inline-block min-h-10 content-center text-xs text-accent">Ouvrir dans Drive</a>
      {card.uses.length > 0 ? <div className="rounded-lg border border-border p-2 text-xs">
        <p className="font-medium text-warning">Déjà utilisée {card.uses.length} fois</p>
        <ul className="mt-1 space-y-1">{card.uses.slice(0, 3).map(use => <li key={use.id}><Link className="text-accent" href={use.href}>{use.label}</Link> · {use.date}{use.state ? ` · ${use.state}` : ""}</li>)}</ul>
        {card.uses.length > 3 && <details><summary className="cursor-pointer text-accent">{card.uses.length - 3} autre(s)</summary>
          <ul className="mt-1 space-y-1">{card.uses.slice(3).map(use => <li key={use.id}><Link className="text-accent" href={use.href}>{use.label}</Link> · {use.date}{use.state ? ` · ${use.state}` : ""}</li>)}</ul></details>}
        {card.reuse && <p className="mt-1 text-muted">{card.reuse}</p>}
      </div> : <p className="text-xs text-muted">Jamais utilisée.</p>}
      <details className="rounded-lg border border-border p-2 text-xs">
        <summary className="min-h-10 cursor-pointer content-center font-medium">{card.eligible ? "Décisions et reclassement" : "Pourquoi écartée ?"}</summary>
        {blocking.length > 0 && <ul className="mt-1 list-disc space-y-1 pl-4">{blocking.map(reason => <li key={reason.code}>{reason.label}</li>)}</ul>}
        {card.reasons.filter(r => !r.blocking).map(reason => <p key={reason.code} className="mt-1 text-muted">{reason.label}</p>)}
        {card.ai?.reviewedLabel && <p className="mt-1 text-muted">{card.ai.reviewedLabel}</p>}
        {card.decisions.length > 0 && <><p className="mt-2 font-medium">Décisions humaines</p>
          <ul className="mt-1 space-y-1">{card.decisions.map(d => <li key={d.id}>{d.label} · {d.by} · {d.date}{d.reason ? <span className="block text-muted">Motif : {d.reason}</span> : null}</li>)}</ul></>}
        <ReclassifyForm clientId={clientId} card={card} />
      </details>
    </div>
  </li>;
}

export function MediaLibraryForm({ clientId, cards, projects, reuseAllowed }: { clientId: string; cards: LibraryCard[]; projects: ProjectChoice[]; reuseAllowed: boolean }) {
  const [state, action, pending] = useActionState(mediaLibraryAction, initial);
  const [selected, setSelected] = useState<string[]>([]);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const project = projects.find(p => p.id === projectId);
  const chosen = cards.filter(card => selected.includes(card.id));
  const reused = chosen.some(card => card.status === "used" || card.uses.length > 0);
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  // Les cartes portent leurs propres formulaires (légende, reclassement) : la sélection est rattachée au formulaire
  // d'actions par l'attribut « form », sans formulaires imbriqués.
  const formId = `media-selection-${clientId}`;
  return <div>
    <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{cards.map(card =>
      <MediaCardView key={card.id} clientId={clientId} card={card} formId={formId} checked={selected.includes(card.id)} onToggle={() => toggle(card.id)} />)}</ul>
    {/* Barre collante à partir de sm seulement : sur mobile, ses boutons couvriraient la moitié de l’écran. */}
    <form id={formId} action={action} className="mt-6 space-y-4 rounded-xl border border-border bg-surface p-4 sm:sticky sm:bottom-0">
      <input type="hidden" name="client_id" value={clientId} />
      <p className="text-sm">{selected.length ? `${selected.length} média(s) sélectionné(s)` : "Sélectionnez des médias pour changer leur statut ou préparer une publication."}</p>
      <div className="flex flex-wrap gap-2"><Action type="submit" name="intent" value="analyze" disabled={pending || !selected.length || selected.length > 20}>Analyser avec l’IA</Action>{manualStatuses.map(status => <Action key={status} type="submit" name="intent" value={`status:${status}`} disabled={pending || !selected.length}>{`Marquer « ${statusLabels[status]} »`}</Action>)}</div>
      <details className="rounded-lg border border-border p-3">
        <summary className="min-h-10 cursor-pointer font-medium">Préparer une publication avec les photos validées</summary>
        {projects.length ? <div className="mt-3 grid max-w-xl gap-3">
          <p className="text-sm text-muted">{MAX_PUBLICATION_MEDIA} photos validées au maximum. Un brouillon est créé dans Publications : il devra être relu, soumis et approuvé avant toute diffusion.</p>
          <label className="text-sm">Projet<select className={field} name="project_id" value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="mb-1">Plateformes</legend>{project?.platforms.map(platform => <label key={platform.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="platform" value={platform.id} defaultChecked />{platform.label}</label>)}</fieldset>
          <label className="text-sm">Texte de la publication (facultatif)<textarea className={field} name="text" rows={4} maxLength={10000} placeholder="Laissez vide pour un texte « À rédiger » ou une suggestion de l’IA." /></label>
          <label className="flex gap-3 text-sm"><input type="checkbox" name="suggest" />Proposer une légende avec l’IA, à partir du message du client et de sa fiche (aucune information inventée).</label>
          {reused && (reuseAllowed
            ? <label className="flex gap-3 text-sm text-warning"><input type="checkbox" name="allow_reuse" />Je confirme le réemploi d’une photo déjà utilisée (le délai minimal fixé pour ce client s’applique).</label>
            : <p className="text-sm text-warning">Une photo sélectionnée a déjà été utilisée et le réemploi est désactivé pour ce client (réglages Publications du client).</p>)}
          <Action type="submit" name="intent" value="prepare" variant="primary" disabled={pending || !selected.length || selected.length > MAX_PUBLICATION_MEDIA}>{pending ? "Préparation…" : "Préparer le brouillon"}</Action>
        </div> : <p className="mt-3 text-sm text-muted">Aucun projet Publications actif pour ce client.</p>}
      </details>
      <p role="status" className="text-sm">{state.message}{state.publicationId && <> <Link className="text-accent" href={`/publications/${state.publicationId}`}>Ouvrir la publication</Link></>}</p>
    </form>
  </div>;
}
