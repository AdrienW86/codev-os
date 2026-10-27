"use client";

import { useState, useTransition, type ReactNode } from "react";
import { actionClass } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/states";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { FICTITIOUS_NOTICE, OUTCOME_LABELS, SIMULATED_OUTCOMES, SIMULATION_PLATFORMS, type ScenarioSummary, type SimulatedOutcomes, type SimulationReport, type SimulationRunState } from "@/lib/publications/simulation/model";
import type { PublicationPlatform } from "@/lib/publications/types";

const platformNames: Record<PublicationPlatform, string> = { facebook: "Facebook", instagram: "Instagram", google_business_profile: "Google Business Profile", tiktok: "TikTok" };
const deliveryTones: Record<string, StatusTone> = { simulated: "green", retryable_error: "amber", blocked: "red", failed: "red", uncertain: "amber" };
const validationTones = { ok: { label: "OK", tone: "green" }, blocked: { label: "Bloquant", tone: "red" }, info: { label: "Rappel", tone: "neutral" } } as const;
const slotFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const formatSlot = (iso: string | null) => { const date = iso ? new Date(iso) : null; return date && !Number.isNaN(date.getTime()) ? slotFormatter.format(date) : "—"; };

type RunAction = (state: SimulationRunState, form: FormData) => Promise<SimulationRunState>;

/**
 * Simulation du pipeline Publications (PR #44) : un scénario fictif, un résultat de diffusion par plateforme, puis le
 * rapport complet. L’action serveur (admin uniquement) est fournie par la page ; ce composant n’écrit rien.
 */
