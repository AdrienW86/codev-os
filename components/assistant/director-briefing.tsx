"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { isSafeHref } from "@/lib/assistant/views";
import type { DirectorBriefing as Briefing, DirectorDecision, DirectorSource } from "@/lib/assistant/director-model";

const sources: Record<DirectorSource, string> = { incidents: "Incidents", tasks: "Tâches à échéance", actions: "Actions à valider", recommendations: "Recommandations", seo: "Search Console" };
const priorities = { critical: "Critique", high: "Haute", medium: "Moyenne", low: "Basse", unrated: "Non évaluée" };
const impact = { high: "Potentiellement élevé", medium: "Potentiellement modéré", unrated: "Non chiffré" };
const date = (value: string) => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value))
  : "Date invérifiable";
type Propose = (tool: string, input: Record<string, unknown>) => Promise<{ ok?: boolean; message?: string }>;

function Decision({ decision, propose }: { decision: DirectorDecision; propose: Propose }) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  async function proposeTask() {
    if (busy.current) return;
    busy.current = true; setPending(true); setNotice("");
    try {
      const result = await propose("create_task", { client: decision.clientName, title: decision.title.slice(0, 200),
        priority: decision.priority === "critical" || decision.priority === "high" ? "Haute" : "Moyenne" });
      // The shared confirmation card owns success/cancel state; do not retain a stale
      // local “ready to confirm” notice after the administrator cancels that proposal.
      setNotice(result.ok ? "" : result.message ?? "Proposition indisponible. Aucune tâche n’a été créée.");
    } catch { setNotice("Proposition indisponible. Aucune tâche n’a été créée."); }
    finally { busy.current = false; setPending(false); }
  }
  return (
    <li className="min-w-0 space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <Link href={`/clients/${decision.clientId}`} className="font-semibold text-accent hover:underline">{decision.clientName}</Link>
        <span className={decision.priority === "critical" || decision.priority === "high" ? "text-warning" : "text-muted"}>Priorité {priorities[decision.priority]} · {sources[decision.source]}</span>
      </div>
      <h3 className="break-words text-base font-semibold">{decision.title}</h3>
      <dl className="space-y-2 text-sm">
        <div><dt className="font-medium">Fait enregistré</dt><dd className="mt-0.5 break-words text-muted">{decision.fact}</dd></div>
        {decision.hypothesis && <div><dt className="font-medium">Hypothèse ou justification à confirmer</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-muted">{decision.hypothesis}</dd></div>}
        <div><dt className="font-medium">Impact · {impact[decision.impact.level]}</dt><dd className="mt-0.5 text-muted">{decision.impact.statement}</dd></div>
        <div><dt className="font-medium">Confiance · {decision.confidence.level === "supported" ? "État étayé" : "Limitée"}</dt><dd className="mt-0.5 text-muted">{decision.confidence.reason}</dd></div>
      </dl>
      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="min-h-8 cursor-pointer font-medium">Preuves datées ({decision.evidence.length})</summary>
        <ul className="mt-2 space-y-2">
          {decision.evidence.map((evidence, index) => <li key={index} className="break-words text-muted">
            <p>{evidence.statement}</p><p className="mt-1 text-xs">{date(evidence.at)} · Europe/Paris</p>
            {isSafeHref(evidence.href) && <Link href={evidence.href} className="mt-1 inline-flex min-h-9 items-center text-accent hover:underline">Consulter la source</Link>}
          </li>)}
        </ul>
      </details>
      <p className="text-sm">{decision.nextStep}</p>
      <p className="text-xs text-muted">{decision.validation === "existing_approval" ? "Validation humaine dans le parcours existant ; aucune approbation depuis ce diagnostic." : "Examen humain requis. Toute écriture nécessite sa confirmation habituelle."}</p>
      <div className="flex flex-wrap gap-2">
        {isSafeHref(decision.href) && <Link href={decision.href} className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm text-accent hover:underline">{decision.validation === "existing_approval" ? "Relire pour valider" : "Examiner"}</Link>}
        {decision.source !== "actions" && decision.source !== "tasks" && <button type="button" onClick={() => void proposeTask()} disabled={pending}
          className="min-h-11 rounded-lg border border-accent/40 px-3 text-sm text-accent disabled:opacity-60">{pending ? "Préparation…" : "Proposer une tâche"}</button>}
      </div>
      {notice && <p role="status" className="text-xs text-muted">{notice}</p>}
    </li>
  );
}

/** Same single result panel as other tools; cards wrap on mobile and never auto-execute. */
export function DirectorBriefing({ briefing, propose }: { briefing: Briefing; propose: Propose }) {
  return (
    <section aria-label="Diagnostic transversal des clients" className="min-w-0 space-y-5">
      <p className="text-sm text-muted">{briefing.scope} · {briefing.clientCount} client(s) consulté(s){briefing.clientTotal !== null ? ` sur ${briefing.clientTotal}` : ""} · {date(briefing.generatedAt)} · Europe/Paris</p>
      <section aria-label="Couverture des sources" className="rounded-xl border border-border bg-surface p-3">
        <h3 className="text-sm font-semibold">Sources consultées</h3>
        <ul className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
          {briefing.coverage.map((source) => <li key={source.source} className={source.status === "unavailable" || source.truncated ? "text-warning" : "text-muted"}>
            {sources[source.source]} : {source.status === "unavailable" ? "indisponible" : `${source.loaded} élément(s)${source.total !== null ? ` sur ${source.total}` : ""}${source.truncated ? " · lecture partielle" : ""}`}
          </li>)}
        </ul>
      </section>
      <details open className="rounded-xl border border-warning/25 p-3 text-xs text-muted">
        <summary className="min-h-8 cursor-pointer font-medium text-foreground">Périmètre et limites du diagnostic</summary>
        <ul className="mt-2 list-disc space-y-2 pl-4">{briefing.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      </details>
      {briefing.decisions.length > 0 ? <ol aria-label="Propositions classées par priorité" className="space-y-4">
        {briefing.decisions.map((decision) => <Decision key={decision.id} decision={decision} propose={propose} />)}
      </ol> : <p className="rounded-xl border border-border p-4 text-sm text-muted">Aucune priorité établie dans les données consultées. Vérifiez les sources absentes ou anciennes avant de conclure.</p>}
      {briefing.omitted > 0 && <p className="text-xs text-muted">{briefing.omitted} autre(s) proposition(s) dans les données consultées. Demandez le diagnostic d’un client nommé pour affiner.</p>}
    </section>
  );
}
