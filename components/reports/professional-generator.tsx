"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { actionClass } from "@/components/ui/button";
import { generateProfessionalReportAction, type ProfessionalMutationState } from "@/app/(cockpit)/reports/professional-actions";
import { professionalFamilyLabels, professionalSourceLabels, type ProfessionalReportRequest } from "@/lib/reports/professional";

const field = "mt-1.5 block min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground";
type Source = ProfessionalReportRequest["sources"][number];
const familySource: Partial<Record<ProfessionalReportRequest["family"], Source>> = { ads: "google_ads", seo: "search_console", website: "website", activity: "activity" };

export function ProfessionalReportGenerator({ clients, requestId: initialRequestId, start, end, available }: {
  clients: { id: string; name: string }[]; requestId: string; start: string; end: string; available: boolean;
}) {
  const [family, setFamily] = useState<ProfessionalReportRequest["family"]>("global");
  const [sources, setSources] = useState<Source[]>(["activity", "search_console", "website"]);
  const [requestId, setRequestId] = useState(initialRequestId);
  const [confirmed, setConfirmed] = useState(false);
  const [state, submit, pending] = useActionState<ProfessionalMutationState, FormData>(generateProfessionalReportAction, {});
  const currentResult = state.requestId === requestId ? state : {};

  function change(event: ChangeEvent<HTMLFormElement>) {
    if (event.target instanceof HTMLInputElement && event.target.name === "confirmed") return;
    setConfirmed(false);
    setRequestId(crypto.randomUUID());
  }
  return (
    <div>
      <h2 className="font-semibold">Préparer un rapport client</h2>
      <p className="mt-1 text-sm text-muted">Choisissez une période et les sources à inclure. Les données absentes ou partielles sont signalées dans le document. La préparation ne déclenche aucun envoi.</p>
      {!available && <p role="status" className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">Le reporting personnalisé attend la migration 20261110000000. Le téléchargement et la validation des rapports existants restent disponibles ci-dessous.</p>}
      <form action={submit} onChange={change} className="mt-5">
        <input type="hidden" name="request_id" value={requestId} />
        <fieldset disabled={!available || !clients.length || pending} className="min-w-0 space-y-4 disabled:opacity-60">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="min-w-0 text-xs text-muted">Client
              <select name="client_id" required defaultValue="" className={field}>
                <option value="" disabled>Choisir un client…</option>
                {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-xs text-muted">Famille
              <select name="family" value={family} className={field} onChange={event => {
                const value = event.target.value as ProfessionalReportRequest["family"];
                setFamily(value);
                setSources(value === "global" ? ["activity", "search_console", "website"] : [familySource[value]!]);
              }}>
                {Object.entries(professionalFamilyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-xs text-muted">Du (inclus)<input name="start" type="date" required defaultValue={start} className={field} /></label>
            <label className="min-w-0 text-xs text-muted">Au (inclus)<input name="end" type="date" required defaultValue={end} className={field} /></label>
          </div>
          <fieldset className="rounded-lg border border-border p-4">
            <legend className="px-1 text-xs font-medium text-muted">Sources du document</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(professionalSourceLabels).map(([value, label]) => {
                const source = value as Source;
                return <label key={source} className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="checkbox" name="sources" value={source} checked={sources.includes(source)} disabled={family !== "global"} onChange={event => setSources(items => event.target.checked ? [...items, source] : items.filter(item => item !== source))} />
                  {label}
                  {family !== "global" && sources.includes(source) && <input type="hidden" name="sources" value={source} />}
                </label>;
              })}
            </div>
            <p className="mt-2 text-xs text-muted">Les connexions et la couverture des dates sont vérifiées lors de la collecte. Search et Local Services restent séparés dans les données Google Ads.</p>
          </fieldset>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" name="confirmed" value="yes" checked={confirmed} required className="mt-1" onChange={event => setConfirmed(event.target.checked)} />
            <span>Je confirme la préparation de ce document. Je relirai son aperçu avant de l’approuver ; le destinataire sera confirmé séparément avant l’envoi.</span>
          </label>
          <button type="submit" className={actionClass("primary")} disabled={pending || !confirmed || !sources.length || currentResult.ok === true}>{pending ? "Collecte et préparation…" : "Préparer l’aperçu"}</button>
        </fieldset>
        {currentResult.message && <p role="status" className={`mt-3 text-sm ${currentResult.ok ? "text-success" : "text-warning"}`}>{currentResult.message}</p>}
        {currentResult.ok && currentResult.id && <Link href={`/reports/${currentResult.id}`} className="mt-3 inline-flex min-h-11 items-center font-medium text-accent hover:underline">Ouvrir le rapport et son PDF →</Link>}
      </form>
    </div>
  );
}