export function PublicationPipelineLab({ scenarios, run, realAIAvailable }: { scenarios: ScenarioSummary[]; run: RunAction; realAIAvailable: boolean }) {
  const [selected, setSelected] = useState(scenarios[0]?.id ?? "");
  const [outcomes, setOutcomes] = useState<SimulatedOutcomes>(scenarios[0]?.defaultOutcomes ?? { facebook: "success", instagram: "success", google_business_profile: "success" });
  const [state, setState] = useState<SimulationRunState>({});
  const [pending, startTransition] = useTransition();
  const choose = (id: string) => { setSelected(id); const scenario = scenarios.find((item) => item.id === id); if (scenario) setOutcomes({ ...scenario.defaultOutcomes }); };
  const submit = (form: FormData) => startTransition(async () => { setState(await run({}, form)); });
  const selectClass = "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60";

  return (
    <div className="space-y-6">
      <InlineNotice tone="info" title="Scénarios fictifs">{FICTITIOUS_NOTICE} Rien n’est publié, rien n’est écrit en base.</InlineNotice>
      <form action={submit} className="space-y-5">
        <fieldset>
          <legend className="mb-3 text-sm font-medium">Scénario</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {scenarios.map((item) => (
              <label key={item.id} className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors ${selected === item.id ? "border-accent/60 bg-accent/5" : "border-border hover:border-accent/30"}`}>
                <input type="radio" name="scenario" value={item.id} checked={selected === item.id} onChange={() => choose(item.id)} className="mt-1 accent-accent" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 font-medium">{item.name}<StatusBadge label="Fictif" tone="blue" />{item.negative && <StatusBadge label="Cas négatif" tone="amber" />}</span>
                  <span className="mt-1 block text-sm text-muted">{item.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-medium">Résultat de diffusion simulé</legend>
          {SIMULATION_PLATFORMS.map((platform) => (
            <label key={platform} className="text-sm">
              {platformNames[platform]}
              <select name={`outcome_${platform}`} value={outcomes[platform]} disabled={pending} onChange={(event) => setOutcomes({ ...outcomes, [platform]: event.target.value as SimulatedOutcomes[PublicationPlatform] })} className={selectClass}>
                {SIMULATED_OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{OUTCOME_LABELS[outcome]}</option>)}
              </select>
            </label>
          ))}
        </fieldset>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="real_ai" disabled={!realAIAvailable || pending} className="mt-1 accent-accent" />
          <span>Rédaction par l’IA réelle (option administrateur)<span className="block text-xs text-muted">{realAIAvailable ? "Appel facturé, sur les données fictives du scénario uniquement. L’analyse des photos et la diffusion restent simulées." : "Indisponible : aucune clé IA serveur. Le modèle simulé déterministe est utilisé."}</span></span>
        </label>
        <button type="submit" disabled={pending || !selected} className={actionClass("primary")}>{pending ? "Simulation en cours…" : "Lancer la simulation"}</button>
      </form>
      {state.error && <InlineNotice tone="red">{state.error}</InlineNotice>}
      {state.report && <PipelineReport report={state.report} />}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5" aria-labelledby={`sim-step-${n}`}>
      <h3 id={`sim-step-${n}`} className="mb-3 flex items-center gap-2 font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs text-accent">{n}</span>{title}</h3>
      <div className="space-y-3 text-sm">{children}</div>
    </section>
  );
}

/** Rapport lisible d’une simulation (rendu pur). */
export function PipelineReport({ report }: { report: SimulationReport }) {
  return (
    <div className="space-y-4" data-simulation-report={report.scenario.id}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{report.scenario.name}</h2>
        <StatusBadge label="Données fictives" tone="blue" />
        <StatusBadge label={report.aiMode === "real" ? "Rédaction : IA réelle" : "Rédaction : modèle simulé"} tone={report.aiMode === "real" ? "amber" : "neutral"} />
      </div>
      <p className="text-sm text-muted">{report.scenario.clientName} · {report.scenario.activity}. {report.scenario.description}</p>

      <Step n={1} title="Photos analysées">
        <ul className="space-y-2">
          {report.photos.map((photo) => (
            <li key={photo.id} className="rounded-lg border border-border p-3">
              <p className="flex flex-wrap items-center gap-2 font-medium">{photo.label}<StatusBadge label={photo.verdictLabel} tone={photo.candidate ? "green" : photo.confidential ? "red" : "amber"} />{photo.candidate && <StatusBadge label="Candidate" tone="green" />}</p>
              <p className="mt-1 text-muted">{photo.description}</p>
              <p className="mt-1 text-xs text-muted">Pertinence {photo.relevance} · publiabilité {photo.publishability} · qualité {photo.quality}{photo.sensitive.length ? ` · sensible : ${photo.sensitive.join(", ")}` : ""}</p>
              {photo.overridden && <p className="mt-1 text-xs text-warning">Le modèle disait « {photo.modelVerdict} » : les règles de sûreté ont primé.</p>}
              {photo.exclusion && <p className="mt-1 text-xs">Écartée : {photo.exclusion}</p>}
            </li>
          ))}
        </ul>
      </Step>

      <Step n={2} title="Choix éditorial">
        <p><span className="font-medium">Photo retenue :</span> {report.selected.label ?? "aucune"}</p>
        <p><span className="font-medium">Raison :</span> {report.selected.reason}</p>
        <p><span className="font-medium">Sujet choisi :</span> {report.idea ? `${report.idea.subject} — ${report.idea.angle}` : "aucun"}</p>
        <p><span className="font-medium">Prestations vérifiées :</span> {report.services.join(", ")}{report.priorityTopics.length ? ` · prioritaires : ${report.priorityTopics.join(", ")}` : ""}</p>
        <div>
          <p className="font-medium">Historique pris en compte</p>
          {report.history.length ? <ul className="mt-1 list-disc pl-5 text-muted">{report.history.map((item) => <li key={item.subject}>{item.subject}{item.media ? ` (photo : ${item.media})` : ""}</li>)}</ul> : <p className="text-muted">Aucune publication récente.</p>}
        </div>
        <div>
          <p className="font-medium">Propositions du modèle</p>
          <ol className="mt-1 space-y-1">{report.attempts.map((attempt) => <li key={attempt.n} className="flex flex-wrap items-center gap-2"><StatusBadge label={attempt.accepted ? "Acceptée" : "Refusée"} tone={attempt.accepted ? "green" : "red"} />Essai {attempt.n} : {attempt.subject ?? "—"}{attempt.mediaLabel ? ` · photo « ${attempt.mediaLabel} »` : " · sans photo"} — <span className="text-muted">{attempt.message}</span></li>)}</ol>
        </div>
      </Step>

      <Step n={3} title="Déclinaisons par plateforme">
        {report.variants.length ? <div className="grid gap-3 lg:grid-cols-3">{report.variants.map((variant) => (
          <article key={variant.platform} className="rounded-lg border border-border p-3">
            <p className="flex items-center justify-between gap-2 font-medium">{variant.platformLabel}<StatusBadge label={variant.ruleOk ? "Règles respectées" : "Hors règles"} tone={variant.ruleOk ? "green" : "red"} /></p>
            <p className="mt-2 whitespace-pre-line">{variant.text}</p>
            {variant.cta && <p className="mt-2 text-xs text-muted">Appel à l’action : {variant.cta}</p>}
            <p className="mt-2 text-xs text-muted">{variant.length}/{variant.maxLength} caractères · {variant.hashtags}/{variant.maxHashtags} hashtags</p>
          </article>))}</div> : <p className="text-muted">Aucune déclinaison : aucun brouillon créé.</p>}
      </Step>

      <Step n={4} title="Brouillon, validations et approbation simulée">
        <p>{report.draft.message}</p>
        <ul className="space-y-1">{report.approval.validations.map((item) => <li key={item.label} className="flex flex-wrap items-start gap-2"><StatusBadge label={validationTones[item.state].label} tone={validationTones[item.state].tone} /><span><span className="font-medium">{item.label}</span> — <span className="text-muted">{item.detail}</span></span></li>)}</ul>
        <InlineNotice tone={report.approval.possible ? "green" : "amber"}>{report.approval.message}</InlineNotice>
      </Step>

      <Step n={5} title="Créneaux du calendrier">
        <p className="text-muted">{report.slots.considered} créneau{report.slots.considered > 1 ? "x" : ""} ouvert{report.slots.considered > 1 ? "s" : ""} sur 14 jours ; une idée couvre au plus une occurrence par plateforme.</p>
        {report.slots.batch.length ? <ul className="space-y-1">{report.slots.batch.map((slot) => <li key={slot.platform}><span className="font-medium">{slot.platformLabel}</span> : {formatSlot(slot.scheduledFor)} ({slot.timezone})</li>)}</ul> : <p>Aucun créneau planifié.</p>}
      </Step>

      <Step n={6} title="Diffusion simulée">
        {report.deliveries.length ? <ul className="space-y-2">{report.deliveries.map((delivery) => (
          <li key={delivery.platform} className="rounded-lg border border-border p-3">
            <p className="flex flex-wrap items-center gap-2 font-medium">{delivery.platformLabel}<StatusBadge label={delivery.statusLabel} tone={deliveryTones[delivery.status] ?? "neutral"} /><span className="text-xs text-muted">Résultat choisi : {delivery.outcomeLabel}</span></p>
            <p className="mt-1 text-muted">{delivery.detail}</p>
            {delivery.nextRetry && <p className="mt-1 text-xs">{delivery.nextRetry}</p>}
            {!delivery.publisherCalled && <p className="mt-1 text-xs text-muted">Publisher simulé non appelé.</p>}
          </li>))}</ul> : <p className="text-muted">Aucune diffusion : la publication n’est pas approuvée.</p>}
      </Step>

      <InlineNotice tone="neutral" title="Garanties de la simulation"><ul className="list-disc pl-5">{report.guarantees.map((item) => <li key={item}>{item}</li>)}</ul></InlineNotice>
    </div>
  );
}
